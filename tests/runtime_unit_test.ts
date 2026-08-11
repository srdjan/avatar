import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  audioEnded,
  audioStarted,
  compileRigControlPose,
  decideAudio,
  initialAudioPolicy,
  initialRigControlState,
  initialRigState,
  parseRigControlCommand,
  type ReactionPayload,
  reduceRigControl,
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

Deno.test("control command parser validates finite normalized snapshots", () => {
  assertEquals(
    parseRigControlCommand({
      tag: "set",
      rigId: "avatar-rig-east",
      sourceId: "game-state",
      sequence: 7,
      preset: "worry",
      features: { browInnerRaise: 0.8, jawOpen: 0.15 },
    }),
    {
      tag: "parsed",
      command: {
        tag: "set",
        rigId: "avatar-rig-east",
        sourceId: "game-state",
        sequence: 7,
        preset: "worry",
        features: { browInnerRaise: 0.8, jawOpen: 0.15 },
        transitionMs: 180,
      },
    },
  );
  assertEquals(
    parseRigControlCommand({
      tag: "trigger",
      rigId: "avatar-rig-east",
      sourceId: "game-state",
      sequence: 8,
      gesture: "laugh",
    }),
    {
      tag: "parsed",
      command: {
        tag: "trigger",
        rigId: "avatar-rig-east",
        sourceId: "game-state",
        sequence: 8,
        gesture: "laugh",
        intensity: 1,
        durationMs: 900,
      },
    },
  );
  for (
    const invalid of [
      null,
      { tag: "set", rigId: "", sourceId: "source", sequence: 1, preset: "smile" },
      { tag: "set", rigId: "rig", sourceId: "source", sequence: -1, preset: "smile" },
      { tag: "set", rigId: "rig", sourceId: "source", sequence: 1, preset: "grin" },
      {
        tag: "set",
        rigId: "rig",
        sourceId: "source",
        sequence: 1,
        preset: "smile",
        features: { jawOpen: Number.NaN },
      },
      {
        tag: "set",
        rigId: "rig",
        sourceId: "source",
        sequence: 1,
        preset: "smile",
        features: { jawOpen: 1.01 },
      },
      {
        tag: "set",
        rigId: "rig",
        sourceId: "source",
        sequence: 1,
        preset: "smile",
        features: { unknown: 0.5 },
      },
      {
        tag: "trigger",
        rigId: "rig",
        sourceId: "source",
        sequence: 1,
        gesture: "laugh",
        durationMs: 99,
      },
    ]
  ) {
    assertEquals(parseRigControlCommand(invalid), {
      tag: "rejected",
      reason: "invalid-command",
    });
  }
  assertEquals(
    parseRigControlCommand({
      tag: "set",
      rigId: "avatar-rig-east",
      sourceId: "camera",
      sequence: Symbol("not-a-sequence"),
      preset: "smile",
    }),
    { tag: "rejected", reason: "invalid-command" },
  );
});

Deno.test("control command parser snapshots accessor-backed fields once", () => {
  const readOnce = <Value>(first: Value, later: unknown, reads: { count: number }) => () => {
    reads.count++;
    return reads.count === 1 ? first : later;
  };
  const counts = {
    tag: { count: 0 },
    rigId: { count: 0 },
    sourceId: { count: 0 },
    sequence: { count: 0 },
    preset: { count: 0 },
    features: { count: 0 },
    jawOpen: { count: 0 },
  };
  const featureValues = Object.defineProperties({}, {
    jawOpen: {
      enumerable: true,
      get: readOnce(0.4, 2, counts.jawOpen),
    },
  });
  const command = Object.defineProperties({}, {
    tag: { enumerable: true, get: readOnce("set", "release", counts.tag) },
    rigId: { enumerable: true, get: readOnce("avatar-rig-east", "", counts.rigId) },
    sourceId: { enumerable: true, get: readOnce("camera", "", counts.sourceId) },
    sequence: { enumerable: true, get: readOnce(1, -1, counts.sequence) },
    preset: { enumerable: true, get: readOnce("smile", "not-a-preset", counts.preset) },
    features: { enumerable: true, get: readOnce(featureValues, null, counts.features) },
  });

  assertEquals(parseRigControlCommand(command), {
    tag: "parsed",
    command: {
      tag: "set",
      rigId: "avatar-rig-east",
      sourceId: "camera",
      sequence: 1,
      preset: "smile",
      features: { jawOpen: 0.4 },
      transitionMs: 180,
    },
  });
  assertEquals(
    Object.fromEntries(Object.entries(counts).map(([field, count]) => [field, count.count])),
    { tag: 1, rigId: 1, sourceId: 1, sequence: 1, preset: 1, features: 1, jawOpen: 1 },
  );

  const gestureReads = { count: 0 };
  const trigger = Object.defineProperty(
    {
      tag: "trigger",
      rigId: "avatar-rig-east",
      sourceId: "camera",
      sequence: 2,
    },
    "gesture",
    {
      enumerable: true,
      get: readOnce("laugh", "not-a-gesture", gestureReads),
    },
  );
  assertEquals(parseRigControlCommand(trigger), {
    tag: "parsed",
    command: {
      tag: "trigger",
      rigId: "avatar-rig-east",
      sourceId: "camera",
      sequence: 2,
      gesture: "laugh",
      intensity: 1,
      durationMs: 900,
    },
  });
  assertEquals(gestureReads.count, 1);

  const throwing = Object.defineProperty({}, "tag", {
    enumerable: true,
    get: () => {
      throw new Error("hostile accessor");
    },
  });
  assertEquals(parseRigControlCommand(throwing), {
    tag: "rejected",
    reason: "invalid-command",
  });
});

