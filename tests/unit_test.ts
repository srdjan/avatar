import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1.0.14";
import {
  AVATAR_EXPRESSIONS,
  BOT_EMOTIONS,
  type BotAvatarProfileCatalog,
  BUILT_IN_BOT_PROFILES,
  createAvatarGenerator,
  type ReactionSpec,
} from "@srdjan/avatar";
import {
  avataaarsPreset,
  decomposeFaceFeatures,
  expressionVariantForBot,
  renderFacialRig,
} from "@srdjan/avatar/server";

type Fingerprint = Readonly<{ length: number; sha256: string }>;

const BOT_FINGERPRINTS = {
  "mason-steady": {
    happy: [5431, "fb340e09add875ca1b60f3e017fe6150acce2208f9d6168ca47a44d4e9c97056"],
    laughing: [5645, "10ccf5101073b356f70578ba5f8b2776aedffca8c71ef59d02e886d64256140b"],
    sad: [5066, "530243109178f2a992305b9eb95115762adf47578f7628c3de7b0b3e883f767c"],
    dizzy: [5569, "ad5386071fbcc61279b976f55bf076ee4643436ec32902c4be1caf4609ee0b2b"],
    focused: [4812, "f4707c0b693047c4fee5b4acdbb0fa3e6a1691527f7377f88f270bd726e66d60"],
    angry: [5316, "34877479275da83244e6e2a68577e734fe61e45b970ff5f2dbe57734d9358d61"],
  },
  "christian-alert": {
    happy: [5413, "5b587eaf0d0eb2acbb103bdf621b75a444d971dd853695608d9c4044fc50327b"],
    laughing: [5627, "7e7f5de843081a8f5538bbc077aec74608e43405b6eb695e7bee79f4bcdb6732"],
    sad: [5048, "ed916e971a9ce6ec4cb5f9a583b7bcbfad009e91716763fc11bec737695fc8b9"],
    dizzy: [5551, "fc6944490873284ef5d1f0269c677bedd3eef276bf87204fb6ede001c4fd7010"],
    focused: [4919, "9a682ce258aacf371422d44e4d3f510444f090d1fd0e3d890416ec03c822e266"],
    angry: [5316, "193c7c065ea4d9db70b8457c131b705a56db4db2cb78f683700d7bc966086f3c"],
  },
  "jocelyn-aquiline": {
    happy: [5749, "3b8322c715df3ddf354e196222dc97ac1a15cdf0776a8627c8c437128d933d60"],
    laughing: [5963, "d80c6a474cc8fe21281b16dc1634e726448d9ea7ee287b22164bde5be36b171e"],
    sad: [5384, "1086f798ba4d4f52703c9455b03ac41f45e549787c04c5d19fda62a53229d933"],
    dizzy: [5887, "fa920cf1b410df1d48c02954f3ef1c7fa8eab24c37dd82cc85354d8a90644b4e"],
    focused: [4735, "50d5e47745790ac3e9e1ecd3c32deb08554c7e9753f3956720ddca6eed49b0eb"],
    angry: [5368, "ea1cd084b54f8ac2b42f2437b859274ab74a23a25c0768d9faa95efe4fde4eb5"],
  },
} as const;

