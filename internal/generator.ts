import { createAvatar } from "@dicebear/core";
import * as avataaarsNeutral from "@dicebear/avataaars-neutral";
import * as loreleiNeutral from "@dicebear/lorelei-neutral";
import { avataaarsPreset, decomposeFaceFeatures } from "../server/mod.ts";
import type {
  Avatar,
  AvatarExpression,
  AvatarGenerator,
  BotAvatarProfile,
  BotAvatarProfileCatalog,
  BotEmotion,
  ProfileId,
} from "../types.ts";

const DEFAULT_HUMAN_CACHE_SIZE = 128;

const AQUILINE_NOSE = '<path fill-rule="evenodd" clip-rule="evenodd" ' +
  'd="M27 0 c-2 5 -4 11 -3 15 c1 3 6 4 8 2 c2 -1 1 -3 -2 -3 ' +
  'c-3 0 -4 -3 -3 -6 c1 -4 2 -6 0 -8 z" ' +
  'fill="#000" fill-opacity=".18"/>';

export const BUILT_IN_BOT_PROFILES = {
  "mason-steady": {
    id: "mason-steady",
    seed: "Mason",
    steady: { eyes: "default", mouth: "serious" },
    faceShape: { tag: "default" },
  },
  "christian-alert": {
    id: "christian-alert",
    seed: "Christian",
    steady: {
      eyes: "default",
      eyebrows: "raisedExcitedNatural",
      mouth: "twinkle",
    },
    faceShape: { tag: "default" },
  },
  "jocelyn-aquiline": {
    id: "jocelyn-aquiline",
    seed: "Jocelyn",
    steady: { eyes: "default", eyebrows: "default", mouth: "serious" },
    faceShape: { tag: "aquiline" },
  },
} as const satisfies BotAvatarProfileCatalog;

export type BotAvatarProfileId = keyof typeof BUILT_IN_BOT_PROFILES;

type BuiltInOptions = Readonly<{
  humanCacheLimit?: number;
  profiles?: undefined;
}>;

type CustomOptions<Catalog extends BotAvatarProfileCatalog> = Readonly<{
  humanCacheLimit?: number;
  profiles: Catalog;
}>;

export function createAvatarGenerator(
  options?: BuiltInOptions,
): AvatarGenerator<BotAvatarProfileId>;
export function createAvatarGenerator<const Catalog extends BotAvatarProfileCatalog>(
  options: CustomOptions<Catalog>,
): AvatarGenerator<ProfileId<Catalog>>;
export function createAvatarGenerator(
  options: BuiltInOptions | CustomOptions<BotAvatarProfileCatalog> = {},
): AvatarGenerator<string> {
  const humanCacheLimit = options.humanCacheLimit ?? DEFAULT_HUMAN_CACHE_SIZE;
  if (!Number.isSafeInteger(humanCacheLimit) || humanCacheLimit < 1) {
    throw new TypeError("humanCacheLimit must be a positive safe integer");
  }

  const profiles = validateAndSnapshotProfiles(options.profiles ?? BUILT_IN_BOT_PROFILES);
  const humanCache = new Map<string, Avatar>();
  const botCache = new Map<string, Avatar>();

  return {
    forHuman: (input) => {
      if (input.picture) return { kind: "human-photo", src: input.picture };
      const cached = humanCache.get(input.seed);
      if (cached) return cached;

      const expressions = createHumanExpressionMap(input.seed);
      const result: Avatar = {
        kind: "human-generated",
        style: "lorelei-neutral",
        src: expressions.neutral,
        expressions,
      };
      if (humanCache.size >= humanCacheLimit) {
        const oldest = humanCache.keys().next();
        if (!oldest.done) humanCache.delete(oldest.value);
      }
      humanCache.set(input.seed, result);
      return result;
    },

    forBot: (profileId) => {
      const cached = botCache.get(profileId);
      if (cached) return cached;
      const profile = Object.hasOwn(profiles, profileId) ? profiles[profileId] : undefined;
      if (!profile) throw new RangeError(`unknown bot avatar profile: ${profileId}`);

      const emotions = createBotEmotionMap(profile);
      const result: Avatar = {
        kind: "bot",
        style: "avataaars-neutral",
        src: emotions.focused,
        emotions,
      };
      botCache.set(profileId, result);
      return result;
    },
  };
}

