import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  CHARACTER_AUDIO_PROFILE_SLOTS,
  FACIAL_REACTION_GESTURES,
  FACIAL_REACTION_STATES,
  LAUGHTER_QUALIFIERS,
  SEMANTIC_AUDIO_FAMILIES,
} from "../mod.ts";
import {
  audioEnded,
  audioStarted,
  compileRigControlPose,
  decideAudio,
  facialReactionIdentityEquals,
  facialReactionPayloadEquals,
  initialAudioPolicy,
  initialRigControlState,
  parseFacialReaction,
  parseRigControlCommand,
  parseSerializedRigProtocol,
  reduceRigControl,
  reduceRigSync,
  resolveCharacterAudioProfileSlot,
  seedRigState,
  semanticAudioForReaction,
  semanticAudioForState,
  setRigRenderedBaseline,
  validateCharacterAudioProfiles,
} from "../browser/runtime_core.ts";

const atomicReaction = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  identity: "match-1:hand-1:event-1",
  state: "smile",
  kind: "TrickWon",
  intensity: 2,
  motion: "pop",
  durationMs: 900,
  confidence: 0.8,
  ...overrides,
});

const completeAudioProfile = (src = "/shared.mp3") =>
  Object.fromEntries(
    CHARACTER_AUDIO_PROFILE_SLOTS.map((slot) => [slot, { src, gain: 1 }]),
  );

function acceptedReaction(overrides: Readonly<Record<string, unknown>> = {}) {
  const parsed = parseFacialReaction(atomicReaction(overrides));
  if (parsed.tag !== "accepted") throw new Error("test reaction rejected");
  return parsed.reaction;
}

function acceptedProfiles() {
  const parsed = validateCharacterAudioProfiles({
    "bot-steady": completeAudioProfile(),
    "human-default": completeAudioProfile("/human.mp3"),
  });
  if (parsed.tag !== "accepted") throw new Error("test profiles rejected");
  return parsed.profiles;
}

function protocol(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    matchScope: "match-1",
    audioProfileId: "bot-steady",
    main: null,
    preceding: null,
    micro: null,
    ...overrides,
  };
}

Deno.test("facial reaction vocabulary and semantic state policy are exhaustive", () => {
  assertEquals(FACIAL_REACTION_STATES, [
    "neutral",
    "focused",
    "smile",
    "sad",
    "worry",
    "mad",
    "surprised",
  ]);
  assertEquals(FACIAL_REACTION_GESTURES, ["laugh"]);
  assertEquals(SEMANTIC_AUDIO_FAMILIES, [
    "Happiness",
    "Sadness",
    "Worry",
    "Anger",
    "Surprise",
    "Laughter",
  ]);
  assertEquals(LAUGHTER_QUALIFIERS, ["standard", "climactic"]);
  assertEquals(
    Object.fromEntries(
      FACIAL_REACTION_STATES.map((state) => [state, semanticAudioForState(state)]),
    ),
    {
      neutral: { tag: "silent" },
      focused: { tag: "silent" },
      smile: { tag: "audible", family: "Happiness" },
      sad: { tag: "audible", family: "Sadness" },
      worry: { tag: "audible", family: "Worry" },
      mad: { tag: "audible", family: "Anger" },
      surprised: { tag: "audible", family: "Surprise" },
    },
  );
});

Deno.test("facial reaction parser enforces the state and laugh qualifier ADT", () => {
  const stateOnly = parseFacialReaction(atomicReaction());
  assertEquals(stateOnly.tag, "accepted");
  assertEquals(parseFacialReaction(atomicReaction({ qualifier: "standard" })), {
    tag: "rejected",
    reason: "invalid-reaction",
  });
  assertEquals(parseFacialReaction(atomicReaction({ gesture: "laugh" })), {
    tag: "rejected",
    reason: "invalid-reaction",
  });
  assertEquals(
    parseFacialReaction(atomicReaction({ gesture: "laugh", qualifier: "unknown" })),
    { tag: "rejected", reason: "invalid-reaction" },
  );

  for (const qualifier of LAUGHTER_QUALIFIERS) {
    const parsed = parseFacialReaction(atomicReaction({ gesture: "laugh", qualifier }));
    assertEquals(parsed.tag, "accepted");
    if (parsed.tag !== "accepted") continue;
    assertEquals(semanticAudioForReaction(parsed.reaction), {
      tag: "audible",
      family: "Laughter",
      qualifier,
    });
  }
});

