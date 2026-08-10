# @srdjan/avatar

`@srdjan/avatar` is a local Deno package for deterministic human and bot avatars, facial-rig SSR,
and the browser assets used by the rig. Version `0.1.0` is intentionally unpublished.

## Local use

Link the package from a consumer `deno.json` without a registry import:

```json
{
  "links": ["../avatar"]
}
```

Use only the three public entry points:

```ts
import { createAvatarGenerator } from "@srdjan/avatar";
import { renderFacialRig } from "@srdjan/avatar/server";
import { AVATAR_ASSETS, DEFAULT_VOICE_PACK } from "@srdjan/avatar/assets";

const avatars = createAvatarGenerator();
const bot = avatars.forBot("mason-steady");

const scriptBytes = await Deno.readFile(AVATAR_ASSETS.facialRigScript.url);
console.log(bot.kind, scriptBytes.length, DEFAULT_VOICE_PACK.gasp);
```

`internal/` and `assets/private/` are not module entry points. Serve or copy the asset URLs from
`@srdjan/avatar/assets` through the consumer's own HTTP boundary.

`renderFacialRig` escapes caller-owned text and IDs. Bot SVG input must use the package's narrow
facial-rig SVG vocabulary: active elements, event attributes, executable URLs, and generator output
outside that vocabulary are never inlined. Rejected markup degrades to one blank layer with a
`console.warn`, so a single bad avatar cannot fail the caller's whole render.

## Browser contract

`assets/private/facial-rig.js` is a hand-authored classic script, not a module. It is exposed to
consumers only through `AVATAR_ASSETS.facialRigScript`, and it installs one global:
`window.FacialRig`. `AVATAR_ASSETS.facialRigStyles` is its stylesheet and must load before any app
CSS that overrides `.avatar-rig` or `.face-*` rules.

```html
<link rel="stylesheet" href="/assets/facial-rig.css">
<script src="/assets/facial-rig.js" defer></script>
<script src="/assets/app.js" defer></script>
```

Initialize once with the served asset URLs, then call `sync()` whenever the rig DOM is replaced:

```js
window.FacialRig.init({
  audioAssets: {
    gasp: "/assets/avatars/opa.mp3",
    laugh: "/assets/avatars/haha.mp3",
    sigh: "/assets/avatars/uf-nanumu.mp3",
    groan: "/assets/avatars/uf-nanumu.mp3",
    challenge: "/assets/avatars/nenene.mp3",
    laughClimactic: "/assets/avatars/hahaha.mp3",
  },
  silenceSrc: "/assets/avatars/silence.mp3",
  isAudioEnabled: () => userMutePreference !== "muted",
});

window.FacialRig.sync();
```

Derive that `audioAssets` map from `DEFAULT_VOICE_PACK` and `AVATAR_ASSETS[id].fileName` rather than
hardcoding it, so a renamed asset stays consistent on both sides of the HTTP boundary.

| Method                           | Description                                                            |
| -------------------------------- | ---------------------------------------------------------------------- |
| `init(config)`                   | One-time setup. Set `audioAssets`, `silenceSrc`, `isAudioEnabled`.     |
| `prepareSwap(fragment)`          | Preserve live rig nodes during HTMX swaps while accepting fresh state. |
| `sync()`                         | Re-scan `.avatar-rig` elements and apply pending reactions.            |
| `play(req)`                      | Imperative voice-cue trigger. Normally called internally on reactions. |
| `startSpeaking` / `stopSpeaking` | Drive the speaking-mouth envelope from an audio source.                |

Before the runtime plays a voice cue it dispatches a cancelable `facial-rig:voice-cue` `CustomEvent`
on the rig element, so a consumer can suppress, log, or reroute audio:

```js
rigEl.addEventListener("facial-rig:voice-cue", (e) => {
  // e.detail = { cue, src, durationMs, intensity, rigKind, rigId, seatId, seatAudioProbability }
  if (myAppMixer.isMuted()) e.preventDefault();
});
```

Per-seat probability comes from `personality.audioProbability` on the SSR side, which the renderer
writes as `data-seat-audio-probability`. A value of `0` mutes the seat.

### Consumer-tunable CSS variables

| Variable                                                         | Role                                         |
| ---------------------------------------------------------------- | -------------------------------------------- |
| `--depth-brows`, `--depth-eyes`, `--depth-nose`, `--depth-mouth` | Per-feature-plane parallax scalar (0 = flat) |
| `--rig-shadow-alpha`                                             | Light-direction shadow opacity               |
| `--face-contour-alpha`                                           | Authored jaw and ear contour opacity         |
| `--face-highlight-alpha`                                         | Authored forehead highlight opacity          |

`decomposeFaceFeatures` emits three nested groups per selector: an outer `<g class="<name>-plane">`
for CSS parallax, the original positioning `<g transform="...">` kept verbatim (a CSS transform here
would override the SVG attribute and collapse the feature to the origin), and an inner
`<g class="<name>">` that carries the inline transform the runtime writes for reactions.

## Checks

```sh
deno task check
```

The aggregate check runs formatting, linting, type checks, unit tests, browser tests (installing
Chromium first), and the isolated external-consumer fixture.
