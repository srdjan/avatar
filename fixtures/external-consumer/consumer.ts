import {
  type Avatar,
  AVATAR_EXPRESSIONS,
  CHARACTER_AUDIO_PROFILE_SLOTS,
  type CharacterAudioProfileCatalog,
  createAvatarGenerator,
  type FacialReaction,
  type FacialRigApi,
  type FacialRigInitConfig,
  type FacialRigInitReceipt,
  parseFacialReactionIdentity,
  type RigControlCommand,
  type SemanticAudioDecision,
} from "@srdjan/avatar";
import { AVATAR_ASSETS, AVATAR_AUDIO_ASSETS } from "@srdjan/avatar/assets";
import { createRigControlBank, renderFacialRig } from "@srdjan/avatar/server";

export function describeAvatar(avatar: Avatar): string {
  switch (avatar.kind) {
    case "human-photo":
      return `photo:${avatar.src}`;
    case "human-generated":
      return `human:${
        AVATAR_EXPRESSIONS.map((expression) => avatar.expressions[expression].length).join(",")
      }`;
    case "bot":
      return `bot:${avatar.emotions.focused.length}`;
    default: {
      const exhaustive: never = avatar;
      return exhaustive;
    }
  }
}

const generator = createAvatarGenerator();
export const generatedAvatar = generator.forHuman({
  picture: null,
  seed: "external",
});
export const generatedDescription = describeAvatar(generatedAvatar);

const bot = generator.forBot("mason-steady");
if (bot.kind !== "bot") {
  throw new TypeError("built-in bot profile returned a non-bot avatar");
}

function exactIdentity(value: string) {
  const result = parseFacialReactionIdentity(value);
  if (result.tag !== "accepted") throw new TypeError("reaction identity rejected");
  return result.identity;
}

export const stateOnlyReaction = {
  identity: exactIdentity("match-1:hand-1:event-state"),
  state: "smile",
  kind: "TrickWon",
  intensity: 2,
  motion: "pop",
  durationMs: 900,
  confidence: 0.9,
} as const satisfies FacialReaction;

export const standardLaughReaction = {
  identity: exactIdentity("match-1:hand-1:event-laugh-standard"),
  state: "smile",
  kind: "RoundWon",
  intensity: 2,
  motion: "pop",
  durationMs: 1_100,
  confidence: 1,
  gesture: "laugh",
  qualifier: "standard",
} as const satisfies FacialReaction;

export const climacticLaughReaction = {
  identity: exactIdentity("match-1:hand-1:event-laugh-climactic"),
  state: "surprised",
  kind: "MatchWon",
  intensity: 3,
  motion: "shake",
  durationMs: 1_800,
  confidence: 1,
  gesture: "laugh",
  qualifier: "climactic",
} as const satisfies FacialReaction;

export const semanticDecisions = [
  { tag: "audible", family: "Happiness" },
  { tag: "audible", family: "Laughter", qualifier: "standard" },
  { tag: "audible", family: "Laughter", qualifier: "climactic" },
] as const satisfies ReadonlyArray<SemanticAudioDecision>;

export const audioProfiles = {
  "mason-steady": {
    Happiness: { src: AVATAR_ASSETS.opa.url.href, gain: 0.8 },
    Sadness: { src: AVATAR_ASSETS.ufNanumu.url.href, gain: 0.7 },
    Worry: { src: AVATAR_ASSETS.nenene.url.href, gain: 0.65 },
    Anger: { src: AVATAR_ASSETS.ufNanumu.url.href, gain: 0.85 },
    Surprise: { src: AVATAR_ASSETS.opa.url.href, gain: 0.9 },
    "Laughter.standard": { src: AVATAR_ASSETS.haha.url.href, gain: 0.75 },
    "Laughter.climactic": { src: AVATAR_ASSETS.hahaha.url.href, gain: 1 },
  },
} as const satisfies CharacterAudioProfileCatalog;

const commonRigInput = {
  id: "consumer",
  label: "Consumer bot",
  matchScope: "match-1",
  audioProfileId: "mason-steady",
  personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 1 },
  rigKind: "bot",
  baseSvg: bot.src,
  expressionSvg: bot.emotions.focused,
  microSvg: bot.emotions.focused,
  controlBank: createRigControlBank(bot),
} as const;

export const renderedBot = renderFacialRig({
  ...commonRigInput,
  reaction: stateOnlyReaction,
  precedingReaction: standardLaughReaction,
  microReaction: climacticLaughReaction,
});

export const renderedNullableBot = renderFacialRig({
  ...commonRigInput,
  reaction: null,
  precedingReaction: null,
  microReaction: null,
});

export const initConfig = {
  audioProfiles,
  silenceSrc: AVATAR_ASSETS.silence.url.href,
  isAudioEnabled: () => true,
} satisfies FacialRigInitConfig;

export function initializeFacialRig(
  api: Pick<FacialRigApi, "init">,
): FacialRigInitReceipt {
  return api.init(initConfig);
}

export const initReceipt = initializeFacialRig({
  init: (config) =>
    Object.keys(config.audioProfiles).length === 1
      ? { tag: "accepted" }
      : { tag: "rejected", reason: "invalid-profile-catalog" },
});

export const setControlCommand = {
  tag: "set",
  rigId: "avatar-rig-consumer",
  sourceId: "external-consumer",
  sequence: 1,
  preset: "smile",
  features: { mouthCornerLift: 0.8 },
} as const satisfies RigControlCommand;

export const releaseControlCommand = {
  tag: "release",
  rigId: "avatar-rig-consumer",
  sourceId: "external-consumer",
  sequence: 2,
} as const satisfies RigControlCommand;

export const declaredAssetUrls = Object.values(AVATAR_ASSETS).map((asset) => asset.url.href);
export const declaredAudioAssetIds = AVATAR_AUDIO_ASSETS.map((asset) => asset.id);
export const declaredProfileSlots = CHARACTER_AUDIO_PROFILE_SLOTS;