const HUMAN_FINGERPRINTS = {
  "stable-seed": {
    neutral: [3669, "f85b0909ebafc82562b0f72fb0ae4904a93533d20a3f463c28e90a82411d341c"],
    focused: [3922, "2a1e76fea8358ad3cd00c03547276cb93ae41c5b1b7822ed038c23f3b59bf15b"],
    happiness: [3429, "b011626bbf84d819c8fa3c33dba7d08fa92c8b0b31160e377c73ae9ff0562ddc"],
    sadness: [3731, "66b86f1b183f232069769da496a15df2d4b9dfac3713b654e58c8fdc2c64d825"],
    anger: [3528, "8a1ffdc47bd15565bbd7cc44011a601c8e0344ef631f28b354a7fed3029cc76c"],
    fear: [3711, "2245bfa16d5d55c840fcfd869449cfe2626780257b81d2772a17314a561a4e05"],
    surprise: [3648, "2826e50492b2767bbd4bf2e581624c4ab3aa85243d1ac0e0aeae79667c76f345"],
  },
  "čovek-seed": {
    neutral: [4027, "222c9f2d66203c4069fcec34303e11bc4f87527f059d5dda5545354ab166b43d"],
    focused: [4439, "a5fdf398c72345bac49d449aa8a6279daf577802ec7417f928fa883373a04512"],
    happiness: [3946, "c8fae556c542e3febbb091e11923a4492d851b24bc512a3e9d0852b79123b3e6"],
    sadness: [4248, "83165b2b72b307b34714810cc7027abb8673914aae0d7ec0d7f6d687b831e0b4"],
    anger: [4045, "e612d56d5f74ecfd7f060407b72e932a10ec1eeff9953d9722a4b36b8283387e"],
    fear: [4228, "8b0cc9b914f5d37a7a413de11f8c8687e341e12ca00c943fc8a22627d4fc580c"],
    surprise: [4165, "d9d9a96f58dc3e99fd3d102c41c1230f55ce55a339680570553c358073515e1d"],
  },
} as const;

async function fingerprint(value: string): Promise<Fingerprint> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    length: value.length,
    sha256: Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

Deno.test("built-in profiles preserve every bot SVG byte", async () => {
  const generator = createAvatarGenerator();
  for (const profileId of Object.keys(BUILT_IN_BOT_PROFILES)) {
    const avatar = generator.forBot(profileId as keyof typeof BUILT_IN_BOT_PROFILES);
    assertEquals(avatar.kind, "bot");
    if (avatar.kind !== "bot") continue;
    assertEquals(Object.keys(avatar.emotions), [...BOT_EMOTIONS]);
    assertStrictEquals(avatar.src, avatar.emotions.focused);
    for (const emotion of BOT_EMOTIONS) {
      const [length, sha256] =
        BOT_FINGERPRINTS[profileId as keyof typeof BOT_FINGERPRINTS][emotion];
      assertEquals(await fingerprint(avatar.emotions[emotion]), { length, sha256 });
    }
  }
});

Deno.test("generated humans preserve both seven-expression baselines", async () => {
  const generator = createAvatarGenerator();
  for (const seed of Object.keys(HUMAN_FINGERPRINTS)) {
    const avatar = generator.forHuman({ picture: null, seed });
    assertEquals(avatar.kind, "human-generated");
    if (avatar.kind !== "human-generated") continue;
    assertEquals(Object.keys(avatar.expressions), [...AVATAR_EXPRESSIONS]);
    assertStrictEquals(avatar.src, avatar.expressions.neutral);
    for (const expression of AVATAR_EXPRESSIONS) {
      const [length, sha256] =
        HUMAN_FINGERPRINTS[seed as keyof typeof HUMAN_FINGERPRINTS][expression];
      assertEquals(await fingerprint(avatar.expressions[expression]), { length, sha256 });
    }
  }
});

Deno.test("human photos bypass generation and different seeds differ", () => {
  const generator = createAvatarGenerator();
  assertEquals(generator.forHuman({ picture: "https://example.test/me.jpg", seed: "ignored" }), {
    kind: "human-photo",
    src: "https://example.test/me.jpg",
  });
  const a = generator.forHuman({ picture: null, seed: "seed-a" });
  const b = generator.forHuman({ picture: null, seed: "seed-b" });
  assert(a.kind === "human-generated" && b.kind === "human-generated");
  assert(a.src !== b.src);
});

