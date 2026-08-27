# Assumptions

- Version 0.5.0 is consumed through local Deno links and is intentionally unpublished. The package
  has no registry fallback, publish task, or automated release flow.
- The breaking cutover is direct. `RigVoiceCue`, `ReactionSpec`, `DEFAULT_VOICE_PACK`, arbitrary
  `FacialRig.play()`, control `trigger`, and per-field reaction transport have no compatibility
  layer.
- The only public entry points are `.`, `./server`, and `./assets`. Consumers serve private assets
  through descriptors from `@srdjan/avatar/assets`.
- DiceBear output and the generated browser script are byte contracts. Dependency versions,
  generated fingerprints, and asset hashes change together through the declared tasks.
- Exact Chromium screenshot baselines are scoped by host operating system. Linux CI and macOS
  development each use a reviewed hash; a new host requires its own reviewed baseline.
- A reaction is one exact atomic value. Its non-empty identity is opaque and compared byte for byte,
  without trimming, case folding, or Unicode normalization.
- Each SSR rig carries a non-empty match scope, a declared audio profile ID, and main, preceding,
  and micro lanes encoded as one JSON object or `null`. Old per-field attributes are not accepted.
- Advancing match scope retires the old scope for that live rig. A later update cannot roll back to
  a retired scope.
- Visual state selects semantic audio. `neutral` and `focused` are silent; laughs use explicit
  `standard` or `climactic` qualifiers. Callers cannot choose an unrelated sound.
- Every character audio profile has exactly seven slots, each with a non-empty source and gain from
  0 to 1. There is no package default or slot fallback.
- `init` is tagged, transactional, and repeatable. A valid call replaces the active configuration
  without replaying lifecycle state; an invalid call leaves the previous configuration active.
- Hydration, reconciliation, release, lane movement, repeated identity, reinitialization, and
  control updates are silent. A corrected reaction can retry after an unknown-profile or
  identity-conflict rejection because failed transactions do not consume its identity.
- Semantic audio admission applies the mute predicate, rig-kind policy, seat probability,
  confidence, channel cap, active-seat check, seat gap, and family cooldown. Visual delivery does
  not depend on audio admission.
- Browser media and analyzer failures are local and nonfatal. Cleanup releases channel capacity,
  removes listeners, and leaves visual lifecycle timers intact.
- External control uses only atomic `set` and `release` commands. One source owns a rig at a time,
  sequence numbers increase strictly, and control never emits semantic audio.
- Expression artwork banks are opt-in SSR data. Without a bank, bots use feature pose and tint,
  generated humans use tint and restrained layer motion, and photos use tint and outline only.
- Package color variables first use a consumer override, then the matching Preferans token when it
  exists, then the package default.
- `assets/private/facial-rig.js` is generated only with `deno task browser:build`. The checked asset
  is never edited or formatted by hand.
- `deno task package:integrity` is read-only. Intentional closure changes use
  `deno task package:integrity:write` after source and generated assets are final.
