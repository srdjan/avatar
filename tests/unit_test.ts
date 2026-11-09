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
  type FacialReaction,
  parseFacialReactionIdentity,
} from "@srdjan/avatar";
import {
  avataaarsPreset,
  createRigControlBank,
  decomposeFaceFeatures,
  expressionVariantForBot,
  renderFacialRig,
} from "@srdjan/avatar/server";

type Fingerprint = Readonly<{ length: number; sha256: string }>;

const BOT_FINGERPRINTS = {
  "mason-steady": {
    happy: [5431, "309c88f6be883949a2be298f298855c4b9987399f7e691f7f45c9cc916e4b0b5"],
    laughing: [5645, "f23bd4f746d2deffcdc9611f73ea13b8217d095749c164f8a5f149b3a989bf1c"],
    sad: [5066, "d8dfd6c965b76eb0013def80f16271ea55665627639de6e7f9aa3f295279dada"],
    dizzy: [5569, "241a8fa6fb1652c103a40066cdf822555ed9b689a5398f6ca2105edf7c017461"],
    focused: [4812, "65d26cccf414ecdef5efbdaec71d8fff1f0f8e4672c3da8dacf45a55791d366c"],
    angry: [5316, "d9d6753b13d0f5c29ebbc81377f9a821b45216e1165f0675d878b38d699d4359"],
  },
  "christian-alert": {
    happy: [5413, "937092100f8d1680ec36e2fa932e141496432d4ec987ef89d057409f42ef002f"],
    laughing: [5627, "d8dc6b85d02046d1b09668a19fb80c2e3512380a5b3a82bf6870682478abfcc0"],
    sad: [5048, "acf406cec8c0a7006505dc3570f133854298ec4712c90e11959e8838fd43580b"],
    dizzy: [5551, "658f462b0c5a13054ced69a98642ad26c0dfbb1b5aed4593166165f92c0aadee"],
    focused: [4919, "1b654b402b1df867c5db20326518019c7ae02edb41219bed59861d4da8d2f51d"],
    angry: [5316, "ca8e8192db9ac7733248184f93f19793a046d7c7cdba953505befede1561aece"],
  },
  "jocelyn-aquiline": {
    happy: [5749, "6d0c676210cf4bcbafb6406dcb3b4deb66f46c521d6617b489eaede2f1b7adcd"],
    laughing: [5963, "0e15c5d1b2a6bc7d0fbe281e34d1c346701b4fd05842aa250ae7bcb319044e69"],
    sad: [5384, "62897720f120dd76d68d289e44b442c11c334a65adbbad41d309002ab53e2b77"],
    dizzy: [5887, "0075306783cebc0f8f4180ac3c36ae742fe96b433900aaee5245b63d98a15c4d"],
    focused: [4735, "33db34ad772225201d8ff44c4c33f3eb371a8561a6c2a968eda90ab6163ebedf"],
    angry: [5368, "670de4548121c56c217108d9e107905e3addd0a16ae5b9d10374806e593170d3"],
  },
} as const;