Deno.test("factory caches preserve identity, evict FIFO, and stay isolated", () => {
  const firstFactory = createAvatarGenerator({ humanCacheLimit: 2 });
  const oldest = firstFactory.forHuman({ picture: null, seed: "oldest" });
  assertStrictEquals(firstFactory.forHuman({ picture: null, seed: "oldest" }), oldest);
  firstFactory.forHuman({ picture: null, seed: "second" });
  firstFactory.forHuman({ picture: null, seed: "third" });
  const regenerated = firstFactory.forHuman({ picture: null, seed: "oldest" });
  assertNotStrictEquals(regenerated, oldest);
  assertEquals(regenerated, oldest);

  const cachedBot = firstFactory.forBot("mason-steady");
  assertStrictEquals(firstFactory.forBot("mason-steady"), cachedBot);
  const secondFactory = createAvatarGenerator({ humanCacheLimit: 2 });
  assertNotStrictEquals(secondFactory.forBot("mason-steady"), cachedBot);
  assertNotStrictEquals(secondFactory.forHuman({ picture: null, seed: "oldest" }), regenerated);
});

Deno.test("custom profile catalogs deeply snapshot caller-owned profile data", () => {
  const mutableProfile = {
    id: "custom",
    seed: "Mason",
    steady: { eyes: "default", eyebrows: "default", mouth: "serious" },
    faceShape: { tag: "default" },
  };
  const generator = createAvatarGenerator({
    profiles: { custom: mutableProfile } as unknown as BotAvatarProfileCatalog,
  });
  const expected = createAvatarGenerator({
    profiles: {
      custom: {
        id: "custom",
        seed: "Mason",
        steady: { eyes: "default", eyebrows: "default", mouth: "serious" },
        faceShape: { tag: "default" },
      },
    },
  }).forBot("custom");

  mutableProfile.id = "renamed";
  mutableProfile.seed = "Jocelyn";
  mutableProfile.steady.eyes = "unsupported";
  mutableProfile.steady.eyebrows = "raisedExcitedNatural";
  mutableProfile.steady.mouth = "twinkle";
  mutableProfile.faceShape.tag = "aquiline";

  const avatar = generator.forBot("custom");
  assertEquals(avatar.kind, "bot");
  assertEquals(avatar, expected);
});

Deno.test("custom profile parsing observes each property once", () => {
  let seedReads = 0;
  const profile = {
    id: "custom",
    get seed(): string {
      seedReads += 1;
      return seedReads === 1 ? "Mason" : "Jocelyn";
    },
    steady: { eyes: "default", eyebrows: "default", mouth: "serious" },
    faceShape: { tag: "default" },
  };
  const generator = createAvatarGenerator({
    profiles: { custom: profile } as unknown as BotAvatarProfileCatalog,
  });
  const expected = createAvatarGenerator({
    profiles: {
      custom: {
        id: "custom",
        seed: "Mason",
        steady: { eyes: "default", eyebrows: "default", mouth: "serious" },
        faceShape: { tag: "default" },
      },
    },
  }).forBot("custom");

  assertEquals(seedReads, 1);
  assertEquals(generator.forBot("custom"), expected);
  assertEquals(seedReads, 1);
});

Deno.test("custom profile catalogs support an own __proto__ entry", () => {
  const generator = createAvatarGenerator({
    profiles: {
      ["__proto__"]: {
        id: "__proto__",
        seed: "Mason",
        steady: { eyes: "default", mouth: "serious" },
        faceShape: { tag: "default" },
      },
    },
  });

  assertEquals(generator.forBot("__proto__").kind, "bot");
});

