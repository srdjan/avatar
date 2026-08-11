# Avatar quality re-base findings

> Historical note: this document records the 0.3.0 rebase baseline. Its six-method global constraint
> was superseded by the approved additive `control()` API in 0.4.0. Use the README and current tests
> as the authority for live avatar control.

Date: 2026-08-10\
Baseline: `8297fe9` on local `main`

This is a read-only re-basing review. It does not authorize implementation or a public-contract
change. At measurement time, `main` was two commits ahead of `origin/main`, tracked files were
clean, and the user-owned `AGENTS.md` was untracked. The review did not modify it.

## 1. Executive summary

The package has a good public shape: three entry points, readonly tagged unions, a pure SVG
decomposer, byte-pinned assets, and an external-consumer fixture. Most TypeScript is already small.
The weak center is the 1,576-line browser runtime, followed by the renderer's protocol normalization
and SVG security boundary.

Current shipped code has 2,606 physical lines, 654 AST branches, and aggregate function complexity
638. `assets/private/facial-rig.js` owns 60.5% of the lines, 75.1% of the branches, and 74.6% of the
complexity. Its current browser tests execute 54.8% of executable lines, 22.5% of V8 block ranges,
and 55.1% of V8 functions. The suite is not yet a sufficient judge for omitting and rederiving that
runtime.

The plan therefore starts with behavior characterization. It then takes two measured low-risk wins,
isolates capability boundaries, and only then attempts the browser rederive.

| Measure                                  |          Current | Acceptance target after the plan |
| ---------------------------------------- | ---------------: | -------------------------------: |
| Shipped AST branches                     |              654 |                      at most 542 |
| TypeScript line coverage                 |   665/706, 94.2% |                     at least 97% |
| TypeScript branch coverage               |   157/194, 80.9% |                     at least 90% |
| Browser-runtime executable-line coverage | 739/1,349, 54.8% |                     at least 80% |
| Browser-runtime V8 block coverage        |    34/151, 22.5% |                     at least 70% |
| Browser-runtime V8 function coverage     |     49/89, 55.1% |                     at least 80% |

The branch target is a pre-registered acceptance bar, not a claim about code that does not exist. It
consists of a measured 13-branch renderer reduction and a required browser-runtime ceiling of 392
branches, down from 491. If the omitted browser candidate cannot meet that bar while preserving
behavior and increasing coverage, keep the current runtime and record the failed experiment. If an
exhaustive ADT adds explicit cases, report that type-driven delta separately. Do not weaken the type
model to protect the mechanical branch score.

## 2. Baseline measurements

### Method

- Physical LOC counts every source line, including comments and blanks.
- The AST counter uses TypeScript 5.9.2 and includes `if`, `else`, conditional expressions, switch
  cases, logical `&&`, `||`, and `??`, loops, `catch`, optional chains, and branch-local returns.
- The counter was validated on `clampNumber`: one `if` plus one return inside that branch gives 2
  AST branches and cyclomatic complexity 2.
- Complexity is the sum of classic cyclomatic complexity for every function. The maximum function is
  shown separately. Nested callbacks are measured as their own functions.
- Dependency counts use unique static local module edges. `+3 ext` means the module also imports
  three npm packages. The browser runtime is reached through the asset descriptor, not an import.
- TypeScript coverage comes from a clean unit/contract profile. Browser coverage comes from a
  separate clean profile. Combining Deno profiles from different invocations produced misleading
  totals, so this review does not use that aggregate.
- Browser-runtime coverage replays the two existing JavaScript-executing Chromium flows under V8
  precise coverage. The temporary probe was outside the repository.
- The test column counts tests that directly assert the module's behavior. Runtime is the sum of the
  current reported test durations, rounded because Deno reports small tests at millisecond or
  microsecond precision.

### Production modules

