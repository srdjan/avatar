import {
  CHARACTER_AUDIO_PROFILE_SLOTS,
  type CharacterAudioProfile,
  type CharacterAudioProfileCatalog,
  type CharacterAudioProfileId,
  type CharacterAudioProfileSlot,
  type CharacterAudioProfileSlotName,
  FACIAL_REACTION_GESTURES,
  FACIAL_REACTION_STATES,
  type FacialReaction,
  type FacialReactionState,
  LAUGHTER_QUALIFIERS,
  type LaughterQualifier,
  parseCharacterAudioProfileId,
  parseFacialReactionIdentity,
  type PersistentSemanticAudioFamily,
  RIG_CONTROL_FEATURES,
  RIG_CONTROL_PRESETS,
  type RigControlFeature,
  type RigControlFeatureValues,
  type RigControlPreset,
  type RigControlRejectionReason,
  type RigIntensity,
  type SemanticAudioDecision,
  type SemanticAudioFamily,
  type StateSemanticAudio,
} from "../types.ts";

const STATE_SEMANTIC_AUDIO = {
  neutral: { tag: "silent" },
  focused: { tag: "silent" },
  smile: { tag: "audible", family: "Happiness" },
  sad: { tag: "audible", family: "Sadness" },
  worry: { tag: "audible", family: "Worry" },
  mad: { tag: "audible", family: "Anger" },
  surprised: { tag: "audible", family: "Surprise" },
} as const satisfies Readonly<Record<FacialReactionState, StateSemanticAudio>>;

const PROFILE_SLOT_BY_FAMILY = {
  Happiness: "Happiness",
  Sadness: "Sadness",
  Worry: "Worry",
  Anger: "Anger",
  Surprise: "Surprise",
} as const satisfies Readonly<
  Record<PersistentSemanticAudioFamily, CharacterAudioProfileSlotName>
>;

const PROFILE_SLOT_BY_LAUGHTER_QUALIFIER = {
  standard: "Laughter.standard",
  climactic: "Laughter.climactic",
} as const satisfies Readonly<Record<LaughterQualifier, CharacterAudioProfileSlotName>>;

const FACIAL_REACTION_BASE_KEYS = [
  "identity",
  "state",
  "kind",
  "intensity",
  "motion",
  "durationMs",
  "confidence",
] as const;

const FACIAL_REACTION_LAUGH_KEYS = [
  ...FACIAL_REACTION_BASE_KEYS,
  "gesture",
  "qualifier",
] as const;

const RIG_MOTIONS = ["pop", "shake", "sink"] as const;

export type FacialReactionValidationResult =
  | Readonly<{ tag: "accepted"; reaction: FacialReaction }>
  | Readonly<{ tag: "rejected"; reason: "invalid-reaction" }>;

export type CharacterAudioProfilesValidationResult =
  | Readonly<{ tag: "accepted"; profiles: CharacterAudioProfileCatalog }>
  | Readonly<{ tag: "rejected"; reason: "invalid-profile-catalog" }>;

export type CharacterAudioProfileResolution =
  | Readonly<{
    tag: "resolved";
    profileId: CharacterAudioProfileId;
    slotName: CharacterAudioProfileSlotName;
    slot: CharacterAudioProfileSlot;
  }>
  | Readonly<{ tag: "silent"; profileId: CharacterAudioProfileId }>
  | Readonly<{
    tag: "rejected";
    reason: "invalid-profile-id" | "unknown-profile";
  }>;

export function semanticAudioForState(state: FacialReactionState): StateSemanticAudio {
  return STATE_SEMANTIC_AUDIO[state];
}

export function semanticAudioForReaction(reaction: FacialReaction): SemanticAudioDecision {
  return reaction.gesture === "laugh"
    ? { tag: "audible", family: "Laughter", qualifier: reaction.qualifier }
    : semanticAudioForState(reaction.state);
}

export function isLaughterQualifier(input: unknown): input is LaughterQualifier {
  return isOneOf(input, LAUGHTER_QUALIFIERS);
}

export function parseFacialReaction(input: unknown): FacialReactionValidationResult {
  try {
    return parseFacialReactionUnchecked(input);
  } catch {
    return invalidFacialReaction();
  }
}

function parseFacialReactionUnchecked(input: unknown): FacialReactionValidationResult {
  ensure(isRecord(input));
  const hasGesture = Object.hasOwn(input, "gesture");
  const expectedKeys = [FACIAL_REACTION_BASE_KEYS, FACIAL_REACTION_LAUGH_KEYS][
    Number(hasGesture)
  ]!;
  ensure(hasExactOwnKeys(input, expectedKeys));

  const identity = parseFacialReactionIdentity(input.identity);
  const state = input.state;
  const kind = input.kind;
  const intensity = input.intensity;
  const motion = input.motion;
  const durationMs = input.durationMs;
  const confidence = input.confidence;
  ensure(identity.tag === "accepted");
  ensure(isOneOf(state, FACIAL_REACTION_STATES));
  ensure(typeof kind === "string");
  ensure(isRigIntensity(intensity));
  ensure(isOneOf(motion, RIG_MOTIONS));
  ensure(isPositiveFiniteNumber(durationMs));
  ensure(numberInRange(confidence, 0, 1));

  const metadata = {
    identity: identity.identity,
    state,
    kind,
    intensity,
    motion,
    durationMs,
    confidence,
  } as const;
  return hasGesture
    ? parseFacialReactionGesture(input, metadata)
    : { tag: "accepted", reaction: Object.freeze(metadata) };
}