Deno.test("generator rejects every invalid cache and custom-profile boundary", () => {
  for (
    const [label, humanCacheLimit] of [
      ["zero", 0],
      ["unsafe", Number.MAX_SAFE_INTEGER + 1],
      ["non-finite", Number.NaN],
      ["negative", -1],
      ["non-integer", 1.5],
    ] as const
  ) {
    const error = assertThrows(
      () => createAvatarGenerator({ humanCacheLimit }),
      TypeError,
      "positive safe integer",
    );
    assertStringIncludes(error.message, "positive safe integer", label);
  }

  const validProfile = () => ({
    id: "custom",
    seed: "Mason",
    steady: { eyes: "default", eyebrows: "default", mouth: "serious" },
    faceShape: { tag: "default" },
  });
  const invalidProfiles = [
    ["empty profile id", "", { ...validProfile(), id: "" }, "must match catalog key"],
    ["empty seed", "custom", { ...validProfile(), seed: "" }, "seed must not be empty"],
    ["numeric seed", "custom", { ...validProfile(), seed: 42 }, "seed must not be empty"],
    ["object seed", "custom", { ...validProfile(), seed: {} }, "seed must not be empty"],
    [
      "invalid steady eyes",
      "custom",
      { ...validProfile(), steady: { ...validProfile().steady, eyes: "closed" } },
      "invalid steady eyes",
    ],
    [
      "invalid steady eyebrows",
      "custom",
      { ...validProfile(), steady: { ...validProfile().steady, eyebrows: "angry" } },
      "invalid steady eyebrows",
    ],
    [
      "invalid steady mouth",
      "custom",
      { ...validProfile(), steady: { ...validProfile().steady, mouth: "smile" } },
      "invalid steady mouth",
    ],
    ["malformed face shape", "custom", { ...validProfile(), faceShape: {} }, "invalid face shape"],
    ["null face shape", "custom", { ...validProfile(), faceShape: null }, "invalid face shape"],
  ] as const;
  for (const [label, catalogId, profile, expectedMessage] of invalidProfiles) {
    const error = assertThrows(
      () =>
        createAvatarGenerator({
          profiles: { [catalogId]: profile } as unknown as BotAvatarProfileCatalog,
        }),
      TypeError,
      expectedMessage,
    );
    assertStringIncludes(error.message, expectedMessage, label);
  }

  assertThrows(
    () => createAvatarGenerator({ profiles: {} }),
    TypeError,
    "profiles must not be empty",
  );
  assertThrows(
    () =>
      createAvatarGenerator({
        profiles: {
          wrong: {
            id: "custom",
            seed: "Mason",
            steady: { eyes: "default", mouth: "serious" },
            faceShape: { tag: "default" },
          },
        },
      }),
    TypeError,
    "must match catalog key",
  );
  const generator = createAvatarGenerator({
    profiles: {
      custom: {
        id: "custom",
        seed: "Mason",
        steady: { eyes: "default", mouth: "serious" },
        faceShape: { tag: "default" },
      },
    },
  });
  assertThrows(
    () => generator.forBot("toString" as "custom"),
    RangeError,
    "unknown bot avatar profile: toString",
  );
  assertThrows(
    () => generator.forBot("constructor" as "custom"),
    RangeError,
    "unknown bot avatar profile: constructor",
  );
});

Deno.test("feature decomposition handles nested group-like tag names", () => {
  const synthetic = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112">` +
    `<g transform="translate(2 63)"></g>` +
    `<g transform="translate(28 51)"></g>` +
    `<g transform="translate(0 19)"><glyph/><gradient/><circle/></g>` +
    `<g transform="translate(0 11)"></g></svg>`;
  const output = decomposeFaceFeatures(synthetic, avataaarsPreset);
  assert(output.includes('<g class="face-eyes"><glyph/><gradient/><circle/></g>'));
  assert(output.includes('viewBox="14 8 84 92"'));
  assert(output.includes('class="face-mouth-cavity-plane"'));
});

Deno.test("feature decomposition tolerates a self-closing group inside a feature band", () => {
  const synthetic = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112">` +
    `<g transform="translate(0 19)"><g/><circle/></g></svg>`;
  const missing: string[] = [];
  const output = decomposeFaceFeatures(synthetic, {
    ...avataaarsPreset,
    onMissing: (entries) => missing.push(...entries.map((entry) => entry.className)),
  });
  assert(output.includes('<g class="face-eyes"><g/><circle/></g>'));
  assert(!missing.includes("face-eyes"));
});