| Module                         |       LOC | AST branches | Complexity sum / max |                 In |                  Out |  Line / branch coverage |         Direct tests / runtime |
| ------------------------------ | --------: | -----------: | -------------------: | -----------------: | -------------------: | ----------------------: | -----------------------------: |
| `mod.ts`                       |        21 |            0 |                0 / 0 |                  0 |                    2 |              100% / n/a |             2 boundary / <1 ms |
| `types.ts`                     |        85 |            0 |                0 / 0 |                  6 |                    0 |              100% / n/a | type gate plus ADT integration |
| `assets/mod.ts`                |        80 |            0 |                0 / 0 |                  0 |                    1 |              100% / n/a |                 2 / about 4 ms |
| `internal/generator.ts`        |       245 |           38 |               42 / 7 |                  1 |      2 local + 3 ext |           95.4% / 89.5% |                 5 / about 7 ms |
| `server/mod.ts`                |        21 |            0 |                0 / 0 |                  1 |                    5 |              100% / n/a |             2 boundary / <1 ms |
| `server/avataaars_preset.ts`   |       107 |            0 |                3 / 1 |                  1 |                    1 |             91.0% / n/a |     1 integration / about 3 ms |
| `server/decompose.ts`          |       125 |           34 |               32 / 9 |                  2 |                    0 |           90.4% / 85.0% |                      2 / <1 ms |
| `server/personality.ts`        |        17 |            0 |                1 / 1 |                  1 |                    1 |              100% / n/a |                      1 / <1 ms |
| `server/render.ts`             |       329 |           91 |              84 / 23 |                  1 |                    1 |           93.2% / 74.2% |               4 / about 475 ms |
| `assets/private/facial-rig.js` |     1,576 |          491 |             476 / 21 |      1 asset reach |                    0 | 54.8% / 22.5% V8 blocks |               3 / about 958 ms |
| **Total**                      | **2,606** |      **654** |         **638 / 23** | **13 local edges** | **13 local + 3 ext** |  profiles kept separate |             **22 suite tests** |

The 22 tests comprise 11 unit tests, 5 contract tests, 5 browser tests, and 1 external-consumer
test. A non-coverage run completed unit and contract tests in 0.037 seconds, browser tests in 1.669
seconds, and the consumer test body in 462 microseconds. No individual test exceeded one second.

### Complexity concentration

| Function               | LOC | AST branches | Complexity |
| ---------------------- | --: | -----------: | ---------: |
| `inlineSvgRejection`   |  41 |           34 |         23 |
| `decideAudio`          |  39 |           28 |         20 |
| `startMacroFaceTweens` |  69 |           24 |         21 |
| `startMicroFaceTweens` |  54 |           24 |         21 |
| `tickAutonomousIdle`   |  98 |           21 |         19 |
| `syncMacroReaction`    |  25 |           19 |         17 |
| `updatePreservedRig`   |  27 |           18 |         19 |
| `tickMouthEnvelopes`   |  78 |           17 |         17 |
| `reactionAttributes`   |  12 |           16 |         17 |

Eight browser-runtime functions have complexity 16 or higher. All 78 named runtime functions have at
least one static reference, so there is no evidence for a simple named-function dead-code pass.

### Import graph

`deno info --json mod.ts` reports 11 loaded modules: 8 local modules and 3 npm packages. The root
generator imports `server/mod.ts`, so the root entry point also loads `server/render.ts` and
`server/personality.ts`, which generation does not use. Importing the preset and decomposer directly
would reduce the root graph to 8 modules: 5 local and the same 3 npm packages. This is a 27.3%
reduction in loaded module count with no public API change.

## 3. Findings ranked by leverage

### F1. Build a judging suite before rederiving the browser runtime

**Class:** prerequisite, highest leverage

The browser runtime owns 491/654 AST branches, but only 34/151 V8 blocks and 49/89 V8 functions are
covered. Only two browser tests execute the runtime. The principal reaction test supplies
handwritten `data-*` markup instead of markup from `renderFacialRig`, so an SSR/runtime protocol
break can pass.

Add end-to-end contracts that start with `renderFacialRig`, load the package script and stylesheet,
and exercise:

- bot, generated-human, and photo rigs;
- main, preceding, and micro reactions;
- `prepareSwap` with same and changed rig signatures;
- reduced motion and the iOS no-churn guard;
- cancelable `facial-rig:voice-cue` behavior;
- audio admission, seat cooldown, channel cap, and failed random rolls;
- speaking start, fade-out, visibility recovery, and DOM replacement.

Use browser-observable state as the assertion surface. Use Playwright's clock controls or an
explicit test capability to avoid real-time sleeps where possible.

**Expected measurement:** browser runtime at least 80% executable lines, 70% V8 blocks, and 80%
functions; no test above one second.\
**Risk:** timing-heavy tests can become flaky. Do not proceed to F2 until repeated runs are stable.

### F2. Rederive the browser runtime as a pure state machine with browser capabilities

**Class:** branch reduction plus architecture boundary