function parseFacialReactionGesture(
  input: Readonly<Record<string, unknown>>,
  metadata: Omit<FacialReaction, "gesture" | "qualifier">,
): FacialReactionValidationResult {
  const gesture = input.gesture;
  const qualifier = input.qualifier;
  ensure(isOneOf(gesture, FACIAL_REACTION_GESTURES));
  ensure(isLaughterQualifier(qualifier));
  return {
    tag: "accepted",
    reaction: Object.freeze({ ...metadata, gesture, qualifier }),
  };
}

export function validateCharacterAudioProfiles(
  input: unknown,
): CharacterAudioProfilesValidationResult {
  try {
    return validateCharacterAudioProfilesUnchecked(input);
  } catch {
    return invalidCharacterAudioProfiles();
  }
}

function validateCharacterAudioProfilesUnchecked(
  input: unknown,
): CharacterAudioProfilesValidationResult {
  ensure(isRecord(input));
  const rawProfileIds = Reflect.ownKeys(input);
  ensure([
    rawProfileIds.length > 0,
    rawProfileIds.every((profileId) => typeof profileId === "string"),
  ].every(Boolean));

  const profiles = (rawProfileIds as string[]).map((rawProfileId) => {
    const profileId = parseCharacterAudioProfileId(rawProfileId);
    ensure(profileId.tag === "accepted");
    return [profileId.profileId, parseCharacterAudioProfile(input[rawProfileId])] as const;
  });
  return {
    tag: "accepted",
    profiles: Object.freeze(Object.fromEntries(profiles)),
  };
}

function parseCharacterAudioProfile(input: unknown): CharacterAudioProfile {
  ensure(isRecord(input));
  ensure(hasExactOwnKeys(input, CHARACTER_AUDIO_PROFILE_SLOTS));
  const slots = CHARACTER_AUDIO_PROFILE_SLOTS.map((slotName) =>
    [slotName, parseCharacterAudioProfileSlot(input[slotName])] as const
  );
  return Object.freeze(Object.fromEntries(slots)) as CharacterAudioProfile;
}

function parseCharacterAudioProfileSlot(input: unknown): CharacterAudioProfileSlot {
  ensure(isRecord(input));
  ensure(hasExactOwnKeys(input, ["src", "gain"]));
  const src = input.src;
  const gain = input.gain;
  ensure(isNonEmptyString(src));
  ensure(numberInRange(gain, 0, 1));
  return Object.freeze({ src, gain });
}

export function resolveCharacterAudioProfileSlot(
  profiles: CharacterAudioProfileCatalog,
  rawProfileId: string,
  semantic: SemanticAudioDecision,
): CharacterAudioProfileResolution {
  const profileId = parseCharacterAudioProfileId(rawProfileId);
  if (profileId.tag !== "accepted") {
    return { tag: "rejected", reason: "invalid-profile-id" };
  }
  if (!Object.hasOwn(profiles, profileId.profileId)) {
    return { tag: "rejected", reason: "unknown-profile" };
  }
  if (semantic.tag === "silent") {
    return { tag: "silent", profileId: profileId.profileId };
  }
  const slotName = semantic.family === "Laughter"
    ? PROFILE_SLOT_BY_LAUGHTER_QUALIFIER[semantic.qualifier]
    : PROFILE_SLOT_BY_FAMILY[semantic.family];
  return {
    tag: "resolved",
    profileId: profileId.profileId,
    slotName,
    slot: profiles[profileId.profileId]![slotName],
  };
}

export function facialReactionIdentityEquals(
  left: FacialReaction,
  right: FacialReaction,
): boolean {
  return left.identity === right.identity;
}

export function facialReactionPayloadEquals(
  left: FacialReaction,
  right: FacialReaction,
): boolean {
  return [
    left.state === right.state,
    left.kind === right.kind,
    left.intensity === right.intensity,
    left.motion === right.motion,
    left.durationMs === right.durationMs,
    left.confidence === right.confidence,
    left.gesture === right.gesture,
    left.qualifier === right.qualifier,
  ].every(Boolean);
}

function hasExactOwnKeys(
  input: Readonly<Record<string, unknown>>,
  expected: ReadonlyArray<string>,
): boolean {
  const keys = Reflect.ownKeys(input);
  return [
    keys.length === expected.length,
    keys.every((key) => [typeof key === "string", expected.includes(key as string)].every(Boolean)),
  ].every(Boolean);
}