Deno.test("character audio profiles require and resolve every independent audible slot", () => {
  assertEquals(CHARACTER_AUDIO_PROFILE_SLOTS, [
    "Happiness",
    "Sadness",
    "Worry",
    "Anger",
    "Surprise",
    "Laughter.standard",
    "Laughter.climactic",
  ]);
  const validation = validateCharacterAudioProfiles({
    "bot-steady": completeAudioProfile(),
    "human-default": completeAudioProfile("/human.mp3"),
  });
  assertEquals(validation.tag, "accepted");
  if (validation.tag !== "accepted") return;

  for (const slotName of CHARACTER_AUDIO_PROFILE_SLOTS) {
    const { [slotName]: _missing, ...incomplete } = completeAudioProfile();
    assertEquals(validateCharacterAudioProfiles({ active: incomplete }), {
      tag: "rejected",
      reason: "invalid-profile-catalog",
    });
  }

  const standardLaugh = parseFacialReaction(
    atomicReaction({ gesture: "laugh", qualifier: "standard" }),
  );
  if (standardLaugh.tag !== "accepted") return;
  const resolved = resolveCharacterAudioProfileSlot(
    validation.profiles,
    "bot-steady",
    semanticAudioForReaction(standardLaugh.reaction),
  );
  assertEquals(resolved.tag, "resolved");
  if (resolved.tag !== "resolved") return;
  assertEquals(resolved.profileId, "bot-steady");
  assertEquals(resolved.slotName, "Laughter.standard");
  assertEquals(resolved.slot, { src: "/shared.mp3", gain: 1 });
});

Deno.test("reaction and profile validation reject hostile inputs without partial snapshots", () => {
  for (
    const invalid of [
      atomicReaction({ lane: "main" }),
      atomicReaction({ durationMs: Number.NaN }),
      atomicReaction({ confidence: Number.POSITIVE_INFINITY }),
      atomicReaction({ identity: "" }),
      atomicReaction({ identity: 1 }),
    ]
  ) {
    assertEquals(parseFacialReaction(invalid), {
      tag: "rejected",
      reason: "invalid-reaction",
    });
  }

  const throwingReaction = atomicReaction();
  Object.defineProperty(throwingReaction, "state", {
    enumerable: true,
    get(): never {
      throw new Error("hostile reaction accessor");
    },
  });
  assertEquals(parseFacialReaction(throwingReaction), {
    tag: "rejected",
    reason: "invalid-reaction",
  });

  let identityReads = 0;
  const accessorReaction = atomicReaction();
  Object.defineProperty(accessorReaction, "identity", {
    enumerable: true,
    get(): string {
      identityReads++;
      return "accessor-identity";
    },
  });
  assertEquals(parseFacialReaction(accessorReaction).tag, "accepted");
  assertEquals(identityReads, 1);

  const throwingProfile = completeAudioProfile();
  Object.defineProperty(throwingProfile, "Happiness", {
    enumerable: true,
    get(): never {
      throw new Error("hostile profile accessor");
    },
  });
  for (
    const invalid of [
      { active: { ...completeAudioProfile(), unknown: { src: "/x.mp3", gain: 1 } } },
      { active: { ...completeAudioProfile(), Happiness: { src: "/x.mp3", gain: Number.NaN } } },
      { active: throwingProfile },
    ]
  ) {
    assertEquals(validateCharacterAudioProfiles(invalid), {
      tag: "rejected",
      reason: "invalid-profile-catalog",
    });
  }

  let slotReads = 0;
  const accessorProfile = completeAudioProfile();
  Object.defineProperty(accessorProfile, "Happiness", {
    enumerable: true,
    get(): Readonly<{ src: string; gain: number }> {
      slotReads++;
      return { src: "/happy.mp3", gain: 1 };
    },
  });
  assertEquals(validateCharacterAudioProfiles({ active: accessorProfile }).tag, "accepted");
  assertEquals(slotReads, 1);
});

