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