function isRigIntensity(input: unknown): input is RigIntensity {
  return ([1, 2, 3] as ReadonlyArray<unknown>).includes(input);
}

function isPositiveFiniteNumber(input: unknown): input is number {
  return [
    typeof input === "number",
    Number.isFinite(input),
    (input as number) > 0,
  ].every(Boolean);
}

const BOUNDARY_REJECTION = Symbol("boundary-rejection");

function ensure(condition: boolean, reason: unknown = BOUNDARY_REJECTION): asserts condition {
  if (!condition) throw reason;
}

function invalidFacialReaction(): FacialReactionValidationResult {
  return { tag: "rejected", reason: "invalid-reaction" };
}

function invalidCharacterAudioProfiles(): CharacterAudioProfilesValidationResult {
  return { tag: "rejected", reason: "invalid-profile-catalog" };
}

export type RigKind = "bot" | "human-generated" | "human-photo" | "unknown";

export const RIG_REACTION_LANES = ["preceding", "main", "micro"] as const;

export type RigReactionLane = (typeof RIG_REACTION_LANES)[number];

export type RigProtocol = Readonly<{
  matchScope: string;
  audioProfileId: string;
  main: FacialReaction | null;
  preceding: FacialReaction | null;
  micro: FacialReaction | null;
}>;

export type SerializedRigProtocol = Readonly<{
  matchScope?: unknown;
  audioProfileId?: unknown;
  reaction?: unknown;
  precedingReaction?: unknown;
  microReaction?: unknown;
}>;

export type RigProtocolParseResult =
  | Readonly<{ tag: "accepted"; protocol: RigProtocol }>
  | Readonly<{ tag: "rejected"; reason: "invalid-rig-protocol" }>;

export function parseSerializedRigProtocol(input: SerializedRigProtocol): RigProtocolParseResult {
  try {
    const matchScope = input.matchScope;
    const audioProfileId = input.audioProfileId;
    const parsedProfileId = parseCharacterAudioProfileId(audioProfileId);
    ensure(isNonEmptyString(matchScope));
    ensure(parsedProfileId.tag === "accepted");
    const main = parseSerializedReaction(input.reaction);
    const preceding = parseSerializedReaction(input.precedingReaction);
    const micro = parseSerializedReaction(input.microReaction);
    return {
      tag: "accepted",
      protocol: {
        matchScope,
        audioProfileId: parsedProfileId.profileId,
        main,
        preceding,
        micro,
      },
    };
  } catch {
    return invalidRigProtocol();
  }
}

function parseSerializedReaction(input: unknown): FacialReaction | null {
  ensure(typeof input === "string");
  ensure(input.length > 0);
  const parsed: unknown = JSON.parse(input);
  if (parsed === null) return null;
  const reaction = parseFacialReaction(parsed);
  ensure(reaction.tag === "accepted");
  return reaction.reaction;
}

function invalidRigProtocol(): RigProtocolParseResult {
  return { tag: "rejected", reason: "invalid-rig-protocol" };
}

export type ResolvedSemanticAudioCandidate = Readonly<{
  family: SemanticAudioFamily;
  qualifier: LaughterQualifier | null;
  profileId: CharacterAudioProfileId;
  slotName: CharacterAudioProfileSlotName;
  slot: CharacterAudioProfileSlot;
}>;

type RenderedLaneStates = Readonly<Record<RigReactionLane, FacialReactionState>>;

export type RigState = Readonly<{
  matchScope: string;
  retiredMatchScopes: ReadonlySet<string>;
  ledger: ReadonlyMap<string, FacialReaction>;
  rendered: RenderedLaneStates;
}>;

type RigEffectBase = Readonly<{
  lane: RigReactionLane;
  reaction: FacialReaction;
  audio: ResolvedSemanticAudioCandidate | null;
}>;

export type RigEffect =
  | Readonly<{ tag: "start-macro" } & RigEffectBase>
  | Readonly<{ tag: "schedule-macro"; delayMs: number } & RigEffectBase>
  | Readonly<{ tag: "start-micro" } & RigEffectBase>;

export type RigTransitionRejectionReason =
  | "invalid-profile-id"
  | "unknown-profile"
  | "reaction-identity-conflict"
  | "retired-match-scope";

export type RigTransition =
  | Readonly<{
    tag: "accepted";
    state: RigState;
    effects: ReadonlyArray<RigEffect>;
  }>
  | Readonly<{
    tag: "rejected";
    state: RigState;
    reason: RigTransitionRejectionReason;
  }>;

export function seedRigState(
  protocol: RigProtocol,
  profiles: CharacterAudioProfileCatalog,
  restingState: FacialReactionState,
): RigTransition {
  const state: RigState = {
    matchScope: protocol.matchScope,
    retiredMatchScopes: new Set(),
    ledger: new Map(),
    rendered: renderedBaseline(restingState),
  };
  return transitionRigState(state, protocol, profiles, restingState, true);
}