Deno.test("parsed reaction equality is structural while identity remains exact", () => {
  const first = parseFacialReaction(JSON.parse(JSON.stringify(atomicReaction({ identity: "01" }))));
  const reordered = parseFacialReaction(JSON.parse(
    '{"confidence":0.8,"durationMs":900,"motion":"pop","intensity":2,' +
      '"kind":"TrickWon","state":"smile","identity":"01"}',
  ));
  const distinctIdentity = parseFacialReaction(atomicReaction({ identity: "1" }));
  if (
    first.tag !== "accepted" || reordered.tag !== "accepted" ||
    distinctIdentity.tag !== "accepted"
  ) return;

  const mainDelivery = { lane: "main", reaction: first.reaction } as const;
  const movedDelivery = { lane: "micro", reaction: reordered.reaction } as const;
  assertEquals(
    facialReactionPayloadEquals(mainDelivery.reaction, movedDelivery.reaction),
    true,
  );
  assertEquals(facialReactionIdentityEquals(first.reaction, reordered.reaction), true);
  assertEquals(facialReactionPayloadEquals(first.reaction, distinctIdentity.reaction), true);
  assertEquals(facialReactionIdentityEquals(first.reaction, distinctIdentity.reaction), false);

  for (
    const [leftIdentity, rightIdentity] of [
      [" identity ", "identity"],
      ["Reaction", "reaction"],
      ["Cafe\u0301", "Caf\u00e9"],
    ] as const
  ) {
    const left = parseFacialReaction(atomicReaction({ identity: leftIdentity }));
    const right = parseFacialReaction(atomicReaction({ identity: rightIdentity }));
    if (left.tag !== "accepted" || right.tag !== "accepted") return;
    assertEquals(facialReactionIdentityEquals(left.reaction, right.reaction), false);
  }
});

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

Deno.test("serialized rig protocol rejects incomplete and malformed atomic lanes", () => {
  const valid = {
    matchScope: "match-1",
    audioProfileId: "bot-steady",
    reaction: JSON.stringify(atomicReaction()),
    precedingReaction: "null",
    microReaction: "null",
  };
  assertEquals(parseSerializedRigProtocol(valid).tag, "accepted");
  for (
    const invalid of [
      { ...valid, reaction: undefined },
      { ...valid, reaction: "" },
      { ...valid, reaction: "{" },
      { ...valid, reaction: "undefined" },
      { ...valid, reaction: JSON.stringify(atomicReaction({ extra: true })) },
      { ...valid, reaction: JSON.stringify(atomicReaction({ state: "unknown" })) },
      { ...valid, matchScope: "" },
      { ...valid, audioProfileId: "" },
    ]
  ) {
    assertEquals(parseSerializedRigProtocol(invalid), {
      tag: "rejected",
      reason: "invalid-rig-protocol",
    });
  }
});

