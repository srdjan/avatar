import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { fileURLToPath } from "node:url";
import {
  CHARACTER_AUDIO_PROFILE_SLOTS,
  type CharacterAudioProfile,
  type CharacterAudioProfileCatalog,
  FACIAL_REACTION_GESTURES,
  FACIAL_REACTION_STATES,
  type FacialReaction,
  type FacialRigApi,
  type FacialRigInitConfig,
  type FacialRigInitReceipt,
  type FacialRigSemanticAudioDetail,
  LAUGHTER_QUALIFIERS,
  parseCharacterAudioProfileId,
  parseFacialReactionIdentity,
  type RigControlCommand,
  SEMANTIC_AUDIO_FAMILIES,
  type SemanticAudioDecision,
} from "@srdjan/avatar";
import { AVATAR_ASSETS, AVATAR_AUDIO_ASSETS } from "@srdjan/avatar/assets";
import {
  checkPackageIntegrity,
  type PackageIntegrityManifest,
} from "../tools/package_integrity.ts";

const EXPECTED_HASHES: Readonly<Record<keyof typeof AVATAR_ASSETS, string>> = {
  facialRigScript: "a05893810c978c11f13cb9dd2213ea6b5fe5fc6320531ed13f0a07aaffdfe609",
  facialRigStyles: "67526d26dd038ab0e69e3b6cd0a2cc73f3132647033a96a6423a7f2e781f83e9",
  haha: "838c4863398dba33f794faf5a640d592fa577e420a57114ef7d113d146532ca2",
  hahaha: "20351581b4b41bb7ed9eae615793598d9140c7202a5557f548d7d903aedb72cc",
  nenene: "f218486f54ad12c226d31bbc065251bb6187e2fbdd08c60db040eb075c193bc3",
  opa: "e6e61ec60fc3249703d0418036880e3d19805bfd78e2da174b5e230e46dbbea0",
  ufNanumu: "765b98cbfa41e5c336f9b266a02740f8d1d94378747c781cc72ff56cda586f92",
  silence: "1aecf95d1a94d7002d68e9647e3c90f71383dbfd6638bf133eed63245a2eec1d",
};

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type AssertTrue<Value extends true> = Value;
type IsNever<Value> = [Value] extends [never] ? true : false;

const FACIAL_RIG_PLAY_IS_ABSENT: AssertTrue<
  "play" extends keyof FacialRigApi ? false : true
> = true;
const CONTROL_TRIGGER_IS_ABSENT: AssertTrue<
  IsNever<Extract<RigControlCommand, { tag: "trigger" }>>
> = true;

const PACKAGE_ROOT = new URL("../", import.meta.url);
const PACKAGE_INTEGRITY_PATH = new URL("package.integrity.json", PACKAGE_ROOT);

Deno.test("asset manifest is complete, typed, readable, and byte-pinned", async () => {
  assertEquals(Object.keys(AVATAR_ASSETS), [
    "facialRigScript",
    "facialRigStyles",
    "haha",
    "hahaha",
    "nenene",
    "opa",
    "ufNanumu",
    "silence",
  ]);
  for (const [id, descriptor] of Object.entries(AVATAR_ASSETS)) {
    const bytes = await Deno.readFile(descriptor.url);
    assert(bytes.byteLength > 0);
    assertEquals(descriptor.id, id);
    assertEquals(await sha256(bytes), EXPECTED_HASHES[id as keyof typeof AVATAR_ASSETS]);
    assert(
      descriptor.mimeType === "audio/mpeg" ||
        descriptor.mimeType === "text/javascript; charset=utf-8" ||
        descriptor.mimeType === "text/css; charset=utf-8",
    );
  }
  assertEquals(
    AVATAR_AUDIO_ASSETS.map((asset) => asset.id),
    ["haha", "hahaha", "nenene", "opa", "ufNanumu", "silence"],
  );
});