export function reduceRigSync(
  state: RigState,
  protocol: RigProtocol,
  profiles: CharacterAudioProfileCatalog,
  restingState: FacialReactionState,
): RigTransition {
  const transitionNewScope = () => {
    const nextScopeState: RigState = {
      matchScope: protocol.matchScope,
      retiredMatchScopes: new Set([...state.retiredMatchScopes, state.matchScope]),
      ledger: new Map(),
      rendered: renderedBaseline(restingState),
    };
    const transitioned = transitionRigState(
      nextScopeState,
      protocol,
      profiles,
      restingState,
      false,
    );
    return transitioned.tag === "rejected" ? { ...transitioned, state } : transitioned;
  };
  const transitionByScope = [
    transitionNewScope,
    () => rejectedRigTransition(state, "retired-match-scope"),
    () => transitionRigState(state, protocol, profiles, restingState, false),
  ] as const;
  const scopeIndex = Number(protocol.matchScope === state.matchScope) * 2 +
    Number(state.retiredMatchScopes.has(protocol.matchScope));
  return transitionByScope[scopeIndex]!();
}

export function setRigRenderedBaseline(
  state: RigState,
  baseline: FacialReactionState,
): RigState {
  return { ...state, rendered: renderedBaseline(baseline) };
}

function renderedBaseline(state: FacialReactionState): RenderedLaneStates {
  return { preceding: state, main: state, micro: state };
}

type AcceptedLane = Readonly<{
  lane: RigReactionLane;
  reaction: FacialReaction;
  audio: ResolvedSemanticAudioCandidate | null;
}>;

type DeliveredLane = Readonly<{
  lane: RigReactionLane;
  reaction: FacialReaction;
}>;

function transitionRigState(
  state: RigState,
  protocol: RigProtocol,
  profiles: CharacterAudioProfileCatalog,
  restingState: FacialReactionState,
  hydration: boolean,
): RigTransition {
  try {
    const delivered = RIG_REACTION_LANES
      .map((lane) => ({ lane, reaction: protocol[lane] }))
      .filter((entry): entry is DeliveredLane => entry.reaction !== null);
    const knownPayloadById = new Map(state.ledger);
    delivered.forEach(({ reaction }) => {
      const seen = knownPayloadById.get(reaction.identity);
      const comparable = [reaction, seen as FacialReaction][Number(seen !== undefined)]!;
      ensure(
        facialReactionPayloadEquals(comparable, reaction),
        "reaction-identity-conflict",
      );
      knownPayloadById.set(reaction.identity, reaction);
    });

    const ledger = new Map(state.ledger);
    const distinct = [...new Map(
      [...delivered].reverse().map((entry) => [entry.reaction.identity, entry]),
    ).values()].reverse();
    const accepted = distinct
      .filter(({ reaction }) => !ledger.has(reaction.identity))
      .map(({ lane, reaction }): AcceptedLane => {
        const audio = resolveRigAudioCandidate(
          profiles,
          protocol.audioProfileId,
          reaction,
          state.rendered[lane],
        );
        ensure(
          audio.tag === "resolved",
          (audio as Extract<RigAudioCandidateResolution, { tag: "rejected" }>).reason,
        );
        ledger.set(reaction.identity, reaction);
        return { lane, reaction, audio: audio.candidate };
      });
    const rendered = Object.fromEntries(
      RIG_REACTION_LANES.map((lane) => [
        lane,
        protocol[lane] === null ? restingState : protocol[lane].state,
      ]),
    ) as unknown as RenderedLaneStates;
    const effects = [rigEffects(accepted), []][Number(hydration)] as ReadonlyArray<RigEffect>;
    return {
      tag: "accepted",
      state: { ...state, ledger, rendered },
      effects,
    };
  } catch (reason) {
    return rejectedRigTransition(state, reason as RigTransitionRejectionReason);
  }
}

type RigAudioCandidateResolution =
  | Readonly<{ tag: "resolved"; candidate: ResolvedSemanticAudioCandidate | null }>
  | Readonly<{
    tag: "rejected";
    reason: Extract<RigTransitionRejectionReason, "invalid-profile-id" | "unknown-profile">;
  }>;

function resolveRigAudioCandidate(
  profiles: CharacterAudioProfileCatalog,
  profileId: string,
  reaction: FacialReaction,
  renderedState: FacialReactionState,
): RigAudioCandidateResolution {
  const semantic = semanticAudioForReaction(reaction);
  const changesMeaning = [
    reaction.gesture === "laugh",
    reaction.state !== renderedState,
  ].some(Boolean);
  const eligibleSemantic = [{ tag: "silent" } as const, semantic][Number(changesMeaning)]!;
  const resolution = resolveCharacterAudioProfileSlot(profiles, profileId, eligibleSemantic);
  if (resolution.tag === "rejected") return resolution;
  if (resolution.tag === "silent") return { tag: "resolved", candidate: null };
  ensure(eligibleSemantic.tag === "audible");
  return {
    tag: "resolved",
    candidate: {
      family: eligibleSemantic.family,
      qualifier: eligibleSemantic.family === "Laughter" ? eligibleSemantic.qualifier : null,
      profileId: resolution.profileId,
      slotName: resolution.slotName,
      slot: resolution.slot,
    },
  };
}