Deno.test("rig ledger sequences lanes and enforces exact identity across them", () => {
  const profiles = acceptedProfiles();
  const initial = seedRigState(
    protocol({
      main: acceptedReaction({ identity: "seed", state: "focused" }),
      preceding: acceptedReaction({ identity: "lead", state: "sad", durationMs: 40 }),
    }),
    profiles,
    "neutral",
  );
  assertEquals(initial.tag, "accepted");
  if (initial.tag !== "accepted") return;
  assertEquals(initial.effects, []);
  assertEquals([...initial.state.ledger.keys()], ["lead", "seed"]);

  const main = acceptedReaction({ identity: "main", state: "surprised" });
  const preceding = acceptedReaction({ identity: "preceding", state: "mad", durationMs: 40 });
  const micro = acceptedReaction({ identity: "micro", state: "worry" });
  const live = reduceRigSync(
    initial.state,
    protocol({ main, preceding, micro }),
    profiles,
    "neutral",
  );
  assertEquals(live.tag, "accepted");
  if (live.tag !== "accepted") return;
  assertEquals(live.effects.map((effect) => [effect.tag, effect.lane]), [
    ["start-macro", "preceding"],
    ["schedule-macro", "main"],
    ["start-micro", "micro"],
  ]);
  assertEquals(live.effects.map((effect) => effect.audio?.family ?? null), [
    "Anger",
    "Surprise",
    "Worry",
  ]);

  const moved = reduceRigSync(
    live.state,
    protocol({ micro: main }),
    profiles,
    "neutral",
  );
  assertEquals(moved.tag, "accepted");
  if (moved.tag !== "accepted") return;
  assertEquals(moved.effects, []);
  assertEquals(moved.state.rendered, {
    preceding: "neutral",
    main: "neutral",
    micro: "surprised",
  });

  const released = reduceRigSync(live.state, protocol(), profiles, "neutral");
  assertEquals(released.tag, "accepted");
  if (released.tag !== "accepted") return;
  assertEquals(released.effects, []);
  const restored = reduceRigSync(
    released.state,
    protocol({ main }),
    profiles,
    "neutral",
  );
  assertEquals(restored.tag, "accepted");
  if (restored.tag !== "accepted") return;
  assertEquals(restored.effects, []);
  assertEquals(restored.state.rendered.main, "surprised");

  const conflict = reduceRigSync(
    live.state,
    protocol({ main: { ...main, confidence: 0.5 } }),
    profiles,
    "neutral",
  );
  assertEquals(conflict.tag, "rejected");
  if (conflict.tag !== "rejected") return;
  assertEquals(conflict.reason, "reaction-identity-conflict");
  assertEquals(conflict.state, live.state);

  for (
    const identity of ["01", "1", " Reaction", "reaction", "Cafe\u0301", "Caf\u00e9"]
  ) {
    const next = reduceRigSync(
      live.state,
      protocol({ main: acceptedReaction({ identity, state: "smile" }) }),
      profiles,
      "neutral",
    );
    assertEquals(next.tag, "accepted", identity);
  }
});

