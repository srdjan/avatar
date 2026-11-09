# @srdjan/avatar

`@srdjan/avatar` is a local Deno package for deterministic human and bot avatars, facial-rig SSR,
and the browser assets used by the rig. Version `0.6.0` is intentionally unpublished.

## Local use

Link the package from a consumer `deno.json`:

```json
{
  "links": ["../avatar"]
}
```

The package has exactly three public entry points:

```ts
import {
  createAvatarGenerator,
  type FacialReaction,
  parseFacialReactionIdentity,
} from "@srdjan/avatar";
import { AVATAR_ASSETS } from "@srdjan/avatar/assets";
import { createRigControlBank, renderFacialRig } from "@srdjan/avatar/server";
```

`internal/` and `assets/private/` are implementation details. Serve or copy asset descriptors from
`@srdjan/avatar/assets` through the consumer's HTTP boundary.

`renderFacialRig` escapes caller text and IDs. Bot SVG input must use the package's narrow SVG
vocabulary. Active elements, event attributes, executable URLs, and unknown generator markup are
rejected. A rejected layer becomes blank and emits one `console.warn`; it does not fail the whole
render.

Pass `createRigControlBank(avatar)` to the matching bot or generated-human `controlBank` field when
the browser should switch expression artwork. The bank is optional. Human photos return `null` and
keep static tint and outline behavior.

## Atomic reactions

A `FacialReaction` is one complete command. Consumers cannot select visual state and audio
independently.

```ts
const parsed = parseFacialReactionIdentity("match-7:hand-3:event-42");
if (parsed.tag !== "accepted") throw new Error(parsed.reason);

const reaction = {
  identity: parsed.identity,
  state: "smile",
  kind: "TrickWon",
  intensity: 2,
  motion: "pop",
  durationMs: 900,
  confidence: 0.9,
} as const satisfies FacialReaction;

const laughIdentity = parseFacialReactionIdentity("match-7:hand-3:event-43");
if (laughIdentity.tag !== "accepted") throw new Error(laughIdentity.reason);

const laugh = {
  ...reaction,
  identity: laughIdentity.identity,
  gesture: "laugh",
  qualifier: "climactic",
} as const satisfies FacialReaction;
```

State-only reactions omit `gesture` and `qualifier`. A laugh reaction requires both
`gesture: "laugh"` and a `standard` or `climactic` qualifier. The remaining boundaries are strict:
`intensity` is 1, 2, or 3; `motion` is `pop`, `shake`, or `sink`; `durationMs` is positive and
finite; and `confidence` is finite from 0 to 1. Unknown fields reject the whole reaction.

Identity is opaque and exact. The runtime does not trim, fold case, or normalize Unicode. Reusing
one identity with a different payload rejects the transaction. Moving an unchanged identity between
lanes does not replay it.

Visual state determines semantic audio:

| State                | Semantic result                             |
| -------------------- | ------------------------------------------- |
| `neutral`, `focused` | silent                                      |
| `smile`              | `Happiness`                                 |
| `sad`                | `Sadness`                                   |
| `worry`              | `Worry`                                     |
| `mad`                | `Anger`                                     |
| `surprised`          | `Surprise`                                  |
| `laugh` gesture      | `Laughter.standard` or `Laughter.climactic` |

## SSR protocol

Every rig carries a non-empty match scope, an audio profile ID, and three nullable reaction lanes.
The renderer serializes each lane as one HTML-escaped JSON value or the literal `null`.

```ts
const avatars = createAvatarGenerator();
const bot = avatars.forBot("mason-steady");

const html = renderFacialRig({
  id: "east",
  label: "East bot",
  matchScope: "match-7",
  audioProfileId: "mason-steady",
  reaction,
  precedingReaction: null,
  microReaction: null,
  personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 1 },
  rigKind: "bot",
  baseSvg: bot.src,
  expressionSvg: bot.emotions.focused,
  microSvg: bot.emotions.focused,
  controlBank: createRigControlBank(bot),
});
```

The browser reads `data-reaction`, `data-preceding-reaction`, and `data-micro-reaction` atomically.
Legacy per-field reaction attributes are not part of v0.5.0.

`matchScope` resets the identity ledger for a new match. Once a live rig advances to a new scope, a
later update cannot restore a retired scope.

## Browser setup

`browser/runtime_core.ts` owns pure reaction and admission decisions. `browser/facial_rig.ts`
applies those decisions through browser capabilities. `deno task browser:build` creates the classic
script at `assets/private/facial-rig.js`. Do not edit that file directly.

Consumers load the declared script and stylesheet, then initialize the runtime with a complete
profile catalog:

```js
const served = (asset) => `/assets/avatars/${asset.fileName}`;

const masonSteady = {
  Happiness: { src: served(AVATAR_ASSETS.opa), gain: 0.8 },
  Sadness: { src: served(AVATAR_ASSETS.ufNanumu), gain: 0.7 },
  Worry: { src: served(AVATAR_ASSETS.nenene), gain: 0.65 },
  Anger: { src: served(AVATAR_ASSETS.ufNanumu), gain: 0.85 },
  Surprise: { src: served(AVATAR_ASSETS.opa), gain: 0.9 },
  "Laughter.standard": { src: served(AVATAR_ASSETS.haha), gain: 0.75 },
  "Laughter.climactic": { src: served(AVATAR_ASSETS.hahaha), gain: 1 },
};

const receipt = window.FacialRig.init({
  audioProfiles: { "mason-steady": masonSteady },
  silenceSrc: served(AVATAR_ASSETS.silence),
  isAudioEnabled: () => userMutePreference !== "muted",
});

if (receipt.tag === "rejected") console.error(receipt.reason);
window.FacialRig.sync();
```

