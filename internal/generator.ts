import { createAvatar } from "@dicebear/core";
import * as avataaarsNeutral from "@dicebear/avataaars-neutral";
import * as loreleiNeutral from "@dicebear/lorelei-neutral";
import { avataaarsPreset } from "../server/avataaars_preset.ts";
import { decomposeFaceFeatures } from "../server/decompose.ts";
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

const VALID_STEADY_EYEBROWS: ReadonlySet<unknown> = new Set([
  undefined,
  "default",
  "raisedExcitedNatural",
]);
const VALID_STEADY_MOUTHS: ReadonlySet<unknown> = new Set(["serious", "twinkle"]);

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

declare const validatedProfileId: unique symbol;
declare const validatedProfileSeed: unique symbol;

type ValidatedProfileId = string & { readonly [validatedProfileId]: true };
type ValidatedProfileSeed = string & { readonly [validatedProfileSeed]: true };

type ValidatedBotProfile = Readonly<{
  id: ValidatedProfileId;
  seed: ValidatedProfileSeed;
  steady: BotAvatarProfile["steady"];
  faceShape: BotAvatarProfile["faceShape"];
}>;

type ValidatedProfileCatalog = Readonly<Record<string, ValidatedBotProfile>>;

type DiceBearAvatarCapability = Readonly<{
  renderHuman: (seed: string, options: loreleiNeutral.Options) => string;
  renderBot: (seed: ValidatedProfileSeed, options: avataaarsNeutral.Options) => string;
}>;

type GeneratorConfig = Readonly<{
  humanCacheLimit: number;
  profiles: ValidatedProfileCatalog;
}>;

// DiceBear picks a skin by seed, and the index depends on the palette length.
// Six colors in this order give the built-in bots distinct skins: Mason mint,
// Jocelyn peach, Christian blue. A unit test pins that result.
const BOT_SKINS = ["cbb8ea", "a9d6c4", "f2c4a8", "b9c8ee", "efbfcb", "e8dcae"];
const HUMAN_INK = ["3a2e26"];
const HUMAN_LOOK: loreleiNeutral.Options = {
  backgroundColor: ["f5e0bd", "e7dccb", "ead2c4", "dfe3d0"],
  eyesColor: HUMAN_INK,
  eyebrowsColor: HUMAN_INK,
  mouthColor: HUMAN_INK,
  glassesColor: HUMAN_INK,
  frecklesColor: HUMAN_INK,
};

const DICE_BEAR_AVATARS: DiceBearAvatarCapability = Object.freeze({
  renderHuman: (seed, options) =>
    createAvatar(loreleiNeutral, { seed, ...HUMAN_LOOK, ...options }).toDataUri(),
  renderBot: (seed, options) =>
    createAvatar(avataaarsNeutral, { seed, backgroundColor: BOT_SKINS, ...options }).toString(),
});

export function createAvatarGenerator(
  options?: BuiltInOptions,
): AvatarGenerator<BotAvatarProfileId>;
export function createAvatarGenerator<const Catalog extends BotAvatarProfileCatalog>(
  options: CustomOptions<Catalog>,
): AvatarGenerator<ProfileId<Catalog>>;
export function createAvatarGenerator(
  options: BuiltInOptions | CustomOptions<BotAvatarProfileCatalog> = {},
): AvatarGenerator<string> {
  return createGenerator(parseGeneratorConfig(options), DICE_BEAR_AVATARS);
}

function parseGeneratorConfig(
  options: BuiltInOptions | CustomOptions<BotAvatarProfileCatalog>,
): GeneratorConfig {
  const humanCacheLimit = options.humanCacheLimit ?? DEFAULT_HUMAN_CACHE_SIZE;
  if (!Number.isSafeInteger(humanCacheLimit) || humanCacheLimit < 1) {
    throw new TypeError("humanCacheLimit must be a positive safe integer");
  }

  return Object.freeze({
    humanCacheLimit,
    profiles: parseProfileCatalog(options.profiles ?? BUILT_IN_BOT_PROFILES),
  });
}