Deno.test("rig transaction reserves once, gives laugh priority, and retries missing profiles", () => {
  const profiles = acceptedProfiles();
  const seeded = seedRigState(protocol(), profiles, "neutral");
  if (seeded.tag !== "accepted") throw new Error("seed rejected");
  const laugh = acceptedReaction({
    identity: "laugh-once",
    state: "surprised",
    gesture: "laugh",
    qualifier: "climactic",
  });
  const concurrentConflict = reduceRigSync(
    seeded.state,
    protocol({ main: { ...laugh, state: "mad" }, preceding: laugh }),
    profiles,
    "neutral",
  );
  assertEquals(concurrentConflict.tag, "rejected");
  if (concurrentConflict.tag !== "rejected") return;
  assertEquals(concurrentConflict.reason, "reaction-identity-conflict");
  assertEquals(concurrentConflict.state, seeded.state);

  const concurrent = reduceRigSync(
    seeded.state,
    protocol({ main: laugh, preceding: laugh }),
    profiles,
    "neutral",
  );
  assertEquals(concurrent.tag, "accepted");
  if (concurrent.tag !== "accepted") return;
  assertEquals(concurrent.effects.length, 1);
  assertEquals(concurrent.effects[0]?.lane, "preceding");
  const audio = concurrent.effects[0]?.audio;
  assertEquals(
    audio === null || audio === undefined ? audio : {
      ...audio,
      profileId: String(audio.profileId),
    },
    {
      family: "Laughter",
      qualifier: "climactic",
      profileId: "bot-steady",
      slotName: "Laughter.climactic",
      slot: { src: "/shared.mp3", gain: 1 },
    },
  );

  const missing = acceptedReaction({ identity: "retry", state: "smile" });
  const rejected = reduceRigSync(
    concurrent.state,
    protocol({ audioProfileId: "missing", main: missing }),
    profiles,
    "neutral",
  );
  assertEquals(rejected.tag, "rejected");
  if (rejected.tag !== "rejected") return;
  assertEquals(rejected.reason, "unknown-profile");
  assertEquals(rejected.state, concurrent.state);
  const retried = reduceRigSync(
    concurrent.state,
    protocol({ main: missing }),
    profiles,
    "neutral",
  );
  assertEquals(retried.tag, "accepted");
  if (retried.tag !== "accepted") return;
  assertEquals(retried.effects.length, 1);
  assertEquals(retried.state.ledger.has("retry"), true);

  const restored = setRigRenderedBaseline(retried.state, "smile");
  const sameMood = reduceRigSync(
    restored,
    protocol({ main: acceptedReaction({ identity: "same-mood", state: "smile" }) }),
    profiles,
    "smile",
  );
  assertEquals(sameMood.tag, "accepted");
  if (sameMood.tag !== "accepted") return;
  assertEquals(sameMood.effects[0]?.audio, null);
});

Deno.test("scope changes run live once and reject retired-scope rollback", () => {
  const profiles = acceptedProfiles();
  const scopeOne = seedRigState(
    protocol({ main: acceptedReaction({ identity: "scope-1", state: "sad" }) }),
    profiles,
    "neutral",
  );
  if (scopeOne.tag !== "accepted") throw new Error("seed rejected");
  const scopeTwoProtocol = protocol({
    matchScope: "match-2",
    main: acceptedReaction({ identity: "scope-2", state: "surprised" }),
  });
  const scopeTwo = reduceRigSync(scopeOne.state, scopeTwoProtocol, profiles, "neutral");
  assertEquals(scopeTwo.tag, "accepted");
  if (scopeTwo.tag !== "accepted") return;
  assertEquals(scopeTwo.effects.length, 1);
  assertEquals(scopeTwo.state.matchScope, "match-2");
  assertEquals(scopeTwo.state.retiredMatchScopes.has("match-1"), true);

  const rollback = reduceRigSync(
    scopeTwo.state,
    protocol({ main: acceptedReaction({ identity: "rollback", state: "mad" }) }),
    profiles,
    "neutral",
  );
  assertEquals(rollback.tag, "rejected");
  if (rollback.tag !== "rejected") return;
  assertEquals(rollback.reason, "retired-match-scope");
  assertEquals(rollback.state, scopeTwo.state);
});

Deno.test("audio reducer preserves per-kind intensity probabilities", () => {
  const request = {
    family: "Surprise",
    qualifier: null,
    intensity: 1,
    rigKind: "bot",
    rigId: "avatar-rig-east",
    seatId: "east",
    seatAudioProbability: 1,
  } as const;
  const decide = (rigKind: "bot" | "human-generated", intensity: number, sample: number) =>
    decideAudio(initialAudioPolicy(), { ...request, intensity, rigKind }, {
      audioEnabled: true,
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
      now: 1_000,
      randomSample: 0,
    }),
    { tag: "rejected", reason: "rig-kind" },
  );
});