Deno.test("public reaction, profile, init, and semantic contracts are complete", async () => {
  const rootSymbols = await publicSymbolNames(new URL("../mod.ts", import.meta.url));
  const assetSymbols = await publicSymbolNames(new URL("../assets/mod.ts", import.meta.url));
  for (
    const symbol of [
      "CHARACTER_AUDIO_PROFILE_SLOTS",
      "CharacterAudioProfile",
      "CharacterAudioProfileCatalog",
      "CharacterAudioProfileId",
      "FACIAL_REACTION_GESTURES",
      "FACIAL_REACTION_STATES",
      "FacialReaction",
      "FacialReactionIdentity",
      "FacialRigApi",
      "FacialRigInitConfig",
      "FacialRigInitReceipt",
      "FacialRigSemanticAudioDetail",
      "LAUGHTER_QUALIFIERS",
      "parseCharacterAudioProfileId",
      "parseFacialReactionIdentity",
      "SEMANTIC_AUDIO_FAMILIES",
      "SemanticAudioDecision",
      "SemanticAudioFamily",
      "StateSemanticAudio",
    ]
  ) {
    assert(rootSymbols.includes(symbol), `missing public root symbol: ${symbol}`);
  }
  for (const removed of ["ReactionSpec", "RigVoiceCue"]) {
    assertEquals(rootSymbols.includes(removed), false, `removed root symbol remains: ${removed}`);
  }
  assertEquals(assetSymbols.includes("DEFAULT_VOICE_PACK"), false);
  assertEquals(FACIAL_RIG_PLAY_IS_ABSENT, true);
  assertEquals(CONTROL_TRIGGER_IS_ABSENT, true);

  assertEquals(FACIAL_REACTION_STATES, [
    "neutral",
    "focused",
    "smile",
    "sad",
    "worry",
    "mad",
    "surprised",
  ]);
  assertEquals(FACIAL_REACTION_GESTURES, ["laugh"]);
  assertEquals(LAUGHTER_QUALIFIERS, ["standard", "climactic"]);
  assertEquals(SEMANTIC_AUDIO_FAMILIES, [
    "Happiness",
    "Sadness",
    "Worry",
    "Anger",
    "Surprise",
    "Laughter",
  ]);
  assertEquals(CHARACTER_AUDIO_PROFILE_SLOTS, [
    "Happiness",
    "Sadness",
    "Worry",
    "Anger",
    "Surprise",
    "Laughter.standard",
    "Laughter.climactic",
  ]);

  const identity = parseFacialReactionIdentity("match-1:hand-1:event-1");
  const profileId = parseCharacterAudioProfileId("bot-steady");
  assertEquals(identity.tag, "accepted");
  assertEquals(profileId.tag, "accepted");
  if (identity.tag !== "accepted" || profileId.tag !== "accepted") return;

  const stateOnly = {
    identity: identity.identity,
    state: "smile",
    kind: "TrickWon",
    intensity: 2,
    motion: "pop",
    durationMs: 900,
    confidence: 0.8,
  } as const satisfies FacialReaction;
  const standardLaugh = {
    ...stateOnly,
    gesture: "laugh",
    qualifier: "standard",
  } as const satisfies FacialReaction;
  const profile = completeCharacterAudioProfile();
  const profiles = { "bot-steady": profile } satisfies CharacterAudioProfileCatalog;
  const config = {
    audioProfiles: profiles,
    silenceSrc: AVATAR_ASSETS.silence.url.href,
    isAudioEnabled: () => true,
  } satisfies FacialRigInitConfig;
  const initReceipt = { tag: "accepted" } as const satisfies FacialRigInitReceipt;
  const semantic = {
    tag: "audible",
    family: "Laughter",
    qualifier: "standard",
  } as const satisfies SemanticAudioDecision;
  const detail = {
    family: "Laughter",
    qualifier: "standard",
    profileId: profileId.profileId,
    identity: standardLaugh.identity,
    src: profile["Laughter.standard"].src,
    gain: profile["Laughter.standard"].gain,
    state: standardLaugh.state,
    gesture: standardLaugh.gesture,
    kind: standardLaugh.kind,
    intensity: standardLaugh.intensity,
    confidence: standardLaugh.confidence,
    durationMs: standardLaugh.durationMs,
    rigKind: "bot",
    rigId: "avatar-rig-east",
    seatId: "east",
    seatAudioProbability: 1,
  } satisfies FacialRigSemanticAudioDetail;
  assertEquals(config.audioProfiles["bot-steady"], profile);
  assertEquals(initReceipt.tag, "accepted");
  assertEquals(semantic, { tag: "audible", family: "Laughter", qualifier: "standard" });
  assertEquals(detail.identity, stateOnly.identity);
});