The runtime owns 1,576 LOC, 491 branches, 476 complexity, 48 direct references to browser, timing,
audio, and randomness APIs, and 10 long-lived mutable module variables. The public global is
intentional, but the policies behind it do not need to be coupled to those effects.

Capture the contract only from the completed F1 tests, README, asset hash contract, CSS variables,
and the six-method `window.FacialRig` API. Then omit the current control flow and build a candidate
with:

- independent tagged states for macro reaction, micro reaction, speech, and frame scheduling;
- pure `state + event -> state + effects` transitions;
- explicit clock, scheduler, random, DOM, media-query, event, and audio capabilities;
- an edge interpreter that performs DOM writes and audio work;
- one small classic-script adapter that installs the unchanged six-method global.

The quality-first authoring shape is typed source plus a deterministic one-file classic-script
build. The checked asset must remain a single consumer-served file. It must be regenerated only by
the build task, never edited manually. A freshness check must fail when source and asset differ.

**Expected measurement:** `facial-rig.js` at most 392 branches, no function above complexity 15, and
F1 coverage at or above its thresholds. This is a 20% unit-level branch-reduction bar.\
**Risk:** highest. The asset is byte-pinned and the runtime is a public browser contract. Obtain
explicit compatibility approval before the cutover. If the candidate misses behavior or the metric
bar, keep the original.

### F3. Normalize renderer protocol data once and make safe SVG a typed result

**Class:** mechanical branch reduction plus branch-class removal

`server/render.ts` has 91 branches. `reactionAttributes` alone has 16 because each nullable access
uses both optional chaining and `??`. A `null` check plus a frozen no-reaction value reduces the
function from 16 to 4 measured branches while preserving all eight emitted attributes. Combining the
two consecutive bot guards in `rigDataAttrs` removes one more branch. The module therefore has an
exact mechanical target of 78 branches, down 13.

The SVG validator is also a security boundary. `inlineSvgRejection` has 34 branches and complexity
23, while renderer branch coverage is 74.2%. After its rejection classes are characterized, rederive
it as a pure parser:

```ts
type SvgValidation =
  | Readonly<{ tag: "safe"; svg: SafeInlineSvg }>
  | Readonly<{ tag: "rejected"; reason: SvgRejection }>;
```

The renderer consumes `SafeInlineSvg`. A reporting capability at the edge owns the warning. The
public synchronous fallback remains a blank SVG layer unless a separate compatibility decision
changes it.

**Expected measurement:** `render.ts` 91 to 78 mechanical branches, overall shipped count 654 to 641
before the browser rederive, renderer line coverage at least 97%, and branch coverage at least 90%.\
**Risk:** high because a grammar mistake can admit executable markup or reject valid DiceBear SVG.

### F4. Tighten the generator boundary and root import graph

**Class:** dependency reduction plus capability isolation

`internal/generator.ts` combines catalog validation, cache policy, and direct calls to three
DiceBear packages. It also imports through the public server facade. The current root entry point
therefore loads 11 modules, including two unused server modules.

First replace the facade import with direct imports of `avataaars_preset.ts` and `decompose.ts`.
Then capture catalog parsing as a pure boundary that produces snapshotted validated profiles. Keep
the public throwing factory contract at the edge. Inject a narrow internal DiceBear rendering
capability into the rederived generator while preserving factory-local caches and the public
overloads.

**Expected measurement:** root load graph 11 to 8 modules, no public export change, generator
coverage at least 98% lines and 95% branches, and generator branches no higher than 38.\
**Risk:** medium. SVG bytes, cache identity, FIFO eviction, typed custom IDs, and snapshot semantics
are compatibility contracts.

### F5. Make the measurements reproducible and correct factual docs

**Class:** tooling and documentation

The current repo has no checked branch/complexity counter and Deno coverage does not cover scripts
executed inside Chromium. The review needed two independent coverage methods. Also:

- `ASSUMPTIONS.md` and `CLAUDE.md` say there is no remote, but `origin` is configured;
- `CLAUDE.md` says a version bump changes exactly three locations, while the external-consumer lock
  records `jsr:@srdjan/avatar@0.2.0`;
- `facial-rig.css` points to nonexistent `client/facial-rig.js` instead of the private asset path;
- README does not explain custom generator validation or the stable-ID/signature requirement behind
  `prepareSwap`.

Check in the validated AST method, independent TypeScript and Chromium coverage tasks, root import
graph assertion, and baseline budgets. Correct the factual docs in the same phase that changes the
corresponding contract.

