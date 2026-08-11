import {
  RIG_CONTROL_FEATURES,
  RIG_CONTROL_GESTURES,
  RIG_CONTROL_PRESETS,
  type RigControlFeature,
  type RigControlFeatureValues,
  type RigControlPreset,
  type RigControlRejectionReason,
} from "../types.ts";

export type RigKind = "bot" | "human-generated" | "human-photo" | "unknown";

export type ReactionPayload =
  | Readonly<{ tag: "none"; id: number }>
  | Readonly<{
    tag: "active";
    id: number;
    kind: string;
    expression: string;
    intensity: number;
    motion: string;
    durationMs: number;
    confidence: number;
    voiceCue: string;
  }>;

export type RigProtocol = Readonly<{
  main: ReactionPayload;
  preceding: ReactionPayload;
  micro: ReactionPayload;
}>;

type SpeechActivity =
  | Readonly<{ tag: "silent" }>
  | Readonly<{ tag: "speaking" }>
  | Readonly<{ tag: "fading" }>;

export type RigState = Readonly<{
  seen: Readonly<{ main: number; preceding: number; micro: number }>;
  speech: SpeechActivity;
}>;

export type RigEffect =
  | Readonly<{
    tag: "start-macro";
    reaction: Extract<ReactionPayload, { tag: "active" }>;
  }>
  | Readonly<{
    tag: "schedule-macro";
    reaction: Extract<ReactionPayload, { tag: "active" }>;
    delayMs: number;
  }>
  | Readonly<{
    tag: "start-micro";
    reaction: Extract<ReactionPayload, { tag: "active" }>;
  }>;

export type RigTransition = Readonly<{
  state: RigState;
  effects: ReadonlyArray<RigEffect>;
}>;

type ActiveReaction = Extract<ReactionPayload, { tag: "active" }>;

export function initialRigState(): RigState {
  return {
    seen: { main: 0, preceding: 0, micro: 0 },
    speech: { tag: "silent" },
  };
}

export function seedRigState(protocol: RigProtocol): RigState {
  return {
    ...initialRigState(),
    seen: {
      main: protocol.main.id,
      preceding: protocol.preceding.id,
      micro: protocol.micro.id,
    },
  };
}

export function reduceRigSync(
  state: RigState,
  protocol: RigProtocol,
): RigTransition {
  const mainChanged = protocol.main.id > state.seen.main;
  const precedingChanged = protocol.preceding.id > state.seen.preceding;
  const microChanged = protocol.micro.id > state.seen.micro;
  const main = mainChanged && protocol.main.tag === "active" ? protocol.main : null;
  const preceding = precedingChanged && protocol.preceding.tag === "active"
    ? protocol.preceding
    : null;
  const micro = microChanged && protocol.micro.tag === "active" ? protocol.micro : null;
  return {
    state: {
      seen: {
        main: mainChanged ? protocol.main.id : state.seen.main,
        preceding: precedingChanged ? protocol.preceding.id : state.seen.preceding,
        micro: microChanged ? protocol.micro.id : state.seen.micro,
      },
      speech: state.speech,
    },
    effects: rigEffects(main, preceding, micro),
  };
}

function rigEffects(
  main: ActiveReaction | null,
  preceding: ActiveReaction | null,
  micro: ActiveReaction | null,
): RigEffect[] {
  const effects: RigEffect[] = [];
  if (preceding !== null) effects.push({ tag: "start-macro", reaction: preceding });
  if (main !== null && preceding === null) effects.push({ tag: "start-macro", reaction: main });
  if (main !== null && preceding !== null) {
    effects.push({ tag: "schedule-macro", reaction: main, delayMs: preceding.durationMs });
  }
  if (micro !== null) effects.push({ tag: "start-micro", reaction: micro });
  return effects;
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
    tag: "trigger";
    rigId: string;
    sourceId: string;
    sequence: number;
    gesture: "laugh";
    intensity: number;
    durationMs: number;
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
  gesture: Extract<ParsedRigControlCommand, { tag: "trigger" }> | null;
}>;