function rejectedRigTransition(
  state: RigState,
  reason: RigTransitionRejectionReason,
): RigTransition {
  return { tag: "rejected", state, reason };
}

function rigEffects(accepted: ReadonlyArray<AcceptedLane>): RigEffect[] {
  const macros = accepted.filter((entry) => entry.lane !== "micro");
  const precedingDuration = accepted
    .filter((entry) => entry.lane === "preceding")
    .map((entry) => entry.reaction.durationMs)[0] as number;
  const macroBuilders = [
    (entry: AcceptedLane): RigEffect => ({ tag: "start-macro", ...entry }),
    (entry: AcceptedLane): RigEffect => ({
      tag: "schedule-macro",
      ...entry,
      delayMs: precedingDuration,
    }),
  ] as const;
  const macroEffects = macros.map((entry, index) => macroBuilders[Math.min(index, 1)]!(entry));
  const microEffects = accepted
    .filter((entry) => entry.lane === "micro")
    .map((entry): RigEffect => ({ tag: "start-micro", ...entry }));
  return [...macroEffects, ...microEffects];
}

export type ParsedRigControlCommand =
  | Readonly<{
    tag: "set";
    rigId: string;
    sourceId: string;
    sequence: number;
    preset: RigControlPreset;
    features: RigControlFeatureValues;
    transitionMs: number;
  }>
  | Readonly<{
    tag: "release";
    rigId: string;
    sourceId: string;
    sequence: number;
    transitionMs: number;
  }>;

export type RigControlParseResult =
  | Readonly<{ tag: "parsed"; command: ParsedRigControlCommand }>
  | Readonly<{ tag: "rejected"; reason: "invalid-command" }>;

export type RigControlState = Readonly<{
  ownerSourceId: string | null;
  lastSequenceBySource: Readonly<Record<string, number>>;
  affect: Extract<ParsedRigControlCommand, { tag: "set" }> | null;
}>;

export type RigControlEffect =
  | Readonly<{
    tag: "set-affect";
    command: Extract<ParsedRigControlCommand, { tag: "set" }>;
  }>
  | Readonly<{ tag: "release-affect"; transitionMs: number }>;

export type RigControlTransition = Readonly<{
  state: RigControlState;
  decision:
    | Readonly<{ tag: "accepted" }>
    | Readonly<{
      tag: "rejected";
      reason: Extract<RigControlRejectionReason, "stale-sequence" | "source-busy">;
    }>;
  effects: ReadonlyArray<RigControlEffect>;
}>;

export type RigControlPose = Readonly<{
  features: Readonly<Record<RigControlFeature, number>>;
  eyes: Readonly<{ translateY: number; scaleY: number }>;
  brows: Readonly<{ translateY: number; scaleY: number }>;
  mouth: Readonly<{ translateY: number; scaleX: number; scaleY: number }>;
  layer: Readonly<{
    translateX: number;
    translateY: number;
    rotate: number;
    scale: number;
  }>;
}>;

type FullFeatureValues = Readonly<Record<RigControlFeature, number>>;

const EMPTY_FEATURES: FullFeatureValues = Object.freeze({
  browInnerRaise: 0,
  browLower: 0,
  eyeWiden: 0,
  eyeSquint: 0,
  cheekRaise: 0,
  mouthCornerLift: 0,
  mouthCornerDrop: 0,
  jawOpen: 0,
});

const CONTROL_PRESET_FEATURES = {
  neutral: EMPTY_FEATURES,
  focused: {
    ...EMPTY_FEATURES,
    browLower: 0.35,
    eyeSquint: 0.22,
  },
  smile: {
    ...EMPTY_FEATURES,
    browInnerRaise: 0.1,
    eyeSquint: 0.2,
    cheekRaise: 0.45,
    mouthCornerLift: 0.65,
    jawOpen: 0.08,
  },
  sad: {
    ...EMPTY_FEATURES,
    browInnerRaise: 0.55,
    eyeSquint: 0.1,
    mouthCornerDrop: 0.55,
  },
  worry: {
    ...EMPTY_FEATURES,
    browInnerRaise: 0.75,
    eyeWiden: 0.45,
    mouthCornerDrop: 0.25,
    jawOpen: 0.08,
  },
  mad: {
    ...EMPTY_FEATURES,
    browLower: 0.8,
    eyeSquint: 0.55,
    mouthCornerDrop: 0.3,
  },
  surprised: {
    ...EMPTY_FEATURES,
    browInnerRaise: 0.7,
    eyeWiden: 0.85,
    jawOpen: 0.8,
  },
} as const satisfies Readonly<Record<RigControlPreset, FullFeatureValues>>;

