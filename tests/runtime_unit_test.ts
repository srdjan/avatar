import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  audioEnded,
  audioStarted,
  decideAudio,
  initialAudioPolicy,
  initialRigState,
  type ReactionPayload,
  reduceRigSync,
} from "../browser/runtime_core.ts";

function reaction(
  id: number,
  overrides: Partial<Extract<ReactionPayload, { tag: "active" }>> = {},
): Extract<ReactionPayload, { tag: "active" }> {
  return {
    tag: "active",
    id,
    kind: "TestReaction",
    expression: "happiness",
    intensity: 1,
    motion: "pop",
    durationMs: 120,
    confidence: 1,
    voiceCue: "laugh",
    ...overrides,
  };
}

const noReaction = (id = 0): ReactionPayload => ({ tag: "none", id });

Deno.test("rig reducer sequences preceding, macro, and micro reactions once", () => {
  const first = reduceRigSync(initialRigState(), {
    main: reaction(2),
    preceding: reaction(1, { kind: "LeadReaction", durationMs: 40 }),
    micro: reaction(1, { kind: "MicroReaction", expression: "focused" }),
  });
  assertEquals(first.state.seen, { main: 2, preceding: 1, micro: 1 });
  assertEquals(first.effects, [
    { tag: "start-macro", reaction: reaction(1, { kind: "LeadReaction", durationMs: 40 }) },
    { tag: "schedule-macro", reaction: reaction(2), delayMs: 40 },
    {
      tag: "start-micro",
      reaction: reaction(1, { kind: "MicroReaction", expression: "focused" }),
    },
  ]);

  const repeated = reduceRigSync(first.state, {
    main: reaction(2),
    preceding: reaction(1, { kind: "LeadReaction", durationMs: 40 }),
    micro: reaction(1, { kind: "MicroReaction", expression: "focused" }),
  });
  assertEquals(repeated.effects, []);

  const blanksAdvanceIds = reduceRigSync(repeated.state, {
    main: noReaction(3),
    preceding: noReaction(2),
    micro: noReaction(2),
  });
  assertEquals(blanksAdvanceIds.effects, []);
  assertEquals(blanksAdvanceIds.state.seen, { main: 3, preceding: 2, micro: 2 });
});

Deno.test("rig reducer ignores stale reaction ids without lowering seen state", () => {
  const current = reduceRigSync(initialRigState(), {
    main: reaction(2),
    preceding: reaction(2, { kind: "LeadReaction" }),
    micro: reaction(2, { kind: "MicroReaction" }),
  });
  assertEquals(current.state.seen, { main: 2, preceding: 2, micro: 2 });

  const stale = reduceRigSync(current.state, {
    main: reaction(1),
    preceding: reaction(1, { kind: "LeadReaction" }),
    micro: reaction(1, { kind: "MicroReaction" }),
  });
  assertEquals(stale.effects, []);
  assertEquals(stale.state.seen, { main: 2, preceding: 2, micro: 2 });
});

Deno.test("audio reducer preserves per-kind intensity probabilities", () => {
  const availableCues = new Set(["gasp"]);
  const request = {
    cue: "gasp",
    intensity: 1,
    rigKind: "bot",
    rigId: "avatar-rig-east",
    seatId: "east",
    seatAudioProbability: 1,
  } as const;
  const decide = (rigKind: "bot" | "human-generated", intensity: number, sample: number) =>
    decideAudio(initialAudioPolicy(), { ...request, intensity, rigKind }, {
      audioEnabled: true,
      availableCues,
      now: 1_000,
      randomSample: sample,
    }).tag;

  assertEquals(decide("bot", 1, 0.399), "admitted");
  assertEquals(decide("bot", 1, 0.4), "rejected");
  assertEquals(decide("bot", 2, 0.699), "admitted");
  assertEquals(decide("bot", 2, 0.7), "rejected");
  assertEquals(decide("bot", 3, 0.949), "admitted");
  assertEquals(decide("bot", 3, 0.95), "rejected");
  assertEquals(decide("human-generated", 1, 0.079), "admitted");
  assertEquals(decide("human-generated", 1, 0.08), "rejected");
  assertEquals(decide("human-generated", 2, 0.199), "admitted");
  assertEquals(decide("human-generated", 2, 0.2), "rejected");
  assertEquals(decide("human-generated", 3, 0.399), "admitted");
  assertEquals(decide("human-generated", 3, 0.4), "rejected");
  assertEquals(
    decideAudio(initialAudioPolicy(), { ...request, rigKind: "human-photo" }, {
      audioEnabled: true,
      availableCues,
      now: 1_000,
      randomSample: 0,
    }),
    { tag: "rejected", reason: "rig-kind" },
  );
});

