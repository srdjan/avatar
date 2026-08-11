# Assumptions

- This package is consumed through local Deno links and is intentionally unpublished. The repository
  has an `origin` remote, but no registry fallback, publish task, or automated release flow.
- DiceBear output is a byte-level contract. Dependency versions and generated fingerprints stay
  pinned until an explicit compatibility change updates them together.
- Consumers serve the private files through the typed descriptors from `@srdjan/avatar/assets`.
- Consumers pass package-generated bot SVG to `renderFacialRig`; the server entry point validates
  the current generator vocabulary before it inlines markup.
- The browser runtime keeps one global `window.FacialRig`. Its additive `control()` method is the
  only live affect ingress; the six existing methods keep their current behavior.
- The browser runtime is authored in `browser/` and generated only through
  `deno task browser:build`; the checked classic script is never edited directly.
- One external source owns a rig at a time. A source sends strictly increasing sequence numbers and
  releases ownership explicitly. Multi-source priority and dead-man leases are not part of 0.4.0.
- Named control presets describe requested avatar movement. They do not claim to infer a person's
  internal emotion. Callers can override the preset recipe with normalized observable features.
- Expression artwork banks are opt-in SSR data. Without a bank, bots use feature pose and tint,
  generated humans use tint and restrained layer motion, and photos use tint and outline only.
- A `laugh` control gesture never starts audio. Consumers call `play()` separately when sound is
  appropriate.
- Package color variables first use a consumer override, then the matching Preferans token when it
  exists, then the package default.
