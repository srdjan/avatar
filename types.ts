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
export type RigIntensity = 1 | 2 | 3;
export type RigKind = Avatar["kind"];

export const FACIAL_REACTION_STATES = [
  "neutral",
  "focused",
  "smile",
  "sad",
  "worry",
  "mad",
  "surprised",
] as const;

export type FacialReactionState = (typeof FACIAL_REACTION_STATES)[number];

export const FACIAL_REACTION_GESTURES = ["laugh"] as const;

export type FacialReactionGesture = (typeof FACIAL_REACTION_GESTURES)[number];

export const LAUGHTER_QUALIFIERS = ["standard", "climactic"] as const;

export type LaughterQualifier = (typeof LAUGHTER_QUALIFIERS)[number];

export const SEMANTIC_AUDIO_FAMILIES = [
  "Happiness",
  "Sadness",
  "Worry",
  "Anger",
  "Surprise",
  "Laughter",
] as const;

export type SemanticAudioFamily = (typeof SEMANTIC_AUDIO_FAMILIES)[number];
export type PersistentSemanticAudioFamily = Exclude<SemanticAudioFamily, "Laughter">;

export const CHARACTER_AUDIO_PROFILE_SLOTS = [
  "Happiness",
  "Sadness",
  "Worry",
  "Anger",
  "Surprise",
  "Laughter.standard",
  "Laughter.climactic",
] as const;

export type CharacterAudioProfileSlotName = (typeof CHARACTER_AUDIO_PROFILE_SLOTS)[number];

declare const facialReactionIdentityBrand: unique symbol;
declare const characterAudioProfileIdBrand: unique symbol;

export type FacialReactionIdentity = string & {
  readonly [facialReactionIdentityBrand]: "FacialReactionIdentity";
};

export type CharacterAudioProfileId = string & {
  readonly [characterAudioProfileIdBrand]: "CharacterAudioProfileId";
};

export type FacialReactionIdentityResult =
  | Readonly<{ tag: "accepted"; identity: FacialReactionIdentity }>
  | Readonly<{ tag: "rejected"; reason: "invalid-reaction-identity" }>;

export type CharacterAudioProfileIdResult =
  | Readonly<{ tag: "accepted"; profileId: CharacterAudioProfileId }>
  | Readonly<{ tag: "rejected"; reason: "invalid-profile-id" }>;

export function parseFacialReactionIdentity(input: unknown): FacialReactionIdentityResult {
  return typeof input === "string" && input.length > 0
    ? { tag: "accepted", identity: input as FacialReactionIdentity }
    : { tag: "rejected", reason: "invalid-reaction-identity" };
}

export function parseCharacterAudioProfileId(input: unknown): CharacterAudioProfileIdResult {
  return typeof input === "string" && input.length > 0
    ? { tag: "accepted", profileId: input as CharacterAudioProfileId }
    : { tag: "rejected", reason: "invalid-profile-id" };
}

type FacialReactionMetadata = Readonly<{
  identity: FacialReactionIdentity;
  state: FacialReactionState;
  kind: string;
  intensity: RigIntensity;
  motion: RigMotion;
  durationMs: number;
  confidence: number;
}>;

export type FacialReaction =
  | Readonly<
    & FacialReactionMetadata
    & {
      gesture?: never;
      qualifier?: never;
    }
  >
  | Readonly<
    & FacialReactionMetadata
    & {
      gesture: "laugh";
      qualifier: LaughterQualifier;
    }
  >;

export type StateSemanticAudio =
  | Readonly<{ tag: "silent" }>
  | Readonly<{
    tag: "audible";
    family: PersistentSemanticAudioFamily;
    qualifier?: never;
  }>;

export type SemanticAudioDecision =
  | StateSemanticAudio
  | Readonly<{
    tag: "audible";
    family: "Laughter";
    qualifier: LaughterQualifier;
  }>;

export type CharacterAudioProfileSlot = Readonly<{
  src: string;
  gain: number;
}>;

export type CharacterAudioProfile = Readonly<
  Record<CharacterAudioProfileSlotName, CharacterAudioProfileSlot>
>;

export type CharacterAudioProfileCatalog = Readonly<Record<string, CharacterAudioProfile>>;

export type RigPersonality = Readonly<{
  amplitudeScale: number;
  durationScale: number;
  audioProbability: number;
}>;

export const RIG_CONTROL_PRESETS = FACIAL_REACTION_STATES;

export type RigControlPreset = FacialReactionState;

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
  ...FACIAL_REACTION_GESTURES,
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

export type FacialRigInitConfig = Readonly<{
  audioProfiles: CharacterAudioProfileCatalog;
  silenceSrc: string;
  isAudioEnabled: () => boolean;
}>;

export type FacialRigInitReceipt =
  | Readonly<{ tag: "accepted" }>
  | Readonly<{
    tag: "rejected";
    reason: "invalid-config" | "invalid-profile-catalog";
  }>;

export type FacialRigSemanticAudioDetail = Readonly<{
  family: SemanticAudioFamily;
  qualifier: LaughterQualifier | null;
  profileId: CharacterAudioProfileId;
  identity: FacialReactionIdentity;
  src: string;
  gain: number;
  state: FacialReactionState;
  gesture: FacialReactionGesture | null;
  kind: string;
  intensity: RigIntensity;
  confidence: number;
  durationMs: number;
  rigKind: RigKind;
  rigId: string;
  seatId: string;
  seatAudioProbability: number;
}>;

export type FacialRigApi = Readonly<{
  init(config: FacialRigInitConfig): FacialRigInitReceipt;
  prepareSwap(fragment: unknown): void;
  sync(): void;
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
