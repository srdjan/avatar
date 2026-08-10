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
