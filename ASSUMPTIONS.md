# Assumptions

- This package is consumed through local Deno links and is intentionally unpublished. The repository
  has an `origin` remote, but no registry fallback, publish task, or automated release flow.
- DiceBear output is a byte-level contract. Dependency versions and generated fingerprints stay
  pinned until an explicit compatibility change updates them together.
- Consumers serve the private files through the typed descriptors from `@srdjan/avatar/assets`.
- Consumers pass package-generated bot SVG to `renderFacialRig`; the server entry point validates
  the current generator vocabulary before it inlines markup.
- The browser runtime keeps its current global `window.FacialRig` contract.
- Package color variables first use a consumer override, then the matching Preferans token when it
  exists, then the package default.