Deno.test("audio reducer tracks active seats and semantic-family cooldowns", () => {
  const request = {
    family: "Laughter",
    qualifier: "climactic",
    intensity: 3,
    rigKind: "bot",
    rigId: "avatar-rig-east",
    seatId: "east",
    seatAudioProbability: 1,
  } as const;
  const context = (now: number) => ({
    audioEnabled: true,
    now,
    randomSample: 0,
  });
  const admitted = decideAudio(initialAudioPolicy(), request, context(1_000));
  assertEquals(admitted.tag, "admitted");
  if (admitted.tag !== "admitted") return;
  assertEquals({
    channelKey: admitted.channelKey,
    family: admitted.family,
    durationMs: admitted.durationMs,
  }, {
    channelKey: "east",
    family: "Laughter",
    durationMs: 1_800,
  });

  const active = audioStarted(admitted.nextState, admitted.channelKey);
  assertEquals(
    decideAudio(
      active,
      { ...request, family: "Surprise", qualifier: null, intensity: 1 },
      context(3_501),
    ),
    { tag: "rejected", reason: "seat-active" },
  );

  const secondSeat = decideAudio(
    active,
    { ...request, family: "Surprise", qualifier: null, intensity: 1, seatId: "west" },
    context(1_100),
  );
  assertEquals(secondSeat.tag, "admitted");
  if (secondSeat.tag !== "admitted") return;
  const full = audioStarted(secondSeat.nextState, secondSeat.channelKey);
  assertEquals(
    decideAudio(full, {
      ...request,
      family: "Anger",
      qualifier: null,
      intensity: 1,
      seatId: "north",
    }, context(1_100)),
    { tag: "rejected", reason: "channel-cap" },
  );

  const releasedWest = audioEnded(full, secondSeat.channelKey);
  const released = audioEnded(releasedWest, admitted.channelKey);
  assertEquals(released.activeSeats, {});

  const sameFamily = decideAudio(
    released,
    { ...request, family: "Surprise", qualifier: null, intensity: 1, seatId: "north" },
    context(1_200),
  );
  assertEquals(sameFamily, { tag: "rejected", reason: "family-cooldown" });
  const climacticBypass = decideAudio(
    released,
    { ...request, family: "Surprise", qualifier: null, intensity: 3, seatId: "north" },
    context(1_200),
  );
  assertEquals(climacticBypass.tag, "admitted");

  const normalLaugh = decideAudio(
    initialAudioPolicy(),
    { ...request, qualifier: "standard", intensity: 1, seatId: "normal-laugh" },
    context(2_000),
  );
  assertEquals(normalLaugh.tag === "admitted" ? normalLaugh.durationMs : null, 945);
});

Deno.test("audio reducer keeps a 600ms seat gap and prunes expired throttle state", () => {
  const request = {
    family: "Surprise",
    qualifier: null,
    intensity: 1,
    rigKind: "bot",
    rigId: "avatar-rig-east",
    seatId: "east",
    seatAudioProbability: 1,
  } as const;
  const context = (now: number) => ({
    audioEnabled: true,
    now,
    randomSample: 0,
  });
  const first = decideAudio(initialAudioPolicy(), request, context(1_000));
  assertEquals(first.tag, "admitted");
  if (first.tag !== "admitted") return;
  assertEquals(
    decideAudio(first.nextState, { ...request, family: "Anger" }, context(1_599)),
    { tag: "rejected", reason: "seat-cooldown" },
  );
  assertEquals(
    decideAudio(first.nextState, { ...request, family: "Anger" }, context(1_600)).tag,
    "admitted",
  );

  const pruned = decideAudio(
    {
      activeSeats: {},
      familyCooldownUntil: { expired: 3_999, recent: 4_001 },
      seatPlayedAt: { stale: 3_399, recent: 3_999 },
    },
    { ...request, seatId: "new" },
    context(4_000),
  );
  assertEquals(pruned.tag, "admitted");
  if (pruned.tag !== "admitted") return;
  assertEquals(pruned.nextState.familyCooldownUntil, { recent: 4_001, Surprise: 4_900 });
  assertEquals(pruned.nextState.seatPlayedAt, { recent: 3_999, new: 4_000 });
});
