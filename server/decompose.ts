// Wraps individual face-feature groups inside an SVG so CSS can target each
// feature independently for per-feature animation.
//
// The caller identifies a feature by the literal transform on its positioning
// group. The output nests three groups: a parallax plane, the original SVG
// positioning group, and an inner pose group for browser-runtime transforms.
// Keeping those responsibilities on separate elements prevents CSS and JS
// transforms from overwriting the SVG's original placement.
//
// The optional viewBox replacement zooms the feature region.

export type FeatureSelector = Readonly<{
  transform: string;
}>;

export type FeatureSelectors = Readonly<Record<string, FeatureSelector>>;

export type SvgOverlay = Readonly<{
  className: string;
  markup: string;
}>;

export type DecomposeOptions = Readonly<{
  selectors: FeatureSelectors;
  overlays?: readonly SvgOverlay[];
  viewBox?: { from: string; to: string };
  onMissing?: (
    missing: ReadonlyArray<{ className: string; transform: string }>,
  ) => void;
}>;

export function decomposeFaceFeatures(
  svg: string,
  options: DecomposeOptions,
): string {
  let out = svg;
  if (options.viewBox) {
    out = out.replace(
      `viewBox="${options.viewBox.from}"`,
      `viewBox="${options.viewBox.to}"`,
    );
  }
  const missed: Array<{ className: string; transform: string }> = [];
  for (const [className, { transform }] of Object.entries(options.selectors)) {
    const open = `<g transform="${transform}">`;
    const idx = out.indexOf(open);
    if (idx === -1) {
      missed.push({ className, transform });
      continue;
    }
    const after = idx + open.length;
    const close = findMatchingGroupClose(out, after);
    if (close === -1) {
      missed.push({ className, transform });
      continue;
    }
    out = out.slice(0, idx) + `<g class="${className}-plane">` + open +
      `<g class="${className}">` + out.slice(after, close) + `</g></g></g>` +
      out.slice(close + 4);
  }
  if (options.overlays && options.overlays.length > 0) {
    out = appendOverlays(out, options.overlays);
  }
  if (missed.length > 0 && options.onMissing) options.onMissing(missed);
  return out;
}

function appendOverlays(svg: string, overlays: readonly SvgOverlay[]): string {
  const insertionPoint = overlayInsertionPoint(svg);
  if (insertionPoint === -1) return svg;
  const markup = overlays
    .map((overlay) => `<g class="${overlay.className}">${overlay.markup}</g>`)
    .join("");
  return svg.slice(0, insertionPoint) + markup + svg.slice(insertionPoint);
}

function overlayInsertionPoint(svg: string): number {
  const closeSvg = svg.lastIndexOf("</svg>");
  if (closeSvg === -1) return -1;

  const maskOpen = svg.indexOf("<g mask=");
  if (maskOpen !== -1 && maskOpen < closeSvg) {
    const maskOpenEnd = svg.indexOf(">", maskOpen);
    if (maskOpenEnd !== -1) {
      const maskClose = findMatchingGroupClose(svg, maskOpenEnd + 1);
      if (maskClose !== -1 && maskClose <= closeSvg) return maskClose;
    }
  }
  return closeSvg;
}

// Return the close tag that balances the group opening immediately before
// start. The tag-boundary check avoids treating glyph or gradient as a group.
function findMatchingGroupClose(svg: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < svg.length) {
    const nextOpen = findGroupOpen(svg, i);
    const nextClose = svg.indexOf("</g>", i);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 2;
    } else {
      depth--;
      if (depth === 0) return nextClose;
      i = nextClose + 4;
    }
  }
  return -1;
}

// A self-closing `<g/>` opens no group, so accepting `/` here would add a
// depth the matching `</g>` scan can never remove.
function findGroupOpen(svg: string, from: number): number {
  let cursor = from;
  while (cursor < svg.length) {
    const idx = svg.indexOf("<g", cursor);
    if (idx === -1) return -1;
    const next = svg[idx + 2];
    if (next === " " || next === ">" || next === "\t" || next === "\n") return idx;
    cursor = idx + 2;
  }
  return -1;
}