Deno.test("control reducer enforces one owner and monotonic source sequences", () => {
  const firstCommand = parseRigControlCommand({
    tag: "set",
    rigId: "avatar-rig-east",
    sourceId: "game-state",
    sequence: 3,
    preset: "mad",
  });
  if (firstCommand.tag !== "parsed" || firstCommand.command.tag !== "set") {
    throw new Error("valid command rejected");
  }
  const first = reduceRigControl(initialRigControlState(), firstCommand.command);
  assertEquals(first.decision, { tag: "accepted" });
  assertEquals(first.effects, [{ tag: "set-affect", command: firstCommand.command }]);

  const staleCommand = { ...firstCommand.command, sequence: 3, preset: "smile" as const };
  const stale = reduceRigControl(first.state, staleCommand);
  assertEquals(stale.decision, { tag: "rejected", reason: "stale-sequence" });
  assertEquals(stale.effects, []);

  const busy = reduceRigControl(first.state, {
    ...firstCommand.command,
    sourceId: "camera",
    sequence: 1,
  });
  assertEquals(busy.decision, { tag: "rejected", reason: "source-busy" });

  const released = reduceRigControl(first.state, {
    tag: "release",
    rigId: "avatar-rig-east",
    sourceId: "game-state",
    sequence: 4,
    transitionMs: 180,
  });
  assertEquals(released.decision, { tag: "accepted" });
  assertEquals(released.state.ownerSourceId, null);
  assertEquals(released.effects, [{ tag: "release-affect", transitionMs: 180 }]);

  const nextOwner = reduceRigControl(released.state, {
    ...firstCommand.command,
    sourceId: "camera",
    sequence: 1,
    preset: "smile",
  });
  assertEquals(nextOwner.decision, { tag: "accepted" });
  assertEquals(nextOwner.state.ownerSourceId, "camera");

  const prototypeNamedSource = reduceRigControl(initialRigControlState(), {
    tag: "set",
    rigId: "avatar-rig-east",
    sourceId: "__proto__",
    sequence: 1,
    preset: "focused",
    features: {},
    transitionMs: 0,
  });
  assertEquals(prototypeNamedSource.decision, { tag: "accepted" });
  assertEquals(
    reduceRigControl(prototypeNamedSource.state, {
      tag: "set",
      rigId: "avatar-rig-east",
      sourceId: "__proto__",
      sequence: 1,
      preset: "focused",
      features: {},
      transitionMs: 0,
    }).decision,
    { tag: "rejected", reason: "stale-sequence" },
  );
});

Deno.test("control pose compiler applies preset recipes, overrides, and personality", () => {
  assertEquals(compileRigControlPose("smile", {}, 1), {
    features: {
      browInnerRaise: 0.1,
      browLower: 0,
      eyeWiden: 0,
      eyeSquint: 0.2,
      cheekRaise: 0.45,
      mouthCornerLift: 0.65,
      mouthCornerDrop: 0,
      jawOpen: 0.08,
    },
    eyes: { translateY: -0.45, scaleY: 0.81 },
    brows: { translateY: -0.6, scaleY: 1.015 },
    mouth: { translateY: -1.3, scaleX: 1.052, scaleY: 1.064 },
    layer: { translateX: 0, translateY: -1, rotate: -1, scale: 1.02 },
  });
  const restrained = compileRigControlPose("worry", {
    eyeWiden: 0.2,
    jawOpen: 0,
  }, 0.5);
  assertEquals(restrained.features.eyeWiden, 0.2);
  assertEquals(restrained.features.jawOpen, 0);
  assertEquals(restrained.eyes.scaleY, 1.04);
  assertEquals(restrained.layer, {
    translateX: 0,
    translateY: -0.25,
    rotate: 1,
    scale: 1.005,
  });
});

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
