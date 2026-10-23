# AGENTS.md

This file guides coding agents that work in this repository.

## What this is

`@srdjan/avatar` is an intentionally unpublished Deno package with an `origin` remote, but no
registry fallback or publish task. It produces deterministic DiceBear avatars, renders the
server-side facial-rig markup, and ships the browser runtime that animates it. Consumers link it
from their own `deno.json` with `"links": ["../avatar"]`. Read `ASSUMPTIONS.md` before you change a
contract: it records the invariants the tests enforce.

## Commands

```sh
deno task check      # fmt + lint + type + unit + browser + consumer fixture
deno task unit       # unit and contract tests only (fast, no browser)
deno task browser    # installs Chromium, then runs Playwright tests
deno task browser:build    # generate the classic script from typed browser source
deno task browser:coverage # run Chromium with runtime coverage budgets
deno task consumer   # type-checks the isolated external-consumer fixture
deno task type       # type-checks the entry points, browser source, tools, and all test suites
deno task fmt        # checks formatting only; run `deno fmt` to rewrite changed files
```

Run one test by name:

```sh
deno test --allow-read tests/unit_test.ts --filter "SSR escapes rig IDs"
deno test -A tests/browser_test.ts --filter "iPhone idle mode"
```

`deno task lint` runs twice: once with the project config, once with a relaxed rule set for the
generated classic script at `assets/private/facial-rig.js`. Edit `browser/runtime_core.ts` or
`browser/facial_rig.ts`, then regenerate the asset with `deno task browser:build`.

A version bump must change four places together: `deno.json`, the `config.version` assertion in
`tests/contract_test.ts`, the version line in `README.md`, and the linked package version recorded
in `fixtures/external-consumer/deno.lock`. Refresh that lock through the consumer task.

## Architecture

Three public entry points, and no others. A contract test asserts the exports map exactly.

- `mod.ts` - the generator and the shared type vocabulary (the types live in `types.ts`).
- `server/mod.ts` - SSR rendering, SVG decomposition, the DiceBear selector preset.
- `assets/mod.ts` - typed descriptors (`id`, `fileName`, `mimeType`, `url`) for the browser files.
- `browser/` - pure runtime decisions and the capability-driven browser adapter.

`internal/` and `assets/private/` are private. Consumers serve the asset URLs through their own HTTP
boundary; the package never opens a port.

The data flow for a bot avatar is: `createAvatarGenerator().forBot(id)` builds six DiceBear emotion
SVGs, passes each through `decomposeFaceFeatures` with `avataaarsPreset`, and optionally splices in
a face-shape overlay. The consumer then hands those SVG strings to `renderFacialRig`, which inlines
them as stacked layers inside one `<span class="avatar-rig">` carrying `data-*` attributes. In the
browser, `facial-rig.js` reads only those `data-*` attributes and CSS variables. That attribute set
is the entire SSR-to-runtime contract; the runtime knows nothing about the consumer's DOM.

`Avatar` is a three-branch discriminated union (`human-photo`, `human-generated`, `bot`) and
`renderFacialRig` switches on the same tag. Photos are not decomposed: reactions stay on the wrapper
so no expression overlay lands on a real face.

## Invariants to preserve

**DiceBear output is byte-pinned.** `tests/unit_test.ts` holds SHA-256 and length fingerprints for
every built-in bot emotion and both human expression baselines. `tests/contract_test.ts` holds
SHA-256 for every file in `AVATAR_ASSETS`, including the script and the stylesheet. Any edit to
`facial-rig.js`, `facial-rig.css`, the preset, or a DiceBear version changes those hashes. Update
the fingerprint and the dependency version together, and treat a hash change as a compatibility
change.

**Every input to the generated browser script is pinned.** `assets/private/facial-rig.js` is esbuild
output used verbatim, and its only pinned input is `npm:esbuild@0.25.9` in
`tools/build_facial_rig.ts`. Do not add an unpinned step to that pipeline. `deno fmt` was one, and
it was removed: the formatter follows the installed Deno, so a Deno upgrade would fail
`deno task browser:check` - the first step of the whole gate - and the obvious repair would rewrite
the SHA-256 lock. `deno fmt` therefore excludes the generated file, and a contract test rebuilds it
to prove reproducibility. An esbuild bump is a compatibility change: move the version and the hash
together, with behavior evidence for the new bytes.

**Deno has no devDependencies.** Anything in the `imports` map of `deno.json` becomes a dependency
of every consumer. Test-only packages use full specifiers (`jsr:@std/assert@1.0.14`,
`npm:playwright@1.60.0`) inside `tests/`.

**The inline-SVG grammar in `server/render.ts` is an allowlist, deliberately narrower than SVG.**
Inline SVG is executable markup. If generator output starts to emit an element or attribute outside
`SAFE_SVG_ELEMENTS` / `SAFE_SVG_ATTRIBUTES`, widen the allowlist in the same change and add a
rejection test. Rejected markup degrades to one blank layer with a `console.warn` instead of
throwing, because the rig renders on a synchronous render path where one blank face is recoverable
and a thrown render is not.

**`decomposeFaceFeatures` emits three nested groups per selector** (`<name>-plane` for CSS parallax,
the original `<g transform="...">` verbatim, then `<g class="<name>">` for runtime transforms). Do
not collapse them. A CSS transform on the positioning group overrides the SVG attribute and moves
the feature to the origin.

**`avataaarsPreset` matches literal transform strings** such as `translate(2 63)`. A DiceBear
upgrade that shifts offsets will not throw; `onMissing` logs to `console.error` and per-feature
animation falls back to a whole-face crossfade. Treat that log as a build failure signal.

**`facial-rig.js` installs exactly one global, `window.FacialRig`,** with `init`, `sync`,
`prepareSwap`, `play`, `startSpeaking`, `stopSpeaking`. It must stay consumer-agnostic: contract
tests assert it contains no `.seat`, `is-turn`, or `is-ai` selectors, and that the iOS compositor
guard still short-circuits the idle and blink loops. The stylesheet must define package variables as
consumer-token fallbacks (`--avatar-primary: var(--primary, #d8c4a2)`), which is also asserted. The
checked script is generated output. `deno task browser:check` fails when it differs from the typed
source, and `deno task browser:metrics` enforces its branch and complexity budgets.

## Style

TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Types are
`Readonly`, unions are tagged, and validation happens once at the factory boundary
(`validateAndSnapshotProfiles` freezes the catalog). Comments explain why a constraint exists, not
what the line does. Keep that ratio.

Use two-space indentation, double quotes, semicolons, and a 100-column limit (`deno fmt` enforces
them). Prefer pure functions, explicit dependencies, and exhaustive handling of tagged unions. Use
`camelCase` for values and functions, `PascalCase` for types, and descriptive lowercase filenames
such as `avataaars_preset.ts`. Keep side effects at package edges and validate caller-controlled
SVG, text, IDs, and configuration.

## Testing

Use `Deno.test` with `jsr:@std/assert`. Name each test as a behavioral statement, for example
`Deno.test("human photos bypass generation")`. Add a regression test for each bug or behavior
change. Run the narrow relevant task during development, then `deno task check` before handoff.

## Commits and pull requests

Use Conventional Commit subjects, such as `feat: add expression preset` or
`chore: tighten permissions`. Keep commits small and focused. A pull request explains the
user-visible or contract impact, lists the exact verification commands, links related work, and
includes screenshots for visual browser changes. Do not commit secrets or dependency directories.
Record durable project assumptions in `ASSUMPTIONS.md`.