export type RigControlEffect =
  | Readonly<{
    tag: "set-affect";
    command: Extract<ParsedRigControlCommand, { tag: "set" }>;
  }>
  | Readonly<{
    tag: "trigger-gesture";
    command: Extract<ParsedRigControlCommand, { tag: "trigger" }>;
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
    case "trigger":
      return parseTriggerControlCommand(input, envelope);
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

function parseTriggerControlCommand(
  input: Readonly<Record<string, unknown>>,
  envelope: ValidControlEnvelope,
): RigControlParseResult {
  const gesture = input.gesture;
  const rawIntensity = input.intensity;
  const rawDurationMs = input.durationMs;
  if (
    !hasOnlyKeys(input, [
      "tag",
      "rigId",
      "sourceId",
      "sequence",
      "gesture",
      "intensity",
      "durationMs",
    ]) ||
    !isOneOf(gesture, RIG_CONTROL_GESTURES)
  ) return invalidControlCommand();
  const intensity = optionalNumberInRange(rawIntensity, 1, 0, 1);
  const durationMs = optionalNumberInRange(rawDurationMs, 900, 100, 5_000);
  if (intensity === null || durationMs === null) return invalidControlCommand();
  return {
    tag: "parsed",
    command: {
      tag: "trigger",
      rigId: envelope.rigId,
      sourceId: envelope.sourceId,
      sequence: envelope.sequence,
      gesture,
      intensity,
      durationMs,
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

function isNonEmptyString(value: unknown): boolean {
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
    gesture: null,
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
    case "trigger":
      return {
        state: { ...sequenced, ownerSourceId: command.sourceId, gesture: command },
        decision: { tag: "accepted" },
        effects: [{ tag: "trigger-gesture", command }],
      };
    case "release":
      return {
        state: { ...sequenced, ownerSourceId: null, affect: null, gesture: null },
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
  cueCooldownUntil: Readonly<Record<string, number>>;
  seatPlayedAt: Readonly<Record<string, number>>;
}>;

export type AudioRequest = Readonly<{
  cue: string;
  intensity: number;
  rigKind: RigKind;
  rigId: string;
  seatId: string;
  seatAudioProbability: number;
}>;

export type AudioDecision =
  | Readonly<{
    tag: "rejected";
    reason:
      | "disabled"
      | "cue"
      | "rig-kind"
      | "missing-asset"
      | "channel-cap"
      | "probability"
      | "seat-active"
      | "seat-cooldown"
      | "cue-cooldown";
  }>
  | Readonly<{
    tag: "admitted";
    channelKey: string;
    cueKey: string;
    durationMs: number;
    nextState: AudioPolicyState;
  }>;

type AudioRejection = Extract<AudioDecision, { tag: "rejected" }>;
type AudioCandidate = Readonly<{ tag: "candidate"; cueKey: string }>;

type AudioDecisionContext = Readonly<{
  audioEnabled: boolean;
  availableCues: ReadonlySet<string>;
  now: number;
  randomSample: number;
}>;

const AUDIO_CHANNEL_CAP = 2;
const AUDIO_SEAT_COOLDOWN_MS = 600;
const AUDIO_CUE_COOLDOWN_MS = [900, 1_400, 2_200] as const;
const AUDIO_TIMEOUT_MS = [2_000, 2_400, 3_200] as const;
const AUDIO_DURATION_BY_CUE: Readonly<Record<string, number>> = {
  challenge: 1_800,
  gasp: 1_800,
  groan: 1_800,
  laugh: 945,
  laughClimactic: 1_800,
  sigh: 1_800,
};
const AUDIO_PROBABILITY_BY_KIND: Readonly<
  Partial<Record<RigKind, readonly [number, number, number]>>
> = {
  bot: [0.4, 0.7, 0.95],
  "human-generated": [0.08, 0.2, 0.4],
};

export function initialAudioPolicy(): AudioPolicyState {
  return { activeSeats: {}, cueCooldownUntil: {}, seatPlayedAt: {} };
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
  const cueCooldownUntil = state.cueCooldownUntil[request.cue];
  if (
    request.intensity < 3 && cueCooldownUntil !== undefined &&
    context.now < cueCooldownUntil
  ) {
    return { tag: "rejected", reason: "cue-cooldown" };
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
  const recentCueCooldownUntil = Object.fromEntries(
    Object.entries(state.cueCooldownUntil).filter(([, cooldownUntil]) =>
      context.now < cooldownUntil
    ),
  );
  return {
    tag: "admitted",
    channelKey,
    cueKey: candidate.cueKey,
    durationMs: AUDIO_DURATION_BY_CUE[candidate.cueKey] ?? AUDIO_TIMEOUT_MS[intensityIndex],
    nextState: {
      ...state,
      cueCooldownUntil: {
        ...recentCueCooldownUntil,
        [request.cue]: context.now + AUDIO_CUE_COOLDOWN_MS[intensityIndex],
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
  if (request.cue === "") return { tag: "rejected", reason: "cue" };
  if (request.rigKind !== "bot" && request.rigKind !== "human-generated") {
    return { tag: "rejected", reason: "rig-kind" };
  }
  const climactic = request.cue === "laugh" && request.intensity >= 3;
  const cueKey = climactic && context.availableCues.has("laughClimactic")
    ? "laughClimactic"
    : request.cue;
  if (!context.availableCues.has(cueKey)) {
    return { tag: "rejected", reason: "missing-asset" };
  }
  const probabilities = AUDIO_PROBABILITY_BY_KIND[request.rigKind];
  if (probabilities === undefined) return { tag: "rejected", reason: "rig-kind" };
  const seatProbability = finiteClamp(request.seatAudioProbability, 0, 1, 1);
  const voiceProbability = probabilities[audioIntensityIndex(request.intensity)];
  if (context.randomSample >= seatProbability * voiceProbability) {
    return { tag: "rejected", reason: "probability" };
  }
  return { tag: "candidate", cueKey };
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