Deno.test("public package boundary has exactly three entry points", async () => {
  const config = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url)));
  assertEquals(config.name, "@srdjan/avatar");
  assertEquals(config.version, "0.6.0");
  assertEquals(config.exports, {
    ".": "./mod.ts",
    "./server": "./server/mod.ts",
    "./assets": "./assets/mod.ts",
  });
  assertEquals("publish" in config, false);
  assertEquals(JSON.stringify(config).includes("jsr:@srdjan/avatar"), false);
});

Deno.test("package integrity closure is sorted, declared, and valid", async () => {
  const manifest = await readPackageIntegrityManifest(PACKAGE_INTEGRITY_PATH);
  const paths = manifest.files.map((entry) => entry.path);
  assertEquals(paths, [...paths].sort());
  for (
    const required of [
      "deno.json",
      "mod.ts",
      "types.ts",
      "assets/mod.ts",
      "browser/facial_rig.ts",
      "browser/runtime_core.ts",
      "internal/generator.ts",
      "server/mod.ts",
      "server/render.ts",
      "tools/build_facial_rig.ts",
      "tools/package_integrity.ts",
      "tools/runtime_metrics.ts",
    ]
  ) {
    assert(paths.includes(required), `integrity closure is missing ${required}`);
  }
  for (const descriptor of Object.values(AVATAR_ASSETS)) {
    const path = descriptor.url.href.slice(PACKAGE_ROOT.href.length);
    assert(paths.includes(path), `declared asset is missing from integrity closure: ${path}`);
  }
  for (
    const excluded of [
      "AGENTS.md",
      "ASSUMPTIONS.md",
      "CLAUDE.md",
      "README.md",
      "deno.lock",
      "package.integrity.json",
    ]
  ) {
    assertEquals(paths.includes(excluded), false, `excluded file entered closure: ${excluded}`);
  }
  assertEquals(paths.some((path) => path.startsWith("docs/")), false);
  assertEquals(paths.some((path) => path.startsWith("fixtures/")), false);
  assertEquals(paths.some((path) => path.startsWith("tests/")), false);
  assertEquals(await checkPackageIntegrity(PACKAGE_ROOT), {
    tag: "valid",
    entryCount: manifest.files.length,
  });
});

Deno.test("package integrity check reports changed files without writing", async () => {
  await withIntegrityFixture(async (root) => {
    const manifestPath = new URL("package.integrity.json", root);
    const before = await Deno.readTextFile(manifestPath);
    await Deno.writeTextFile(new URL("types.ts", root), "// changed\n", { append: true });
    const result = await checkPackageIntegrity(root);
    assertEquals(result.tag, "invalid");
    if (result.tag === "invalid") {
      assert(result.issues.some((issue) => issue.tag === "changed" && issue.path === "types.ts"));
    }
    assertEquals(await Deno.readTextFile(manifestPath), before);
  });
});

Deno.test("package integrity check reports missing files", async () => {
  await withIntegrityFixture(async (root) => {
    await Deno.remove(new URL("internal/generator.ts", root));
    const result = await checkPackageIntegrity(root);
    assertEquals(result.tag, "invalid");
    if (result.tag === "invalid") {
      assert(
        result.issues.some((issue) =>
          issue.tag === "missing" && issue.path === "internal/generator.ts"
        ),
      );
    }
  });
});