Deno.test("feature decomposition reports exact missing-selector and unclosed-group payloads", () => {
  const input = '<svg><g transform="unclosed"><circle/></svg>';
  let missing: ReadonlyArray<{ className: string; transform: string }> = [];
  const output = decomposeFaceFeatures(input, {
    selectors: {
      absent: { transform: "missing" },
      broken: { transform: "unclosed" },
    },
    onMissing: (entries) => missing = entries,
  });

  assertEquals(output, input);
  assertEquals(missing, [
    { className: "absent", transform: "missing" },
    { className: "broken", transform: "unclosed" },
  ]);
});

Deno.test("feature decomposition inserts overlays inside masks and skips SVGs without a close", () => {
  const masked = '<svg><g mask="url(#face)"><rect/><g><circle/></g></g><path/></svg>';
  const options = {
    selectors: {},
    overlays: [{ className: "face-overlay", markup: "<ellipse/>" }],
  } as const;
  assertEquals(
    decomposeFaceFeatures(masked, options),
    '<svg><g mask="url(#face)"><rect/><g><circle/></g>' +
      '<g class="face-overlay"><ellipse/></g></g><path/></svg>',
  );

  const unclosedSvg = '<svg><g mask="url(#face)"></g>';
  assertEquals(decomposeFaceFeatures(unclosedSvg, options), unclosedSvg);
});

Deno.test("generic expressions map totally onto bot emotions", () => {
  const expected = {
    neutral: "focused",
    focused: "focused",
    happiness: "happy",
    sadness: "sad",
    anger: "angry",
    fear: "dizzy",
    surprise: "dizzy",
  } as const;
  for (const expression of AVATAR_EXPRESSIONS) {
    assertEquals(expressionVariantForBot(expression), expected[expression]);
  }
});