Each profile must contain exactly the seven slots in the example. A slot needs a non-empty `src` and
a finite `gain` from 0 to 1. The catalog must contain at least one profile. The runtime snapshots an
accepted catalog and rejects an incomplete or extra-key catalog as
`{ tag: "rejected", reason: "invalid-profile-catalog" }`.

`init` is tagged, transactional, and repeatable. A later accepted call replaces the catalog, silence
source, and audio predicate without installing duplicate listeners or replaying reactions. A
rejected call leaves the last accepted configuration active.

The installed global has six methods:

| Method                                  | Contract                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `init(config)`                          | Validate and snapshot a complete configuration; return a tagged receipt. |
| `prepareSwap(fragment)`                 | Preserve compatible live nodes while accepting fresh atomic state.       |
| `sync()`                                | Reconcile `.avatar-rig` nodes and apply unseen reactions.                |
| `control(command)`                      | Apply an externally owned `set` or `release` command.                    |
| `startSpeaking(rigId, cue, durationMs)` | Drive the mouth envelope for caller-owned speech.                        |
| `stopSpeaking(rigId)`                   | Stop the caller-owned mouth envelope.                                    |

There is no arbitrary `play()` method and no control `trigger` command.

### Lifecycle silence and admission

Script installation, initial hydration, accepted reinitialization, DOM replacement, lane movement,
release, and restoration of an already seen identity are silent. `neutral`, `focused`, and a new
reaction whose state already matches the rendered baseline are also silent. External control and the
speaking envelope never select semantic audio.

An unknown profile or identity conflict rejects the whole rig transaction. The runtime does not
reserve the identity, so a corrected update can retry it. For a valid new audible reaction,
admission still checks the global audio predicate, rig kind, per-seat probability, confidence, the
two-channel cap, active-seat ownership, a 600 ms seat gap, and semantic-family cooldown. Intensity 3
bypasses the family cooldown. Rejected admission does not affect visual delivery.

After admission, the rig dispatches a cancelable `facial-rig:voice-cue` event. The historical event
name remains, but `event.detail` is `FacialRigSemanticAudioDetail`: it contains family, qualifier,
profile ID, exact reaction identity, resolved source and gain, and delivery metadata. Preventing the
event stops media playback.

Media is a nonfatal edge. Constructor, load, playback, analyzer, error-event, timeout, and teardown
failures release audio capacity locally. Visual reaction timers continue, listeners are removed, and
later reactions can play.

### External live control

`control()` accepts atomic `set` and `release` commands and returns an accepted or rejected receipt.
One source owns a rig until release. Its sequence must be a strictly increasing safe non-negative
integer.

```js
window.FacialRig.control({
  tag: "set",
  rigId: "avatar-rig-east",
  sourceId: "game-state",
  sequence: 1,
  preset: "worry",
  features: { browInnerRaise: 0.8, jawOpen: 0.15 },
});

window.FacialRig.control({
  tag: "release",
  rigId: "avatar-rig-east",
  sourceId: "game-state",
  sequence: 2,
});
```

Presets are `neutral`, `focused`, `smile`, `sad`, `worry`, `mad`, and `surprised`. Feature values
are finite numbers from 0 to 1. Invalid values reject the command instead of being clamped. Control
can change artwork, feature pose, wrapper motion, tint, and speech pose; it does not emit semantic
audio.

The stylesheet frames every rig as a rounded square with a drop shadow and a light inner edge. To
change the frame, override `border-radius` and `box-shadow` on `.avatar-rig`, and `box-shadow` on
`.avatar-rig::after`.

## Generated assets and source integrity

The browser script and its contract hash change only through this sequence:

```sh
deno task browser:build
deno task browser:check
deno task browser:metrics
```

`tools/runtime_metrics.ts` pins the generated runtime to at most 406 branches and maximum function
complexity 14.

`package.integrity.json` SHA-256 pins package metadata, public and internal modules, server and
browser source, every declared private asset, and the build, metrics, and integrity tools. Entries
are sorted. README, assumptions, locks, tests, fixtures, repository guidance, and the manifest
itself are outside this behavior-bearing closure.

Check mode is read-only and fails on changed, missing, or newly added behavior files. It also
rejects symlinks and paths that escape the package root:

```sh
deno task package:integrity
```

Regenerate the manifest only after the intended closure is final:

```sh
deno task package:integrity:write
```

The complete local gate is:

```sh
deno task check
```

It verifies generated bytes, metrics, source integrity, formatting, lint, types, Deno tests,
Chromium behavior, and the isolated external consumer.

## Breaking v0.5.0 cutover

Version 0.5.0 directly removes `RigVoiceCue`, `ReactionSpec`, `DEFAULT_VOICE_PACK`, arbitrary
`FacialRig.play()`, control `trigger`, and legacy per-field reaction transport. There are no aliases
or migration adapters. Consumers must switch to atomic `FacialReaction` values, complete semantic
audio profiles, tagged `init`, nullable lane JSON, and `set` or `release` controls before vendoring
this source package.
