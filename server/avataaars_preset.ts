import type { DecomposeOptions } from "./decompose.ts";

// Selector preset for DiceBear avataaars-neutral. The upstream library emits
// each facial feature as a sibling group with a stable translate offset. The
// viewBox zooms the feature band without changing the consumer's wrapper size.
// Literal transform matching is intentionally strict: onMissing exposes
// upstream SVG drift instead of silently returning an unrigged face.

export const avataaarsPreset: DecomposeOptions = {
  selectors: {
    "face-mouth": { transform: "translate(2 63)" },
    "face-nose": { transform: "translate(28 51)" },
    "face-eyes": { transform: "translate(0 19)" },
    "face-brows": { transform: "translate(0 11)" },
  },
  overlays: [
    {
      className: "face-detail-plane face-ear-plane",
      markup:
        '<path class="face-ear-contour face-ear-contour-left" d="M24 49 C18 52 18 67 24 71" />' +
        '<path class="face-ear-contour face-ear-contour-right" d="M88 49 C94 52 94 67 88 71" />',
    },
    {
      className: "face-detail-plane face-jawline-plane",
      markup: '<path class="face-jawline" d="M31 72 C35 88 47 96 56 96 C65 96 77 88 81 72" />',
    },
    {
      className: "face-detail-plane face-light-plane",
      markup: '<path class="face-highlight" d="M36 35 C43 28 56 25 69 29 C62 31 49 36 40 46 Z" />',
    },
    // Cheek, bridge, and jaw planes make the flat SVG respond to head light.
    {
      className: "face-detail-plane face-form-plane",
      markup:
        '<path class="face-form-highlight face-form-cheek-left" d="M30 58 Q36 54 44 58 Q36 60 30 58 Z" />' +
        '<path class="face-form-highlight face-form-cheek-right" d="M68 58 Q76 54 82 58 Q76 60 68 58 Z" />' +
        '<path class="face-form-highlight face-form-bridge" d="M54 38 Q56 36 58 38 L57 56 Q56 57 55 56 Z" />' +
        '<path class="face-form-shadow face-form-jaw" d="M34 78 Q56 90 78 78 Q56 92 34 78 Z" />',
    },
    // Brow-ridge shadows share eye depth so they remain attached to the face.
    {
      className: "face-socket-plane",
      markup:
        '<path class="face-socket-shadow face-socket-shadow-left" d="M30 39 Q38 37 46 39 Q38 42 30 39 Z" />' +
        '<path class="face-socket-shadow face-socket-shadow-right" d="M66 39 Q74 37 82 39 Q74 42 66 39 Z" />',
    },
    // Nose highlights and nostrils share the breathing nose transform.
    {
      className: "face-nose-volume-plane",
      markup:
        '<ellipse class="face-nose-nostril face-nose-nostril-left" cx="53.5" cy="64" rx="0.9" ry="0.6" />' +
        '<ellipse class="face-nose-nostril face-nose-nostril-right" cx="58.5" cy="64" rx="0.9" ry="0.6" />' +
        '<ellipse class="face-nose-tip-highlight" cx="56" cy="60" rx="1.3" ry="0.8" />',
    },
    // Catchlights anti-track the head to read as a fixed reflected light.
    {
      className: "face-catchlight-plane",
      markup:
        '<circle class="face-catchlight face-catchlight-left" cx="38.5" cy="44.5" r="1.15" />' +
        '<circle class="face-catchlight face-catchlight-right" cx="76.5" cy="44.5" r="1.15" />',
    },
    // Mirrored rim strokes reveal the far edge as the light direction moves.
    {
      className: "face-detail-plane face-rim-plane",
      markup: '<path class="face-rim face-rim-left" d="M28 32 C22 44 22 64 28 78" />' +
        '<path class="face-rim face-rim-right" d="M84 32 C90 44 90 64 84 78" />',
    },
    // Eyelid shadows compress with the blink scale.
    {
      className: "face-eyelid-plane",
      markup: '<ellipse class="face-eyelid face-eyelid-left" cx="37" cy="44" rx="3.5" ry="1.2" />' +
        '<ellipse class="face-eyelid face-eyelid-right" cx="75" cy="44" rx="3.5" ry="1.2" />',
    },
    // The tear-line becomes visible only for sad reaction poses.
    {
      className: "face-tearline-plane",
      markup:
        '<path class="face-tearline face-tearline-left" d="M32 52 Q37 54 42 52 Q37 55 32 52 Z" />' +
        '<path class="face-tearline face-tearline-right" d="M70 52 Q75 54 80 52 Q75 55 70 52 Z" />',
    },
    // The mouth cavity becomes visible only for wide reaction poses.
    {
      className: "face-mouth-cavity-plane",
      markup: '<ellipse class="face-mouth-cavity" cx="56" cy="88" rx="9" ry="4.5" />',
    },
    // Static ambient-occlusion marks deepen feature seams without animation.
    {
      className: "face-detail-plane face-ao-plane",
      markup: '<ellipse class="face-ao" cx="41" cy="47" rx="0.7" ry="0.45" />' +
        '<ellipse class="face-ao" cx="71" cy="47" rx="0.7" ry="0.45" />' +
        '<ellipse class="face-ao" cx="53.5" cy="65.2" rx="0.6" ry="0.35" />' +
        '<ellipse class="face-ao" cx="58.5" cy="65.2" rx="0.6" ry="0.35" />' +
        '<ellipse class="face-ao" cx="38" cy="80" rx="0.8" ry="0.5" />' +
        '<ellipse class="face-ao" cx="74" cy="80" rx="0.8" ry="0.5" />',
    },
  ],
  viewBox: { from: "0 0 112 112", to: "14 8 84 92" },
  onMissing: (missed) => {
    const classes = missed.map((item) => item.className).join(", ");
    const transforms = missed.map((item) => item.transform).join(", ");
    console.error(
      `avatar decomposition: missing ${classes} - expected ${transforms} ` +
        `in avataaars-neutral output. Library upgrade likely shifted offsets; ` +
        `per-feature animations will fall back to whole-face crossfade.`,
    );
  },
};