**Expected measurement:** one command reproduces all 10 module rows and fails on budget regression;
all docs name current paths and version surfaces.\
**Risk:** low. Keep test-only tools out of the package import map.

## 4. Test-correctness findings

These are prerequisites, not optional coverage polish.

1. **Custom profile snapshot behavior is not proved.** The test calls a value `mutableProfile` but
   never mutates it after factory construction. A rewrite can remove deep snapshotting and pass. Add
   post-construction mutation assertions for ID, seed, steady face, and face shape.

2. **Generator validation misses 6 current coverage branches.** Add unsafe, non-finite, negative,
   and non-integer cache limits; empty ID and seed; invalid eyes, eyebrows, and mouth; and malformed
   or null face shapes.

3. **SVG decomposition misses 6 current coverage branches.** Add missing selector, missing matching
   close group, no closing `</svg>`, mask-relative overlay insertion, and exact `onMissing` payload
   tests. Preserve fallback behavior before considering parser changes.

4. **SVG sanitization and renderer normalization miss 25 current coverage branches.** Cover absent
   or malformed roots, unbalanced and duplicate roots, content outside the root, forbidden elements
   and attributes, unquoted attributes, external `url(...)`, executable URL values, all eight
   reaction attributes, amplitude style, rig signatures, dimensions, bot-emotion attributes, and
   `NaN` or infinite confidence.

5. **The main browser fixture is handwritten.** Add one real SSR-to-runtime test so attribute
   renames, omissions, escaping, and defaults fail at the consumer-visible boundary.

6. **Two contract tests assert source text rather than live behavior.** The iOS guard and forbidden
   consumer-selector checks are useful policy gates, but they can pass when code is dead. Retain the
   policy checks and pair them with behavior. The recursive source scan is also policy enforcement,
   not an import-graph test; replace or supplement it with `deno info` graph assertions.

Exact hashes are intentional compatibility locks and should remain. They are not semantic tests, so
a hash change must also carry behavior-focused evidence.

## 5. Architecture findings

| Boundary           | Current                                                  | Target                                                            |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------------------------- |
| Domain types       | readonly `Avatar` and `BotFaceShape` ADTs                | preserve                                                          |
| Expression mapping | total `Record` with `satisfies`                          | preserve                                                          |
| SVG decomposition  | pure function with injected `onMissing`                  | preserve after fallback tests                                     |
| SVG rendering      | pure strings plus direct `console.warn`                  | pure validation/render result plus reporting capability           |
| Generator          | validation, cache, and DiceBear effects in one closure   | parsed catalog and cache policy around a DiceBear capability      |
| Browser runtime    | explicit global adapter plus hidden mutable policy state | public global adapter over pure reducers and browser capabilities |

There are no hidden TypeScript singletons. The factory caches are closure-local. The two TypeScript
effects are `console.warn` in the renderer and `console.error` in the preset callback. The browser
runtime is the intentional effect adapter, but its policy and effects are currently inseparable.

Type-driven opportunities must be judged separately from branch reduction:

- `reactionBotEmotion` and `microBotEmotion` currently allow absent, `null`, and arbitrary strings.
  `RigBotEmotion | null` removes the arbitrary and duplicate absence states, but changing public
  optionality requires explicit contract approval.
- `ReactionSpec` permits unbounded IDs, duration, and confidence plus an optional arbitrary `kind`.
  A parsed `NoReaction | ActiveReaction` boundary with refined non-negative values and normalized
  confidence removes invalid protocol states. Preserve the current public input until compatibility
  is approved.
- Custom catalog IDs and seeds are plain strings. A runtime parser should produce branded non-empty
  values internally even though TypeScript callers already receive useful key inference.

## 6. Docs to update

Update only as the corresponding phase lands:

- `README.md`: describe custom catalogs and validation, `prepareSwap` ID/signature requirements, and
  any new browser build workflow.
- `ASSUMPTIONS.md`: remove the false no-remote statement; retain local-only and unpublished intent
  only in a form the repo can prove.
- `CLAUDE.md`: correct remote status, include external-consumer lock refresh in version work, and
  document the rederived browser source/build boundary.
- `assets/private/facial-rig.css`: replace the stale `client/facial-rig.js` comment path.
- `deno.json`: add measurement, Chromium coverage, and deterministic browser-build tasks if F2 is
  approved. Do not add test-only packages to `imports`.
- `tests/contract_test.ts`: update the script hash only with the approved browser cutover and the
  behavior evidence that explains the new bytes.