function createGenerator(
  config: GeneratorConfig,
  avatars: DiceBearAvatarCapability,
): AvatarGenerator<string> {
  const humanCache = new Map<string, Avatar>();
  const botCache = new Map<string, Avatar>();

  return {
    forHuman: (input) => {
      if (input.picture) return { kind: "human-photo", src: input.picture };
      const cached = humanCache.get(input.seed);
      if (cached) return cached;

      const expressions = createHumanExpressionMap(avatars, input.seed);
      const result: Avatar = {
        kind: "human-generated",
        style: "lorelei-neutral",
        src: expressions.neutral,
        expressions,
      };
      if (humanCache.size >= config.humanCacheLimit) {
        const oldest = humanCache.keys().next();
        if (!oldest.done) humanCache.delete(oldest.value);
      }
      humanCache.set(input.seed, result);
      return result;
    },

    forBot: (profileId) => {
      const cached = botCache.get(profileId);
      if (cached) return cached;
      const profile = Object.hasOwn(config.profiles, profileId)
        ? config.profiles[profileId]
        : undefined;
      if (!profile) throw new RangeError(`unknown bot avatar profile: ${profileId}`);

      const emotions = createBotEmotionMap(avatars, profile);
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

function parseProfileCatalog(
  catalog: BotAvatarProfileCatalog,
): ValidatedProfileCatalog {
  const entries = Object.entries(catalog);
  if (entries.length === 0) throw new TypeError("profiles must not be empty");

  return Object.freeze(Object.fromEntries(entries.map(([catalogId, profile]) => {
    const { id, seed, steady, faceShape } = profile;
    if (catalogId.length === 0 || id !== catalogId) {
      throw new TypeError(`profile id must match catalog key: ${catalogId}`);
    }
    if (typeof seed !== "string" || seed.length === 0) {
      throw new TypeError(`profile seed must not be empty: ${catalogId}`);
    }
    const steadySnapshot = snapshotSteadyFace(id, steady);
    const faceShapeSnapshot = snapshotFaceShape(id, faceShape);
    return [
      catalogId,
      Object.freeze({
        id: id as ValidatedProfileId,
        seed: seed as ValidatedProfileSeed,
        steady: steadySnapshot,
        faceShape: faceShapeSnapshot,
      }),
    ] as const;
  })));
}

function snapshotSteadyFace(
  profileId: string,
  steady: BotAvatarProfile["steady"],
): BotAvatarProfile["steady"] {
  const { eyes, eyebrows, mouth } = steady;
  if (eyes !== "default") throw new TypeError(`invalid steady eyes: ${profileId}`);
  if (!VALID_STEADY_EYEBROWS.has(eyebrows)) {
    throw new TypeError(`invalid steady eyebrows: ${profileId}`);
  }
  if (!VALID_STEADY_MOUTHS.has(mouth)) {
    throw new TypeError(`invalid steady mouth: ${profileId}`);
  }
  return Object.freeze(
    eyebrows === undefined ? { eyes, mouth } : { eyes, eyebrows, mouth },
  );
}

function snapshotFaceShape(
  profileId: string,
  faceShape: BotAvatarProfile["faceShape"],
): BotAvatarProfile["faceShape"] {
  const tag = (faceShape as { readonly tag?: unknown } | null)?.tag;
  switch (tag) {
    case "default":
      return Object.freeze({ tag: "default" });
    case "aquiline":
      return Object.freeze({ tag: "aquiline" });
    default:
      throw new TypeError(`invalid face shape: ${profileId}: ${JSON.stringify(tag)}`);
  }
}

function createHumanExpressionMap(
  avatars: DiceBearAvatarCapability,
  seed: string,
): Readonly<Record<AvatarExpression, string>> {
  return {
    neutral: avatars.renderHuman(seed, {}),
    focused: avatars.renderHuman(seed, { eyebrows: ["variant03"], mouth: ["sad07"] }),
    happiness: avatars.renderHuman(seed, {
      eyebrows: ["variant07", "variant08"],
      mouth: ["happy01", "happy02", "happy03"],
    }),
    sadness: avatars.renderHuman(seed, {
      eyebrows: ["variant05", "variant06"],
      mouth: ["sad01", "sad02"],
    }),
    anger: avatars.renderHuman(seed, {
      eyebrows: ["variant02", "variant03"],
      mouth: ["sad03", "sad05"],
    }),
    fear: avatars.renderHuman(seed, {
      eyebrows: ["variant09", "variant10"],
      mouth: ["sad06", "happy18"],
    }),
    surprise: avatars.renderHuman(seed, {
      eyebrows: ["variant11", "variant12"],
      mouth: ["happy10", "happy11"],
    }),
  };
}

function createBotEmotionMap(
  avatars: DiceBearAvatarCapability,
  profile: ValidatedBotProfile,
): Readonly<Record<BotEmotion, string>> {
  return {
    happy: createBotEmotionAvatar(avatars, profile, { eyes: ["happy"], mouth: ["smile"] }),
    laughing: createBotEmotionAvatar(avatars, profile, {
      eyes: ["xDizzy"],
      mouth: ["tongue"],
    }),
    sad: createBotEmotionAvatar(avatars, profile, { eyes: ["cry"], mouth: ["sad"] }),
    dizzy: createBotEmotionAvatar(avatars, profile, { eyes: ["xDizzy"], mouth: ["grimace"] }),
    focused: createBotEmotionAvatar(avatars, profile, steadyOptions(profile)),
    angry: createBotEmotionAvatar(avatars, profile, {
      eyes: ["squint"],
      eyebrows: ["angryNatural"],
      mouth: ["serious"],
    }),
  };
}

function steadyOptions(profile: ValidatedBotProfile): avataaarsNeutral.Options {
  return profile.steady.eyebrows === undefined
    ? { eyes: [profile.steady.eyes], mouth: [profile.steady.mouth] }
    : {
      eyes: [profile.steady.eyes],
      eyebrows: [profile.steady.eyebrows],
      mouth: [profile.steady.mouth],
    };
}

function createBotEmotionAvatar(
  avatars: DiceBearAvatarCapability,
  profile: ValidatedBotProfile,
  options: avataaarsNeutral.Options,
): string {
  const svg = avatars.renderBot(profile.seed, options);
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