Deno.test("SSR renders each avatar ADT branch and escapes caller text", () => {
  const generator = createAvatarGenerator();
  const common = {
    id: "east",
    label: 'East <bot> "alert"',
    reaction: null,
    precedingReaction: null,
    microReaction: null,
    personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 0 },
  } as const;

  const bot = generator.forBot("christian-alert");
  assert(bot.kind === "bot");
  const botHtml = renderFacialRig({
    ...common,
    personality: { ...common.personality, amplitudeScale: 1.25 },
    rigKind: "bot",
    baseSvg: bot.src,
    expressionSvg: bot.emotions.happy,
    microSvg: bot.emotions.focused,
    reactionBotEmotion: "happy",
    microBotEmotion: "dizzy",
  });
  assert(botHtml.includes('data-rig-kind="bot"'));
  assert(botHtml.includes('data-rig-signature="bot:'));
  assert(botHtml.includes('style="--seat-amplitude-scale: 1.25"'));
  assert(botHtml.includes('data-reaction-bot-emotion="happy"'));
  assert(botHtml.includes('data-micro-bot-emotion="dizzy"'));
  assert(botHtml.includes('aria-label="East &lt;bot&gt; &quot;alert&quot;"'));
  assertEquals(botHtml.match(/class="avatar avatar-rigged/g)?.length, 3);

  const human = generator.forHuman({ picture: null, seed: "ssr" });
  assert(human.kind === "human-generated");
  const humanHtml = renderFacialRig({
    ...common,
    rigKind: "human-generated",
    baseSrc: human.src,
    expressionSrc: human.expressions.happiness,
    microSrc: human.expressions.focused,
    emotion: "happiness",
    width: 48,
    height: 52,
  });
  assertEquals(humanHtml.match(/<img /g)?.length, 3);
  assertEquals(humanHtml.match(/width="48" height="52"/g)?.length, 3);
  assert(humanHtml.includes('data-rig-signature="human-generated:'));

  const photoHtml = renderFacialRig({
    ...common,
    rigKind: "human-photo",
    src: "https://example.test/a.jpg?x=1&y=2",
    emotion: null,
  });
  assertEquals(photoHtml.match(/<img /g)?.length, 1);
  assert(photoHtml.includes('width="40" height="40"'));
  assert(photoHtml.includes('data-rig-signature="human-photo:'));
  assert(photoHtml.includes("x=1&amp;y=2"));
});

Deno.test("SSR serializes every reaction field and null reaction default", () => {
  const reaction: ReactionSpec = {
    kind: "turn",
    expression: "happiness",
    intensity: 3,
    motion: "pop",
    durationMs: 725,
    confidence: 0.75,
    voiceCue: "laugh",
    id: 42,
  };
  const html = renderFacialRig({
    id: "reaction-fields",
    label: "Reaction fields",
    reaction,
    precedingReaction: null,
    microReaction: null,
    personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 0.2 },
    rigKind: "human-photo",
    src: "photo-source",
    emotion: null,
  });
  const active = {
    kind: "turn",
    expression: "happiness",
    intensity: "3",
    motion: "pop",
    "duration-ms": "725",
    confidence: "0.75",
    "voice-cue": "laugh",
    id: "42",
  } as const;
  for (const [field, value] of Object.entries(active)) {
    assertStringIncludes(html, `data-reaction-${field}="${value}"`);
  }

  const defaults = {
    kind: "",
    expression: "",
    intensity: "0",
    motion: "",
    "duration-ms": "0",
    confidence: "1",
    "voice-cue": "",
    id: "0",
  } as const;
  for (const prefix of ["preceding", "micro"] as const) {
    for (const [field, value] of Object.entries(defaults)) {
      assertStringIncludes(html, `data-${prefix}-${field}="${value}"`);
    }
  }
});

Deno.test("SSR clamps finite confidence and maps non-finite confidence to one", () => {
  for (
    const [label, confidence, expected] of [
      ["below zero", -0.5, 0],
      ["above one", 1.5, 1],
      ["NaN", Number.NaN, 1],
      ["positive infinity", Number.POSITIVE_INFINITY, 1],
      ["negative infinity", Number.NEGATIVE_INFINITY, 1],
    ] as const
  ) {
    const html = renderFacialRig({
      id: "confidence",
      label: "Confidence",
      reaction: {
        expression: "focused",
        intensity: 1,
        motion: "sink",
        durationMs: 100,
        confidence,
        voiceCue: "sigh",
        id: 1,
      },
      precedingReaction: null,
      microReaction: null,
      personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 0 },
      rigKind: "human-photo",
      src: "photo-source",
      emotion: null,
    });
    assertStringIncludes(html, `data-reaction-confidence="${expected}"`, label);
  }
});

Deno.test("SSR pins rig signatures for each avatar substrate", () => {
  const common = {
    id: "signature",
    label: "Signature",
    reaction: null,
    precedingReaction: null,
    microReaction: null,
    personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 0 },
  } as const;
  const cases = [
    [
      renderFacialRig({
        ...common,
        rigKind: "bot",
        baseSvg: "<svg></svg>",
        expressionSvg: "<svg></svg>",
        microSvg: "<svg></svg>",
      }),
      "bot:1ucyux6",
    ],
    [
      renderFacialRig({
        ...common,
        rigKind: "human-generated",
        baseSrc: "base-source",
        expressionSrc: "expression",
        microSrc: "micro",
        emotion: null,
      }),
      "human-generated:1q22ogw",
    ],
    [
      renderFacialRig({
        ...common,
        rigKind: "human-photo",
        src: "photo-source",
        emotion: null,
      }),
      "human-photo:mjgbzt",
    ],
  ] as const;
  for (const [html, signature] of cases) {
    assertStringIncludes(html, `data-rig-signature="${signature}"`);
  }
  const botHtml = cases[0][0];
  assertStringIncludes(botHtml, 'data-reaction-bot-emotion=""');
  assertStringIncludes(botHtml, 'data-micro-bot-emotion=""');
  assertEquals(botHtml.includes("--seat-amplitude-scale"), false);
});