const CONTROL_PRESET_LAYER = {
  neutral: [0, 0, 0, 1],
  focused: [0.4, 0, -0.5, 1],
  smile: [0, -1, -1, 1.02],
  sad: [0, 1.5, 1.5, 0.99],
  worry: [0, -0.5, 2, 1.01],
  mad: [-0.8, 0, -2, 1.01],
  surprised: [0, -2, 0, 1.04],
} as const satisfies Readonly<Record<RigControlPreset, readonly [number, number, number, number]>>;

export function parseRigControlCommand(input: unknown): RigControlParseResult {
  try {
    return parseRigControlCommandUnchecked(input);
  } catch {
    return invalidControlCommand();
  }
}

type ControlEnvelopeSnapshot = Readonly<{
  tag: unknown;
  rigId: unknown;
  sourceId: unknown;
  sequence: unknown;
}>;

type ValidControlEnvelope = Readonly<{
  tag: unknown;
  rigId: string;
  sourceId: string;
  sequence: number;
}>;

function parseRigControlCommandUnchecked(input: unknown): RigControlParseResult {
  if (!isRecord(input)) return invalidControlCommand();
  const envelope: ControlEnvelopeSnapshot = {
    tag: input.tag,
    rigId: input.rigId,
    sourceId: input.sourceId,
    sequence: input.sequence,
  };
  if (!hasControlEnvelope(envelope)) return invalidControlCommand();
  switch (envelope.tag) {
    case "set":
      return parseSetControlCommand(input, envelope);
    case "release":
      return parseReleaseControlCommand(input, envelope);
    default:
      return invalidControlCommand();
  }
}

function parseSetControlCommand(
  input: Readonly<Record<string, unknown>>,
  envelope: ValidControlEnvelope,
): RigControlParseResult {
  const preset = input.preset;
  const rawFeatures = input.features;
  const rawTransitionMs = input.transitionMs;
  if (
    !hasOnlyKeys(input, [
      "tag",
      "rigId",
      "sourceId",
      "sequence",
      "preset",
      "features",
      "transitionMs",
    ]) ||
    !isOneOf(preset, RIG_CONTROL_PRESETS)
  ) return invalidControlCommand();
  const features = parseControlFeatures(rawFeatures);
  const transitionMs = optionalNumberInRange(rawTransitionMs, 180, 0, 2_000);
  if (features === null || transitionMs === null) return invalidControlCommand();
  return {
    tag: "parsed",
    command: {
      tag: "set",
      rigId: envelope.rigId,
      sourceId: envelope.sourceId,
      sequence: envelope.sequence,
      preset,
      features,
      transitionMs,
    },
  };
}

function parseReleaseControlCommand(
  input: Readonly<Record<string, unknown>>,
  envelope: ValidControlEnvelope,
): RigControlParseResult {
  const rawTransitionMs = input.transitionMs;
  if (!hasOnlyKeys(input, ["tag", "rigId", "sourceId", "sequence", "transitionMs"])) {
    return invalidControlCommand();
  }
  const transitionMs = optionalNumberInRange(rawTransitionMs, 180, 0, 2_000);
  if (transitionMs === null) return invalidControlCommand();
  return {
    tag: "parsed",
    command: {
      tag: "release",
      rigId: envelope.rigId,
      sourceId: envelope.sourceId,
      sequence: envelope.sequence,
      transitionMs,
    },
  };
}

function hasControlEnvelope(input: ControlEnvelopeSnapshot): input is ValidControlEnvelope {
  const sequence = typeof input.sequence === "number" ? input.sequence : -1;
  return [
    isNonEmptyString(input.rigId),
    isNonEmptyString(input.sourceId),
    Number.isSafeInteger(sequence),
    sequence >= 0,
  ].every(Boolean);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" ? value.length > 0 : false;
}

function parseControlFeatures(value: unknown): RigControlFeatureValues | null {
  if (value === undefined) return {};
  if (!isRecord(value) || !hasOnlyKeys(value, RIG_CONTROL_FEATURES)) return null;
  const entries: Array<readonly [RigControlFeature, number]> = [];
  for (const feature of RIG_CONTROL_FEATURES) {
    const coefficient = value[feature];
    if (coefficient === undefined) continue;
    if (!numberInRange(coefficient, 0, 1)) return null;
    entries.push([feature, coefficient]);
  }
  return Object.fromEntries(entries);
}

function optionalNumberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (value === undefined) return fallback;
  return numberInRange(value, min, max) ? value : null;
}

function numberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function hasOnlyKeys(
  input: Readonly<Record<string, unknown>>,
  allowed: ReadonlyArray<string>,
): boolean {
  return Object.keys(input).every((key) => allowed.includes(key));
}

