import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { AVATAR_ASSETS, AVATAR_AUDIO_ASSETS, DEFAULT_VOICE_PACK } from "@srdjan/avatar/assets";

const EXPECTED_HASHES: Readonly<Record<keyof typeof AVATAR_ASSETS, string>> = {
  facialRigScript: "6f6a319b682ebb16c7eaf83d612a68e8ea6096506b5a795f87e7d6065f410b0c",
  facialRigStyles: "ff32798945b259012b98f374a079bc380bbd402ec94a471f72f407e0b52dd05b",
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
  assertEquals(DEFAULT_VOICE_PACK, {
    gasp: "opa",
    laugh: "haha",
    sigh: "ufNanumu",
    groan: "ufNanumu",
    challenge: "nenene",
    laughClimactic: "hahaha",
    silence: "silence",
  });
  assertEquals(
    AVATAR_AUDIO_ASSETS.map((asset) => asset.id),
    ["haha", "hahaha", "nenene", "opa", "ufNanumu", "silence"],
  );
});

// The checked script is generated, and its bytes carry the SHA-256 above. That
// lock is only meaningful while every build input is pinned, so prove the
// builder reproduces the checked bytes rather than trusting the gate ordering.
Deno.test("the checked browser script rebuilds from pinned inputs", async () => {
  const builder = new URL("../tools/build_facial_rig.ts", import.meta.url);
  for (let attempt = 0; attempt < 2; attempt++) {
    const output = await new Deno.Command("deno", {
      args: ["run", "-A", builder.pathname, "--check"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(output.success, new TextDecoder().decode(output.stderr));
  }
});

Deno.test("public package boundary has exactly three entry points", async () => {
  const config = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url)));
  assertEquals(config.name, "@srdjan/avatar");
  assertEquals(config.version, "0.3.0");
  assertEquals(config.exports, {
    ".": "./mod.ts",
    "./server": "./server/mod.ts",
    "./assets": "./assets/mod.ts",
  });
  assertEquals("publish" in config, false);
  assertEquals(JSON.stringify(config).includes("jsr:@srdjan/avatar"), false);
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
    args: ["info", "--json", publicRoot.pathname],
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