Deno.test("SSR escapes rig IDs", () => {
  const common = {
    id: 'east" onpointerenter="globalThis.pwned=1',
    label: "East",
    reaction: null,
    precedingReaction: null,
    microReaction: null,
    personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 0 },
  } as const;
  const humanHtml = renderFacialRig({
    ...common,
    rigKind: "human-generated",
    baseSrc: "data:image/svg+xml,safe",
    expressionSrc: "data:image/svg+xml,safe",
    microSrc: "data:image/svg+xml,safe",
    emotion: null,
  });
  assert(!humanHtml.includes('onpointerenter="globalThis.pwned=1"'));
  assert(humanHtml.includes("east&quot; onpointerenter=&quot;globalThis.pwned=1"));
});

Deno.test("SSR rejects every unsafe SVG class with a warned blank layer", () => {
  const safeSvg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  const rejectionCases = [
    ["absent root", "", "incomplete root"],
    ["malformed root", "<g></g>", "root element"],
    ["unbalanced root", "<svg><path></svg>", "unbalanced element svg"],
    ["duplicate roots", "<svg></svg><svg></svg>", "root element"],
    ["content outside root", "<svg></svg>trailing", "content after root"],
    ["forbidden element", "<svg><script></script></svg>", "element script"],
    ["forbidden attribute", '<svg onload="run()"></svg>', "attribute onload"],
    ["unquoted attribute", "<svg width=1></svg>", "attributes on svg"],
    [
      "external CSS URL",
      '<svg><path fill="url(https://example.test/fill)"/></svg>',
      "URL for fill",
    ],
    ["JavaScript URL", '<svg><path fill="javascript:run()"/></svg>', "value for fill"],
    ["HTML data URL", '<svg><path fill="data:text/html,run"/></svg>', "value for fill"],
  ] as const;
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    for (const [label, unsafeSvg] of rejectionCases) {
      const html = renderFacialRig({
        id: "unsafe",
        label: "Unsafe",
        reaction: null,
        precedingReaction: null,
        microReaction: null,
        personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 0 },
        rigKind: "bot",
        baseSvg: unsafeSvg,
        expressionSvg: safeSvg,
        microSvg: safeSvg,
      });
      assertEquals(html.match(/viewBox="0 0 1 1"/g)?.length, 1, label);
      assertStringIncludes(html, 'class="avatar avatar-rigged avatar-base"', label);
      if (unsafeSvg !== "") assertEquals(html.includes(unsafeSvg), false, label);
    }
  } finally {
    console.warn = realWarn;
  }
  assertEquals(
    warnings,
    rejectionCases.map(([, , reason]) =>
      `avatar: unsafe inline SVG rejected (${reason}); rendering a blank layer`
    ),
  );
});

Deno.test("SSR keeps replacement patterns in caller text literal", () => {
  const generator = createAvatarGenerator();
  const bot = generator.forBot("christian-alert");
  assert(bot.kind === "bot");
  const html = renderFacialRig({
    id: "seat-$&-1",
    label: "Bot $& $` $' name",
    reaction: null,
    precedingReaction: null,
    microReaction: null,
    personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 1 },
    rigKind: "bot",
    baseSvg: bot.src,
    expressionSvg: bot.emotions.happy,
    microSvg: bot.emotions.focused,
  });
  assertStringIncludes(html, 'aria-label="Bot $&amp; $` $&#39; name"');
  assertStringIncludes(html, 'id="avatar-seat-$&amp;-1"');
  assert(!html.includes("<svgamp;"));
});