function isOneOf<const Value extends string>(
  value: unknown,
  allowed: ReadonlyArray<Value>,
): value is Value {
  return typeof value === "string" && allowed.includes(value as Value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function invalidControlCommand(): RigControlParseResult {
  return { tag: "rejected", reason: "invalid-command" };
}

export function initialRigControlState(): RigControlState {
  return {
    ownerSourceId: null,
    lastSequenceBySource: {},
    affect: null,
  };
}

export function reduceRigControl(
  state: RigControlState,
  command: ParsedRigControlCommand,
): RigControlTransition {
  const previousSequence = Object.getOwnPropertyDescriptor(
    state.lastSequenceBySource,
    command.sourceId,
  )?.value as number | undefined;
  if (previousSequence !== undefined && command.sequence <= previousSequence) {
    return rejectedControlTransition(state, "stale-sequence");
  }
  if (state.ownerSourceId !== null && state.ownerSourceId !== command.sourceId) {
    return rejectedControlTransition(state, "source-busy");
  }
  const sequenced = {
    ...state,
    lastSequenceBySource: {
      ...state.lastSequenceBySource,
      [command.sourceId]: command.sequence,
    },
  };
  switch (command.tag) {
    case "set":
      return {
        state: { ...sequenced, ownerSourceId: command.sourceId, affect: command },
        decision: { tag: "accepted" },
        effects: [{ tag: "set-affect", command }],
      };
    case "release":
      return {
        state: { ...sequenced, ownerSourceId: null, affect: null },
        decision: { tag: "accepted" },
        effects: [{ tag: "release-affect", transitionMs: command.transitionMs }],
      };
  }
}

function rejectedControlTransition(
  state: RigControlState,
  reason: "stale-sequence" | "source-busy",
): RigControlTransition {
  return { state, decision: { tag: "rejected", reason }, effects: [] };
}

export function compileRigControlPose(
  preset: RigControlPreset,
  overrides: RigControlFeatureValues,
  amplitude: number,
): RigControlPose {
  const features = { ...CONTROL_PRESET_FEATURES[preset], ...overrides };
  const safeAmplitude = Number.isFinite(amplitude) ? Math.max(0, amplitude) : 1;
  const eyesScaleY = 1 + features.eyeWiden * 0.4 - features.eyeSquint * 0.5 -
    features.cheekRaise * 0.2;
  const browsScaleY = 1 + features.browInnerRaise * 0.15 - features.browLower * 0.1;
  const mouthScaleX = 1 + (features.mouthCornerLift - features.mouthCornerDrop) * 0.08;
  const [translateX, translateY, rotate, scale] = CONTROL_PRESET_LAYER[preset];
  return {
    features,
    eyes: {
      translateY: scaledLinear(-features.cheekRaise, safeAmplitude),
      scaleY: scaledFromOne(eyesScaleY, safeAmplitude),
    },
    brows: {
      translateY: scaledLinear(
        -features.browInnerRaise * 6 + features.browLower * 5,
        safeAmplitude,
      ),
      scaleY: scaledFromOne(browsScaleY, safeAmplitude),
    },
    mouth: {
      translateY: scaledLinear(
        -features.mouthCornerLift * 2 + features.mouthCornerDrop * 2,
        safeAmplitude,
      ),
      scaleX: scaledFromOne(mouthScaleX, safeAmplitude),
      scaleY: scaledFromOne(1 + features.jawOpen * 0.8, safeAmplitude),
    },
    layer: {
      translateX: scaledLinear(translateX, safeAmplitude),
      translateY: scaledLinear(translateY, safeAmplitude),
      rotate: scaledLinear(rotate, safeAmplitude),
      scale: scaledFromOne(scale, safeAmplitude),
    },
  };
}

function scaledLinear(value: number, amplitude: number): number {
  return roundedControlNumber(value * amplitude);
}

function scaledFromOne(value: number, amplitude: number): number {
  return roundedControlNumber(1 + (value - 1) * amplitude);
}

function roundedControlNumber(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export type AudioPolicyState = Readonly<{
  activeSeats: Readonly<Record<string, true>>;
  familyCooldownUntil: Readonly<Record<string, number>>;
  seatPlayedAt: Readonly<Record<string, number>>;
}>;

type AudioRequestMetadata = Readonly<{
  intensity: number;
  rigKind: RigKind;
  rigId: string;
  seatId: string;
  seatAudioProbability: number;
}>;

export type AudioRequest =
  | Readonly<
    & AudioRequestMetadata
    & { family: "Laughter"; qualifier: LaughterQualifier }
  >
  | Readonly<
    & AudioRequestMetadata
    & { family: PersistentSemanticAudioFamily; qualifier: null }
  >;

export type AudioDecision =
  | Readonly<{
    tag: "rejected";
    reason:
      | "disabled"
      | "rig-kind"
      | "channel-cap"
      | "probability"
      | "seat-active"
      | "seat-cooldown"
      | "family-cooldown";
  }>
  | Readonly<{
    tag: "admitted";
    channelKey: string;
    family: SemanticAudioFamily;
    durationMs: number;
    nextState: AudioPolicyState;
  }>;

type AudioRejection = Extract<AudioDecision, { tag: "rejected" }>;
type AudioCandidate = Readonly<{ tag: "candidate" }>;

type AudioDecisionContext = Readonly<{
  audioEnabled: boolean;
  now: number;
  randomSample: number;
}>;

const AUDIO_CHANNEL_CAP = 2;
const AUDIO_SEAT_COOLDOWN_MS = 600;
const AUDIO_CUE_COOLDOWN_MS = [900, 1_400, 2_200] as const;
const AUDIO_PROBABILITY_BY_KIND: Readonly<
  Partial<Record<RigKind, readonly [number, number, number]>>
> = {
  bot: [0.4, 0.7, 0.95],
  "human-generated": [0.08, 0.2, 0.4],
};

export function initialAudioPolicy(): AudioPolicyState {
  return { activeSeats: {}, familyCooldownUntil: {}, seatPlayedAt: {} };
}

export function decideAudio(
  state: AudioPolicyState,
  request: AudioRequest,
  context: AudioDecisionContext,
): AudioDecision {
  const candidate = audioCandidate(request, context);
  if (candidate.tag === "rejected") return candidate;
  const channelKey = request.seatId || "_global";
  if (state.activeSeats[channelKey] === true) {
    return { tag: "rejected", reason: "seat-active" };
  }
  if (Object.keys(state.activeSeats).length >= AUDIO_CHANNEL_CAP) {
    return { tag: "rejected", reason: "channel-cap" };
  }
  const intensityIndex = audioIntensityIndex(request.intensity);
  const familyCooldownUntil = state.familyCooldownUntil[request.family];
  if (
    request.intensity < 3 && familyCooldownUntil !== undefined &&
    context.now < familyCooldownUntil
  ) {
    return { tag: "rejected", reason: "family-cooldown" };
  }
  const lastPlayedAt = request.seatId === "" ? undefined : state.seatPlayedAt[request.seatId];
  if (
    lastPlayedAt !== undefined &&
    context.now - lastPlayedAt < AUDIO_SEAT_COOLDOWN_MS
  ) {
    return { tag: "rejected", reason: "seat-cooldown" };
  }
  const recentSeatPlayedAt = Object.fromEntries(
    Object.entries(state.seatPlayedAt).filter(([, playedAt]) =>
      context.now - playedAt < AUDIO_SEAT_COOLDOWN_MS
    ),
  );
  const recentFamilyCooldownUntil = Object.fromEntries(
    Object.entries(state.familyCooldownUntil).filter(([, cooldownUntil]) =>
      context.now < cooldownUntil
    ),
  );
  return {
    tag: "admitted",
    channelKey,
    family: request.family,
    durationMs: request.family === "Laughter" && request.qualifier === "standard" ? 945 : 1_800,
    nextState: {
      ...state,
      familyCooldownUntil: {
        ...recentFamilyCooldownUntil,
        [request.family]: context.now + AUDIO_CUE_COOLDOWN_MS[intensityIndex],
      },
      seatPlayedAt: request.seatId === ""
        ? recentSeatPlayedAt
        : { ...recentSeatPlayedAt, [request.seatId]: context.now },
    },
  };
}

function audioCandidate(
  request: AudioRequest,
  context: AudioDecisionContext,
): AudioCandidate | AudioRejection {
  if (!context.audioEnabled) return { tag: "rejected", reason: "disabled" };
  if (request.rigKind !== "bot" && request.rigKind !== "human-generated") {
    return { tag: "rejected", reason: "rig-kind" };
  }
  const probabilities = AUDIO_PROBABILITY_BY_KIND[request.rigKind];
  if (probabilities === undefined) return { tag: "rejected", reason: "rig-kind" };
  const seatProbability = finiteClamp(request.seatAudioProbability, 0, 1, 1);
  const voiceProbability = probabilities[audioIntensityIndex(request.intensity)];
  if (context.randomSample >= seatProbability * voiceProbability) {
    return { tag: "rejected", reason: "probability" };
  }
  return { tag: "candidate" };
}

export function audioStarted(state: AudioPolicyState, channelKey: string): AudioPolicyState {
  return { ...state, activeSeats: { ...state.activeSeats, [channelKey]: true } };
}

export function audioEnded(state: AudioPolicyState, channelKey: string): AudioPolicyState {
  const { [channelKey]: _ended, ...activeSeats } = state.activeSeats;
  return { ...state, activeSeats };
}

function audioIntensityIndex(intensity: number): 0 | 1 | 2 {
  return Number.isInteger(intensity) && intensity >= 1 && intensity <= 3
    ? (intensity - 1) as 0 | 1 | 2
    : 0;
}

export function finiteClamp(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