function validateAndSnapshotProfiles(
  catalog: BotAvatarProfileCatalog,
): Readonly<Record<string, BotAvatarProfile>> {
  const entries = Object.entries(catalog);
  if (entries.length === 0) throw new TypeError("profiles must not be empty");

  return Object.freeze(Object.fromEntries(entries.map(([catalogId, profile]) => {
    if (catalogId.length === 0 || profile.id !== catalogId) {
      throw new TypeError(`profile id must match catalog key: ${catalogId}`);
    }
    if (profile.seed.length === 0) {
      throw new TypeError(`profile seed must not be empty: ${catalogId}`);
    }
    validateSteadyFace(profile);
    const faceShape = snapshotFaceShape(profile);
    return [
      catalogId,
      Object.freeze({
        id: profile.id,
        seed: profile.seed,
        steady: Object.freeze({ ...profile.steady }),
        faceShape,
      }),
    ] as const;
  })));
}

function validateSteadyFace(profile: BotAvatarProfile): void {
  const { eyes, eyebrows, mouth } = profile.steady;
  if (eyes !== "default") throw new TypeError(`invalid steady eyes: ${profile.id}`);
  if (eyebrows !== undefined && eyebrows !== "default" && eyebrows !== "raisedExcitedNatural") {
    throw new TypeError(`invalid steady eyebrows: ${profile.id}`);
  }
  if (mouth !== "serious" && mouth !== "twinkle") {
    throw new TypeError(`invalid steady mouth: ${profile.id}`);
  }
}

function snapshotFaceShape(profile: BotAvatarProfile): BotAvatarProfile["faceShape"] {
  const tag = (profile.faceShape as { readonly tag?: unknown } | null)?.tag;
  switch (tag) {
    case "default":
      return Object.freeze({ tag: "default" });
    case "aquiline":
      return Object.freeze({ tag: "aquiline" });
    default:
      throw new TypeError(`invalid face shape: ${profile.id}: ${JSON.stringify(tag)}`);
  }
}

function createHumanExpressionMap(seed: string): Readonly<Record<AvatarExpression, string>> {
  return {
    neutral: humanVariant(seed, {}),
    focused: humanVariant(seed, { eyebrows: ["variant03"], mouth: ["sad07"] }),
    happiness: humanVariant(seed, {
      eyebrows: ["variant07", "variant08"],
      mouth: ["happy01", "happy02", "happy03"],
    }),
    sadness: humanVariant(seed, {
      eyebrows: ["variant05", "variant06"],
      mouth: ["sad01", "sad02"],
    }),
    anger: humanVariant(seed, {
      eyebrows: ["variant02", "variant03"],
      mouth: ["sad03", "sad05"],
    }),
    fear: humanVariant(seed, {
      eyebrows: ["variant09", "variant10"],
      mouth: ["sad06", "happy18"],
    }),
    surprise: humanVariant(seed, {
      eyebrows: ["variant11", "variant12"],
      mouth: ["happy10", "happy11"],
    }),
  };
}

function humanVariant(seed: string, options: loreleiNeutral.Options): string {
  return createAvatar(loreleiNeutral, { seed, ...options }).toDataUri();
}

function createBotEmotionMap(profile: BotAvatarProfile): Readonly<Record<BotEmotion, string>> {
  return {
    happy: createBotEmotionAvatar(profile, { eyes: ["happy"], mouth: ["smile"] }),
    laughing: createBotEmotionAvatar(profile, { eyes: ["xDizzy"], mouth: ["tongue"] }),
    sad: createBotEmotionAvatar(profile, { eyes: ["cry"], mouth: ["sad"] }),
    dizzy: createBotEmotionAvatar(profile, { eyes: ["xDizzy"], mouth: ["grimace"] }),
    focused: createBotEmotionAvatar(profile, steadyOptions(profile)),
    angry: createBotEmotionAvatar(profile, {
      eyes: ["squint"],
      eyebrows: ["angryNatural"],
      mouth: ["serious"],
    }),
  };
}

function steadyOptions(profile: BotAvatarProfile): avataaarsNeutral.Options {
  return profile.steady.eyebrows === undefined
    ? { eyes: [profile.steady.eyes], mouth: [profile.steady.mouth] }
    : {
      eyes: [profile.steady.eyes],
      eyebrows: [profile.steady.eyebrows],
      mouth: [profile.steady.mouth],
    };
}

function createBotEmotionAvatar(
  profile: BotAvatarProfile,
  options: avataaarsNeutral.Options,
): string {
  const svg = createAvatar(avataaarsNeutral, { seed: profile.seed, ...options }).toString();
  return applyFaceShape(decomposeFaceFeatures(svg, avataaarsPreset), profile.faceShape);
}

function applyFaceShape(svg: string, faceShape: BotAvatarProfile["faceShape"]): string {
  switch (faceShape.tag) {
    case "default":
      return svg;
    case "aquiline": {
      const open = '<g class="face-nose">';
      const start = svg.indexOf(open);
      if (start === -1) return svg;
      const inner = start + open.length;
      const end = svg.indexOf("</g>", inner);
      if (end === -1) return svg;
      return svg.slice(0, inner) + AQUILINE_NOSE + svg.slice(end);
    }
  }
}