Do not manually edit lock files or generated browser output. Use their owning commands.

## 7. Additional re-basing tasks

1. Add a checked `tools/metrics.ts` using the exact branch definition in this review. Include a
   self-test for zero-branch and branch-local-return fixtures.
2. Add Chromium precise coverage for `facial-rig.js`; Deno coverage alone cannot see page scripts.
3. Add a root import-graph contract with an 8-module ceiling after F4.
4. Add non-regression budgets for total branches, per-function maximum complexity, independent
   TypeScript coverage, and browser coverage.
5. Keep the browser suite below one second per test and run a repeated narrow loop before accepting
   any timing-sensitive test.

## 8. Phased plan

### Phase 1: Repair the judging suite

Add all test-correctness cases in section 4. Start with real SSR-to-runtime browser coverage, then
generator, decomposer, and sanitizer boundaries.

Verification:

```sh
deno test --allow-read tests/unit_test.ts tests/contract_test.ts
deno test -A tests/browser_test.ts
deno test --coverage=.coverage/unit --allow-read tests/unit_test.ts tests/contract_test.ts
deno coverage .coverage/unit --detailed
```

Expected: TypeScript at least 97% lines and 90% branches; runtime at least 80% lines, 70% V8 blocks,
and 80% functions; no test over one second. Use separate temporary coverage directories in the real
commands so profiles cannot overwrite each other.

### Phase 2: Take measured low-risk reductions

Use direct generator imports. Normalize no-reaction attributes once. Combine the bot renderer
guards. Correct existing factual docs that do not depend on the larger rederive.

Verification:

```sh
deno task unit
deno task type
deno info --json mod.ts
deno task check
```

Expected: root graph 11 to 8 modules; `render.ts` 91 to 78 branches; shipped total 654 to 641;
coverage does not regress.

### Phase 3: Rederive TypeScript boundaries

From the Phase 1 contracts, omit and rederive the generator catalog boundary and SVG validator. Keep
public throwing and blank-layer fallback behavior at the adapters. Inject DiceBear and reporting
capabilities. Introduce internal validated/refined types without changing public input types.

Verification:

```sh
deno task unit
deno task type
deno task consumer
deno task check
```

Expected: no TypeScript coverage regression, generator branches at most 38, renderer branches at
most 78 unless an explicit exhaustive ADT delta is recorded, and all byte fingerprints unchanged.

### Phase 4: Rederive and cut over the browser runtime

Obtain explicit compatibility approval first. Build the omitted candidate from the Phase 1
contracts, not from the old control flow. Compare it under the same browser coverage and visual
oracles. Cut over only if it meets every behavior, coverage, branch, complexity, byte-build, and
visual requirement.

Verification:

```sh
deno task browser
deno task consumer
deno task check
```

Also run the new browser build freshness and Chromium coverage tasks introduced by this phase.

Expected: runtime at most 392 branches and maximum complexity 15; all runtime coverage thresholds
hold; one `window.FacialRig` global with the same six methods; iPhone idle style mutations remain
zero; shipped total at most 542, subject to separately reported exhaustive ADT cases.

### Phase 5: Lock the finish

Check in the metrics and coverage budgets, update all docs in section 6, refresh generated files
only through their commands, and run the complete gate twice to catch timing flakes.

Verification:

```sh
deno task check
deno task check
git diff --check
git status --short --branch
```

Expected: both complete gates pass, tracked output is limited to the approved phases, and the
user-owned `AGENTS.md` remains untouched.

## 9. What not to touch

- Keep the three-key export map and all current public names unless a separate compatibility change
  is approved.
- Keep `mod.ts`, `server/mod.ts`, `types.ts`, `assets/mod.ts`, and `server/personality.ts`
  structurally small. They are not rederive targets.
- Keep `decomposeFaceFeatures` and its explicit group scanner unless the completed fallback suite
  proves a candidate is smaller and equivalent. Its current branches implement real parsing states.
- Keep DiceBear versions, SVG fingerprints, asset IDs, filenames, MIME types, order, voice-pack
  mappings, selector transforms, and CSS visual constants stable during non-visual phases.
- Keep one consumer-served classic script and the six-method `window.FacialRig` contract.
- Do not treat hash assertions as permission to change visuals. A hash update follows an approved
  behavior or visual change, not the reverse.
- Do not fold the external-consumer fixture into the package tests. Its separate project boundary is
  valuable evidence.