const HUMAN_FINGERPRINTS = {
  "stable-seed": {
    neutral: [3669, "d69d677987f4b523d194346d3c4284ea5489e19f7ad0f464b04bbe88c2d4b8a4"],
    focused: [3922, "3a3434ddaefb4af21f998adbfe62da275861b1b4180487628aa0e95361df97d2"],
    happiness: [3429, "ac293c05e785ac914b0b56ac7913f3fd5d719d64252ffac78e6a969ab38bb21d"],
    sadness: [3731, "ae540fd0773d9b50e62da62f705bc62da4a951d05cec1101c6fcf3a0c7cbe087"],
    anger: [3528, "5866a714b8c70535e0075c3ce708d291cb2c7bc95de8740e9beaabbafe5f86cd"],
    fear: [3711, "4e216ada279fd10fe0ad1865f33c194d1e86ba5450791517116e63f7493c74f5"],
    surprise: [3648, "2599e64f75d35f32062e4f230511bc87259961c3c27f9f6f6075e23026edb222"],
  },
  "čovek-seed": {
    neutral: [4027, "077426721ea27e742831d45b2c302a387fadd901d256559228c6d39fd3b63f30"],
    focused: [4439, "051b188716e9b7fe6736015162d53d9c1cef7c3581f35cca2c02b25719e371a9"],
    happiness: [3946, "a4e8d389bb1fdde2273bada8afaaeb494cf3861462a37cf8a388666c02cda1f1"],
    sadness: [4248, "adfacfcd983f4c85bfa9b47a2953ee4e4c601ca5ea814df010337499ca77b554"],
    anger: [4045, "53a431022f66d5608b68678c6160c628e97a016ad2bc39f1b739d7730db552ec"],
    fear: [4228, "ddf63593de39a96684b150769363bef302e333cee968130e3cd49c847318be35"],
    surprise: [4165, "52295e48f4d9b36e1df8383fadd427b2dcf308e1018b1c837875a0ff3bc16fc7"],
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

Deno.test("built-in bots wear distinct pastel skins", () => {
  const generator = createAvatarGenerator();
  const mason = generator.forBot("mason-steady");
  const christian = generator.forBot("christian-alert");
  const jocelyn = generator.forBot("jocelyn-aquiline");
  assertStringIncludes(mason.src, 'fill="#a9d6c4"');
  assertStringIncludes(christian.src, 'fill="#b9c8ee"');
  assertStringIncludes(jocelyn.src, 'fill="#f2c4a8"');
});

Deno.test("generated humans draw dark-brown ink on a paper background", () => {
  const avatar = createAvatarGenerator().forHuman({ picture: null, seed: "stable-seed" });
  assertEquals(avatar.kind, "human-generated");
  if (avatar.kind !== "human-generated") return;
  const svg = decodeURIComponent(avatar.src);
  assertStringIncludes(svg, '<rect fill="#f5e0bd" width="600" height="600"');
  assertStringIncludes(svg, "#3a2e26");
});

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
    matchScope: "match-1",
    audioProfileId: "bot-east",
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
  });
  assert(botHtml.includes('data-rig-kind="bot"'));
  assert(botHtml.includes('data-rig-signature="bot:'));
  assert(botHtml.includes('style="--seat-amplitude-scale: 1.25"'));
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

Deno.test("control artwork banks map every preset and gesture by substrate", () => {
  const generator = createAvatarGenerator();
  const bot = generator.forBot("mason-steady");
  assert(bot.kind === "bot");
  const botBank = createRigControlBank(bot);
  assert(botBank !== null && botBank.rigKind === "bot");
  assertEquals(Object.keys(botBank.layers), [
    "neutral",
    "focused",
    "smile",
    "sad",
    "worry",
    "mad",
    "surprised",
    "laugh",
  ]);
  assertStrictEquals(botBank.layers.neutral, bot.emotions.focused);
  assertStrictEquals(botBank.layers.smile, bot.emotions.happy);
  assertStrictEquals(botBank.layers.worry, bot.emotions.dizzy);
  assertStrictEquals(botBank.layers.laugh, bot.emotions.laughing);

  const human = generator.forHuman({ picture: null, seed: "control-bank" });
  assert(human.kind === "human-generated");
  const humanBank = createRigControlBank(human);
  assert(humanBank !== null && humanBank.rigKind === "human-generated");
  assertStrictEquals(humanBank.layers.smile, human.expressions.happiness);
  assertStrictEquals(humanBank.layers.worry, human.expressions.fear);
  assertStrictEquals(humanBank.layers.mad, human.expressions.anger);
  assertStrictEquals(humanBank.layers.laugh, human.expressions.happiness);

  assertEquals(
    createRigControlBank(generator.forHuman({ picture: "photo.jpg", seed: "ignored" })),
    null,
  );
});