Deno.test("package integrity check reports newly added behavior files", async () => {
  await withIntegrityFixture(async (root) => {
    await Deno.writeTextFile(
      new URL("browser/extra_behavior.ts", root),
      "export const extra = 1;\n",
    );
    const result = await checkPackageIntegrity(root);
    assertEquals(result.tag, "invalid");
    if (result.tag === "invalid") {
      assert(
        result.issues.some((issue) =>
          issue.tag === "extra" && issue.path === "browser/extra_behavior.ts"
        ),
      );
    }
  });
});

Deno.test("package integrity rejects symlinks and escaping manifest paths", async () => {
  await withIntegrityFixture(async (root) => {
    await Deno.symlink(
      new URL("types.ts", root),
      new URL("browser/symlinked_behavior.ts", root),
    );
    await assertRejects(
      () => checkPackageIntegrity(root),
      Error,
      "symbolic link",
    );
  });
  await withIntegrityFixture(async (root) => {
    const path = new URL("package.integrity.json", root);
    const manifest = await readPackageIntegrityManifest(path);
    const [first, ...rest] = manifest.files;
    assert(first !== undefined);
    await Deno.writeTextFile(
      path,
      JSON.stringify({ ...manifest, files: [{ ...first, path: "../outside.ts" }, ...rest] }),
    );
    await assertRejects(
      () => checkPackageIntegrity(root),
      Error,
      "unsafe integrity path",
    );
  });
});

Deno.test("package sources have no Preferans imports", async () => {
  const root = new URL("../", import.meta.url);
  for await (const entry of walkTypeScript(root)) {
    const source = await Deno.readTextFile(entry);
    const importSpecifiers = [...source.matchAll(/(?:from\s+|import\s*\()["']([^"']+)["']/g)]
      .map((match) => match[1]);
    assertEquals(importSpecifiers.some((specifier) => specifier?.includes("preferans")), false);
  }
});

Deno.test("public root import graph stays inside the package and excludes Preferans", async () => {
  const publicRoot = new URL("../mod.ts", import.meta.url);
  const output = await new Deno.Command("deno", {
    args: ["info", "--json", fileURLToPath(publicRoot)],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));

  const info = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    roots: string[];
    modules: Array<{ specifier: string }>;
  };
  assertEquals(info.roots, [publicRoot.href]);
  const specifiers = info.modules.map((module) => module.specifier);
  assert(specifiers.includes(publicRoot.href));
  const packageRoot = new URL("../", import.meta.url).href;
  const localSpecifiers = specifiers.filter((specifier) => specifier.startsWith("file:"));
  for (const specifier of localSpecifiers) {
    assert(specifier.startsWith(packageRoot), `outside package root: ${specifier}`);
  }
  assertEquals(
    localSpecifiers.map((specifier) => specifier.slice(packageRoot.length)).sort(),
    [
      "internal/generator.ts",
      "mod.ts",
      "server/avataaars_preset.ts",
      "server/decompose.ts",
      "types.ts",
    ],
  );
  assertEquals(
    specifiers.filter((specifier) => specifier.startsWith("npm:")).sort(),
    [
      "npm:/@dicebear/avataaars-neutral@9.4.2",
      "npm:/@dicebear/core@9.4.3",
      "npm:/@dicebear/lorelei-neutral@9.4.2",
    ],
  );
  assertEquals(specifiers.length, 8);
  assertEquals(
    specifiers.some((specifier) => specifier.toLowerCase().includes("preferans")),
    false,
  );
});