Deno.test("audio reducer tracks active seats, cue cooldowns, and legacy durations", () => {
  const availableCues = new Set([
    "custom",
    "gasp",
    "laugh",
    "laughClimactic",
    "groan",
  ]);
  const request = {
    cue: "laugh",
    intensity: 3,
    rigKind: "bot",
    rigId: "avatar-rig-east",
    seatId: "east",
    seatAudioProbability: 1,
  } as const;
  const context = (now: number) => ({
    audioEnabled: true,
    availableCues,
    now,
    randomSample: 0,
  });
  const admitted = decideAudio(initialAudioPolicy(), request, context(1_000));
  assertEquals(admitted.tag, "admitted");
  if (admitted.tag !== "admitted") return;
  assertEquals({
    channelKey: admitted.channelKey,
    cueKey: admitted.cueKey,
    durationMs: admitted.durationMs,
  }, {
    channelKey: "east",
    cueKey: "laughClimactic",
    durationMs: 1_800,
  });

  const active = audioStarted(admitted.nextState, admitted.channelKey);
  assertEquals(
    decideAudio(active, { ...request, cue: "gasp", intensity: 1 }, context(3_501)),
    { tag: "rejected", reason: "seat-active" },
  );

  const secondSeat = decideAudio(
    active,
    { ...request, cue: "gasp", intensity: 1, seatId: "west" },
    context(1_100),
  );
  assertEquals(secondSeat.tag, "admitted");
  if (secondSeat.tag !== "admitted") return;
  const full = audioStarted(secondSeat.nextState, secondSeat.channelKey);
  assertEquals(
    decideAudio(full, { ...request, cue: "groan", intensity: 1, seatId: "north" }, context(1_100)),
    { tag: "rejected", reason: "channel-cap" },
  );

  const releasedWest = audioEnded(full, secondSeat.channelKey);
  const released = audioEnded(releasedWest, admitted.channelKey);
  assertEquals(released.activeSeats, {});

  const sameCue = decideAudio(
    released,
    { ...request, cue: "gasp", intensity: 1, seatId: "north" },
    context(1_200),
  );
  assertEquals(sameCue, { tag: "rejected", reason: "cue-cooldown" });
  const climacticBypass = decideAudio(
    released,
    { ...request, cue: "gasp", intensity: 3, seatId: "north" },
    context(1_200),
  );
  assertEquals(climacticBypass.tag, "admitted");

  const normalLaugh = decideAudio(
    initialAudioPolicy(),
    { ...request, intensity: 1, seatId: "normal-laugh" },
    context(2_000),
  );
  assertEquals(normalLaugh.tag === "admitted" ? normalLaugh.durationMs : null, 945);
  const fallback = decideAudio(
    initialAudioPolicy(),
    { ...request, cue: "custom", intensity: 2, seatId: "fallback" },
    context(2_000),
  );
  assertEquals(fallback.tag === "admitted" ? fallback.durationMs : null, 2_400);
});

Deno.test("audio reducer keeps a 600ms seat gap and prunes expired throttle state", () => {
  const availableCues = new Set(["gasp", "groan"]);
  const request = {
    cue: "gasp",
    intensity: 1,
    rigKind: "bot",
    rigId: "avatar-rig-east",
    seatId: "east",
    seatAudioProbability: 1,
  } as const;
  const context = (now: number) => ({
    audioEnabled: true,
    availableCues,
    now,
    randomSample: 0,
  });
  const first = decideAudio(initialAudioPolicy(), request, context(1_000));
  assertEquals(first.tag, "admitted");
  if (first.tag !== "admitted") return;
  assertEquals(
    decideAudio(first.nextState, { ...request, cue: "groan" }, context(1_599)),
    { tag: "rejected", reason: "seat-cooldown" },
  );
  assertEquals(
    decideAudio(first.nextState, { ...request, cue: "groan" }, context(1_600)).tag,
    "admitted",
  );

  const pruned = decideAudio(
    {
      activeSeats: {},
      cueCooldownUntil: { expired: 3_999, recent: 4_001 },
      seatPlayedAt: { stale: 3_399, recent: 3_999 },
    },
    { ...request, seatId: "new" },
    context(4_000),
  );
  assertEquals(pruned.tag, "admitted");
  if (pruned.tag !== "admitted") return;
  assertEquals(pruned.nextState.cueCooldownUntil, { recent: 4_001, gasp: 4_900 });
  assertEquals(pruned.nextState.seatPlayedAt, { recent: 3_999, new: 4_000 });
});