Deno.test("SSR renders validated opt-in control banks without changing the default markup", () => {
  const generator = createAvatarGenerator();
  const bot = generator.forBot("mason-steady");
  assert(bot.kind === "bot");
  const common = {
    id: "controlled",
    label: "Controlled bot",
    matchScope: "match-1",
    audioProfileId: "bot-controlled",
    reaction: null,
    precedingReaction: null,
    microReaction: null,
    personality: { amplitudeScale: 1, durationScale: 0.8, audioProbability: 0 },
    rigKind: "bot",
    baseSvg: bot.src,
    expressionSvg: bot.emotions.focused,
    microSvg: bot.emotions.focused,
  } as const;
  const withoutBank = renderFacialRig(common);
  assertEquals(withoutBank.includes("avatar-control-layer"), false);
  assertStringIncludes(withoutBank, 'data-seat-duration-scale="0.8"');

  const withBank = renderFacialRig({
    ...common,
    controlBank: createRigControlBank(bot),
  });
  assertEquals(withBank.match(/class="avatar-control-layer"/g)?.length, 6);
  assertEquals(
    withBank.match(/class="avatar avatar-rigged avatar-control-expression"/g)?.length,
    6,
  );
  assertStringIncludes(withBank, 'data-control-layer="worry surprised"');
  assertStringIncludes(withBank, 'data-control-layer="laugh"');
  assertStringIncludes(withBank, 'aria-hidden="true"');

  const controlBank = createRigControlBank(bot);
  const reorderedBank = {
    ...controlBank,
    layers: Object.fromEntries(Object.entries(controlBank.layers).reverse()),
  } as typeof controlBank;
  const reordered = renderFacialRig({ ...common, controlBank: reorderedBank });
  assertEquals(
    reordered.match(/data-rig-signature="([^"]+)"/)?.[1],
    withBank.match(/data-rig-signature="([^"]+)"/)?.[1],
  );

  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    const unsafeBank = {
      ...createRigControlBank(bot),
      layers: {
        ...createRigControlBank(bot).layers,
        smile: '<svg><script onload="pwn()"></script></svg>',
      },
    };
    const sanitized = renderFacialRig({ ...common, controlBank: unsafeBank });
    assertEquals(sanitized.includes("<script"), false);
    assertEquals(sanitized.match(/viewBox="0 0 1 1"/g)?.length, 1);
  } finally {
    console.warn = realWarn;
  }
  assertEquals(warnings, [
    "avatar: unsafe inline SVG rejected (element script); rendering a blank layer",
  ]);
});

Deno.test("SSR serializes escaped atomic reactions and emits all three lanes", () => {
  const identity = parseFacialReactionIdentity("match-1:hand-1:event-42");
  if (identity.tag !== "accepted") throw new Error("test identity rejected");
  const reaction: FacialReaction = {
    identity: identity.identity,
    state: "smile",
    kind: "turn",
    intensity: 3,
    motion: "pop",
    durationMs: 725,
    confidence: 0.75,
    gesture: "laugh",
    qualifier: "climactic",
  };
  const html = renderFacialRig({
    id: "reaction-fields",
    label: "Reaction fields",
    matchScope: 'match-1" exact',
    audioProfileId: "bot-east",
    reaction,
    precedingReaction: null,
    microReaction: null,
    personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 0.2 },
    rigKind: "human-photo",
    src: "photo-source",
    emotion: null,
  });
  const serialized = JSON.stringify(reaction).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  assertStringIncludes(html, 'data-match-scope="match-1&quot; exact"');
  assertStringIncludes(html, 'data-audio-profile-id="bot-east"');
  assertStringIncludes(html, `data-reaction="${serialized}"`);
  assertStringIncludes(html, 'data-preceding-reaction="null"');
  assertStringIncludes(html, 'data-micro-reaction="null"');
  assertEquals(html.includes("data-reaction-kind"), false);
  assertEquals(html.includes("data-reaction-voice-cue"), false);
});

Deno.test("SSR pins rig signatures for each avatar substrate", () => {
  const common = {
    id: "signature",
    label: "Signature",
    matchScope: "match-1",
    audioProfileId: "profile-1",
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
  assertEquals(botHtml.includes("--seat-amplitude-scale"), false);
});

Deno.test("SSR escapes rig IDs", () => {
  const common = {
    id: 'east" onpointerenter="globalThis.pwned=1',
    label: "East",
    matchScope: "match-1",
    audioProfileId: "profile-1",
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
    ["invalid markup", "<svg><</svg>", "invalid markup"],
    ["unbalanced root", "<svg><path></svg>", "unbalanced element svg"],
    ["attributes on closing element", '<svg></svg class="closing">', "closing element svg"],
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
    [
      "entity-obfuscated CSS URL",
      '<svg><path fill="u&#114;l(https://example.test/fill)"/></svg>',
      "URL for fill",
    ],
    [
      "escaped CSS URL",
      String.raw`<svg><path fill="u\72 l(https://example.test/fill)"/></svg>`,
      "URL for fill",
    ],
    ["CSS variable URL", '<svg><path fill="var(--external-paint)"/></svg>', "URL for fill"],
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
        matchScope: "match-1",
        audioProfileId: "profile-1",
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
    matchScope: "match-1",
    audioProfileId: "profile-1",
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