Deno.test("browser assets retain iOS guards and drop the consumer seat branch", async () => {
  const js = await Deno.readTextFile(AVATAR_ASSETS.facialRigScript.url);
  const css = await Deno.readTextFile(AVATAR_ASSETS.facialRigStyles.url);
  assert(js.startsWith("// Generated by `deno task browser:build`. Do not edit."));
  assert(js.includes("function isIOSCompositorGuard()"));
  assert(
    /function startAutonomousIdleLoop\([^)]*\) \{[\s\S]*?if \(isIOSCompositorGuard\(\)\) return;/
      .test(js),
  );
  assert(
    /function startBlinkLoop\(rig\) \{[\s\S]*?if \(isIOSCompositorGuard\(\)\) return;/.test(js),
  );
  assert(css.includes("-webkit-touch-callout: none"));
  assert(css.includes("animation: none"));
  assertEquals(js.includes('rig.closest(".seat")'), false);
  assertEquals(js.includes('classList.contains("is-turn")'), false);
  assertEquals(js.includes('classList.contains("is-ai")'), false);
});

Deno.test("standalone CSS defines package variables through consumer-token fallbacks", async () => {
  const css = await Deno.readTextFile(AVATAR_ASSETS.facialRigStyles.url);
  const expected = {
    "--avatar-primary": "var(--primary, #d8c4a2)",
    "--avatar-primary-fixed": "var(--primary-fixed, #f5e0bd)",
    "--avatar-secondary": "var(--secondary, #b6ccb7)",
    "--avatar-tertiary": "var(--tertiary, #e9bf90)",
    "--avatar-ivory-faint": "var(--ivory-faint, #c3c8c1)",
    "--avatar-red-suit": "var(--red-suit, #8d3d34)",
  } as const;
  for (const [property, value] of Object.entries(expected)) {
    assert(css.includes(`${property}: ${value};`));
  }
});

async function* walkTypeScript(directory: URL): AsyncGenerator<URL> {
  for await (const entry of Deno.readDir(directory)) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const url = new URL(entry.name + (entry.isDirectory ? "/" : ""), directory);
    if (entry.isDirectory) yield* walkTypeScript(url);
    else if (entry.name.endsWith(".ts")) yield url;
  }
}

function completeCharacterAudioProfile(): CharacterAudioProfile {
  return {
    Happiness: { src: AVATAR_ASSETS.opa.url.href, gain: 0.8 },
    Sadness: { src: AVATAR_ASSETS.ufNanumu.url.href, gain: 0.7 },
    Worry: { src: AVATAR_ASSETS.nenene.url.href, gain: 0.65 },
    Anger: { src: AVATAR_ASSETS.ufNanumu.url.href, gain: 0.85 },
    Surprise: { src: AVATAR_ASSETS.opa.url.href, gain: 0.9 },
    "Laughter.standard": { src: AVATAR_ASSETS.haha.url.href, gain: 0.75 },
    "Laughter.climactic": { src: AVATAR_ASSETS.hahaha.url.href, gain: 1 },
  };
}

async function publicSymbolNames(module: URL): Promise<string[]> {
  const output = await new Deno.Command("deno", {
    args: ["doc", "--json", fileURLToPath(module)],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  const doc = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    nodes: Record<string, { symbols: Array<{ name: string }> }>;
  };
  const node = doc.nodes[module.href];
  assert(node !== undefined, `deno doc omitted ${module.href}`);
  return node.symbols.map((symbol) => symbol.name).sort();
}

async function readPackageIntegrityManifest(path: URL): Promise<PackageIntegrityManifest> {
  return JSON.parse(await Deno.readTextFile(path)) as PackageIntegrityManifest;
}

async function withIntegrityFixture(run: (root: URL) => Promise<void>): Promise<void> {
  const fixturePath = await Deno.makeTempDir({ prefix: "avatar-integrity-" });
  const root = new URL(`file://${fixturePath}/`);
  try {
    const manifest = await readPackageIntegrityManifest(PACKAGE_INTEGRITY_PATH);
    for (const entry of manifest.files) {
      const destination = new URL(entry.path, root);
      await Deno.mkdir(new URL(".", destination), { recursive: true });
      await Deno.copyFile(new URL(entry.path, PACKAGE_ROOT), destination);
    }
    await Deno.copyFile(PACKAGE_INTEGRITY_PATH, new URL("package.integrity.json", root));
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}
