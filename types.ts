export const AVATAR_EXPRESSIONS = [
  "neutral",
  "focused",
  "happiness",
  "sadness",
  "anger",
  "fear",
  "surprise",
] as const;

export type AvatarExpression = (typeof AVATAR_EXPRESSIONS)[number];

export const BOT_EMOTIONS = [
  "happy",
  "laughing",
  "sad",
  "dizzy",
  "focused",
  "angry",
] as const;

export type BotEmotion = (typeof BOT_EMOTIONS)[number];

export type Avatar =
  | Readonly<{ kind: "human-photo"; src: string }>
  | Readonly<{
    kind: "human-generated";
    style: "lorelei-neutral";
    src: string;
    expressions: Readonly<Record<AvatarExpression, string>>;
  }>
  | Readonly<{
    kind: "bot";
    style: "avataaars-neutral";
    src: string;
    emotions: Readonly<Record<BotEmotion, string>>;
  }>;

export type RigExpression = AvatarExpression;
export type RigBotEmotion = BotEmotion;
export type RigMotion = "pop" | "shake" | "sink";
export type RigVoiceCue = "gasp" | "laugh" | "sigh" | "groan" | "challenge";
export type RigIntensity = 1 | 2 | 3;
export type RigKind = Avatar["kind"];

export type ReactionSpec = Readonly<{
  expression: RigExpression;
  intensity: RigIntensity;
  motion: RigMotion;
  voiceCue: RigVoiceCue;
  durationMs: number;
  confidence?: number;
  id: number;
  kind?: string;
}>;

export type RigPersonality = Readonly<{
  amplitudeScale: number;
  durationScale: number;
  audioProbability: number;
}>;

export const RIG_CONTROL_PRESETS = [
  "neutral",
  "focused",
  "smile",
  "sad",
  "worry",
  "mad",
  "surprised",
] as const;

export type RigControlPreset = (typeof RIG_CONTROL_PRESETS)[number];

export const RIG_CONTROL_GESTURES = ["laugh"] as const;

export type RigControlGesture = (typeof RIG_CONTROL_GESTURES)[number];

export const RIG_CONTROL_FEATURES = [
  "browInnerRaise",
  "browLower",
  "eyeWiden",
  "eyeSquint",
  "cheekRaise",
  "mouthCornerLift",
  "mouthCornerDrop",
  "jawOpen",
] as const;

export type RigControlFeature = (typeof RIG_CONTROL_FEATURES)[number];

export type RigControlFeatureValues = Readonly<
  Partial<Record<RigControlFeature, number>>
>;

type RigControlEnvelope = Readonly<{
  rigId: string;
  sourceId: string;
  sequence: number;
}>;

export type RigControlCommand =
  | Readonly<
    & RigControlEnvelope
    & {
      tag: "set";
      preset: RigControlPreset;
      features?: RigControlFeatureValues;
      transitionMs?: number;
    }
  >
  | Readonly<
    & RigControlEnvelope
    & {
      tag: "trigger";
      gesture: RigControlGesture;
      intensity?: number;
      durationMs?: number;
    }
  >
  | Readonly<
    & RigControlEnvelope
    & {
      tag: "release";
      transitionMs?: number;
    }
  >;

export type RigControlCapability =
  | "artwork"
  | "featurePose"
  | "wrapperMotion"
  | "tint"
  | "speech";

export type RigControlCapabilities = Readonly<Record<RigControlCapability, boolean>>;

export type RigControlRejectionReason =
  | "invalid-command"
  | "rig-not-found"
  | "stale-sequence"
  | "source-busy";

export type RigControlReceipt =
  | Readonly<{
    tag: "accepted";
    fidelity: "full" | "degraded";
    rigId: string;
    sourceId: string;
    sequence: number;
    capabilities: RigControlCapabilities;
    applied: ReadonlyArray<RigControlCapability>;
    ignoredFeatures: ReadonlyArray<RigControlFeature>;
  }>
  | Readonly<{
    tag: "rejected";
    reason: RigControlRejectionReason;
    rigId: string | null;
    sourceId: string | null;
    sequence: number | null;
  }>;

export const RIG_CONTROL_ARTWORK = [
  ...RIG_CONTROL_PRESETS,
  ...RIG_CONTROL_GESTURES,
] as const;

export type RigControlArtwork = (typeof RIG_CONTROL_ARTWORK)[number];

export type RigControlBank =
  | Readonly<{
    rigKind: "bot";
    layers: Readonly<Record<RigControlArtwork, string>>;
  }>
  | Readonly<{
    rigKind: "human-generated";
    layers: Readonly<Record<RigControlArtwork, string>>;
  }>;

export type FacialRigApi = Readonly<{
  init(config?: Readonly<Record<string, unknown>>): void;
  prepareSwap(fragment: unknown): void;
  sync(): void;
  play(request: Readonly<Record<string, unknown>>): void;
  startSpeaking(rigId: string, cue: string, durationMs: number): void;
  stopSpeaking(rigId: string): void;
  control(command: RigControlCommand): RigControlReceipt;
}>;

export type BotFaceShape =
  | Readonly<{ tag: "default" }>
  | Readonly<{ tag: "aquiline" }>;

export type BotAvatarProfile<Id extends string = string> = Readonly<{
  id: Id;
  seed: string;
  steady: Readonly<{
    eyes: "default";
    eyebrows?: "default" | "raisedExcitedNatural";
    mouth: "serious" | "twinkle";
  }>;
  faceShape: BotFaceShape;
}>;

export type BotAvatarProfileCatalog = Readonly<Record<string, BotAvatarProfile>>;

export type ProfileId<Catalog extends BotAvatarProfileCatalog> = keyof Catalog & string;

export type AvatarGenerator<BotProfileId extends string> = Readonly<{
  forHuman: (input: Readonly<{ picture: string | null; seed: string }>) => Avatar;
  forBot: (profileId: BotProfileId) => Avatar;
}>;
