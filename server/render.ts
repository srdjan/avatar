// Renders one stable avatar-rig wrapper. data-rig-kind selects the visual
// substrate: bot and generated-human rigs stack expression layers, while a
// human photo keeps only wrapper-level tint and motion.

import {
  type ReactionSpec,
  RIG_CONTROL_ARTWORK,
  type RigControlArtwork,
  type RigControlBank,
  type RigPersonality,
} from "../types.ts";

const SAFE_SVG_ELEMENTS = new Set([
  "circle",
  "dc:creator",
  "dc:rights",
  "dc:source",
  "dc:title",
  "dcterms:license",
  "ellipse",
  "g",
  "mask",
  "metadata",
  "path",
  "rdf:Description",
  "rdf:RDF",
  "rect",
  "svg",
]);

const SAFE_SVG_ATTRIBUTES = new Set([
  "class",
  "clip-rule",
  "cx",
  "cy",
  "d",
  "fill",
  "fill-opacity",
  "fill-rule",
  "height",
  "id",
  "mask",
  "r",
  "rx",
  "ry",
  "shape-rendering",
  "transform",
  "viewBox",
  "width",
  "x",
  "xmlns",
  "xmlns:dc",
  "xmlns:dcterms",
  "xmlns:rdf",
  "xmlns:xsi",
  "xsi:type",
  "y",
]);

const SVG_TAG = /<\s*(\/?)\s*([A-Za-z][\w:.-]*)([^<>]*)>/g;
const SVG_ATTRIBUTE = /\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const LOCAL_URL = /^url\(#[A-Za-z_][\w:.-]*\)$/;
const UNSAFE_URL_SYNTAX = /url\(|^(?:fill|mask)\0[\s\S]*(?:&|\\|var\s*\()/i;

declare const safeInlineSvgBrand: unique symbol;

type SafeInlineSvg = string & Readonly<{ [safeInlineSvgBrand]: true }>;

type SvgRejection =
  | "root element"
  | "invalid markup"
  | "content after root"
  | "incomplete root"
  | `element ${string}`
  | `closing element ${string}`
  | `unbalanced element ${string}`
  | `attributes on ${string}`
  | `attribute ${string}`
  | `value for ${string}`
  | `URL for ${string}`;

type SvgValidation =
  | Readonly<{ tag: "safe"; svg: SafeInlineSvg }>
  | Readonly<{ tag: "rejected"; reason: SvgRejection }>;

type ReportSvgRejection = (reason: SvgRejection) => void;

const reportSvgRejection: ReportSvgRejection = (reason) =>
  console.warn(`avatar: unsafe inline SVG rejected (${reason}); rendering a blank layer`);

type CommonInput = Readonly<{
  // Caller-owned token used to derive all DOM ids for this rig instance.
  id: string;
  // Finished accessible label. The package does not compose localized text.
  label: string;
  reaction: ReactionSpec | null;
  microReaction: ReactionSpec | null;
  precedingReaction: ReactionSpec | null;
  personality: RigPersonality;
}>;

export type RenderRigInput =
  & CommonInput
  & (
    | Readonly<{
      rigKind: "bot";
      baseSvg: string;
      expressionSvg: string;
      microSvg: string;
      controlBank?: Extract<RigControlBank, { rigKind: "bot" }>;
      reactionBotEmotion?: string | null;
      microBotEmotion?: string | null;
    }>
    | Readonly<{
      rigKind: "human-generated";
      baseSrc: string;
      expressionSrc: string;
      microSrc: string;
      controlBank?: Extract<RigControlBank, { rigKind: "human-generated" }>;
      emotion: string | null;
      width?: number;
      height?: number;
    }>
    | Readonly<{
      rigKind: "human-photo";
      src: string;
      emotion: string | null;
      width?: number;
      height?: number;
    }>
  );

export function renderFacialRig(input: RenderRigInput): string {
  switch (input.rigKind) {
    case "bot":
      return wrapRig(input, botLayers(input, reportSvgRejection));
    case "human-generated":
      return wrapRig(input, humanGeneratedLayers(input));
    case "human-photo":
      return wrapRig(input, humanPhotoLayers(input));
  }
}

// Bot layers inline decomposed SVG so the browser can target face groups.
function botLayers(
  input: Extract<RenderRigInput, { rigKind: "bot" }>,
  reportRejection: ReportSvgRejection,
): string {
  const base = inlineSvgAttrs(input.baseSvg, {
    "class": "avatar avatar-rigged avatar-base",
    id: `avatar-${input.id}`,
    role: "img",
    "aria-label": input.label,
  }, reportRejection);
  const expression = inlineSvgAttrs(input.expressionSvg, {
    "class": "avatar avatar-rigged avatar-expression",
    id: `avatar-expression-${input.id}`,
    "aria-hidden": "true",
  }, reportRejection);
  const micro = inlineSvgAttrs(input.microSvg, {
    "class": "avatar avatar-rigged avatar-micro-expression",
    id: `avatar-micro-expression-${input.id}`,
    "aria-hidden": "true",
  }, reportRejection);
  return `${base}${expression}${micro}${botControlBank(input, reportRejection)}`;
}

function botControlBank(
  input: Extract<RenderRigInput, { rigKind: "bot" }>,
  reportRejection: ReportSvgRejection,
): string {
  const bank = input.controlBank;
  if (bank === undefined || bank.rigKind !== "bot") return "";
  return groupControlArtwork(bank.layers).map((group) => {
    const layer = inlineSvgAttrs(group.source, {
      "class": "avatar avatar-rigged avatar-control-expression",
      "data-control-preset": group.primary,
      "aria-hidden": "true",
    }, reportRejection);
    return `<template class="avatar-control-layer" data-control-layer="${group.aliases}">${layer}</template>`;
  }).join("");
}

function humanGeneratedLayers(
  input: Extract<RenderRigInput, { rigKind: "human-generated" }>,
): string {
  const w = input.width ?? 40;
  const h = input.height ?? 40;
  const visible = `<img class="avatar avatar-base" data-emotion="${esc(input.emotion ?? "")}" ` +
    `src="${esc(input.baseSrc)}" alt="${esc(input.label)}" width="${w}" height="${h}">` +
    `<img class="avatar avatar-expression" aria-hidden="true" ` +
    `id="avatar-expression-${esc(input.id)}" src="${esc(input.expressionSrc)}" ` +
    `alt="" width="${w}" height="${h}">` +
    `<img class="avatar avatar-micro-expression" aria-hidden="true" ` +
    `id="avatar-micro-expression-${esc(input.id)}" src="${esc(input.microSrc)}" ` +
    `alt="" width="${w}" height="${h}">`;
  return visible + humanGeneratedControlBank(input, w, h);
}

function humanGeneratedControlBank(
  input: Extract<RenderRigInput, { rigKind: "human-generated" }>,
  width: number,
  height: number,
): string {
  const bank = input.controlBank;
  if (bank === undefined || bank.rigKind !== "human-generated") return "";
  return groupControlArtwork(bank.layers).map((group) =>
    `<template class="avatar-control-layer" data-control-layer="${group.aliases}">` +
    `<img class="avatar avatar-control-expression" data-control-preset="${group.primary}" ` +
    `aria-hidden="true" src="${esc(group.source)}" alt="" ` +
    `width="${width}" height="${height}"></template>`
  ).join("");
}

type GroupedControlArtwork = Readonly<{
  source: string;
  primary: RigControlArtwork;
  aliases: string;
}>;

function groupControlArtwork(
  layers: Readonly<Record<RigControlArtwork, string>>,
): GroupedControlArtwork[] {
  const grouped = new Map<string, RigControlArtwork[]>();
  RIG_CONTROL_ARTWORK.forEach((artwork) => {
    const source = layers[artwork];
    grouped.set(source, [...(grouped.get(source) ?? []), artwork]);
  });
  return [...grouped].map(([source, artwork]) => ({
    source,
    primary: artwork[0] ?? "neutral",
    aliases: artwork.join(" "),
  }));
}

// Photos are not facially decomposed. Reactions stay on the wrapper to avoid
// an uncanny expression overlay, and the runtime suppresses voice for them.
function humanPhotoLayers(
  input: Extract<RenderRigInput, { rigKind: "human-photo" }>,
): string {
  const w = input.width ?? 40;
  const h = input.height ?? 40;
  return `<img class="avatar avatar-base" data-emotion="${esc(input.emotion ?? "")}" ` +
    `src="${esc(input.src)}" alt="${esc(input.label)}" ` +
    `width="${w}" height="${h}">`;
}

function wrapRig(input: RenderRigInput, children: string): string {
  return `<span class="avatar-rig" ${rigDataAttrs(input)}>${children}</span>`;
}

function rigDataAttrs(input: RenderRigInput): string {
  const p = input.personality;
  const attrs = [
    `id="avatar-rig-${esc(input.id)}"`,
    `data-rig-kind="${input.rigKind}"`,
    `data-rig-signature="${rigSignature(input)}"`,
    `data-seat-audio-probability="${p.audioProbability}"`,
    `data-seat-duration-scale="${p.durationScale}"`,
    ...reactionDataAttrs("reaction", input.reaction),
    ...reactionDataAttrs("preceding", input.precedingReaction),
    ...reactionDataAttrs("micro", input.microReaction),
  ];
  if (input.rigKind === "bot") {
    if (p.amplitudeScale !== 1) {
      attrs.push(`style="--seat-amplitude-scale: ${p.amplitudeScale}"`);
    }
    attrs.push(`data-reaction-bot-emotion="${esc(input.reactionBotEmotion ?? "")}"`);
    attrs.push(`data-micro-bot-emotion="${esc(input.microBotEmotion ?? "")}"`);
  }
  return attrs.join(" ");
}

function rigSignature(input: RenderRigInput): string {
  switch (input.rigKind) {
    case "bot":
      return `bot:${hashString(input.baseSvg)}${controlBankSignature(input.controlBank)}`;
    case "human-generated":
      return `human-generated:${hashString(input.baseSrc)}${
        controlBankSignature(input.controlBank)
      }`;
    case "human-photo":
      return `human-photo:${hashString(input.src)}`;
  }
}

function controlBankSignature(bank: RigControlBank | undefined): string {
  return bank === undefined ? "" : `:${
    hashString(
      RIG_CONTROL_ARTWORK.map((artwork) => bank.layers[artwork]).join(""),
    )
  }`;
}

function hashString(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
  return (hash >>> 0).toString(36);
}

function reactionDataAttrs(prefix: string, reaction: ReactionSpec | null): string[] {
  const attrs = reactionAttributes(reaction);
  return [
    `data-${prefix}-kind="${esc(attrs.kind)}"`,
    `data-${prefix}-expression="${esc(attrs.expression)}"`,
    `data-${prefix}-intensity="${attrs.intensity}"`,
    `data-${prefix}-motion="${esc(attrs.motion)}"`,
    `data-${prefix}-duration-ms="${attrs.durationMs}"`,
    `data-${prefix}-confidence="${attrs.confidence}"`,
    `data-${prefix}-voice-cue="${esc(attrs.voiceCue)}"`,
    `data-${prefix}-id="${attrs.id}"`,
  ];
}

type ReactionAttributes = Readonly<{
  kind: string;
  expression: string;
  intensity: number;
  motion: string;
  durationMs: number;
  confidence: number;
  voiceCue: string;
  id: number;
}>;

const NO_REACTION_ATTRIBUTES = Object.freeze({
  kind: "",
  expression: "",
  intensity: 0,
  motion: "",
  durationMs: 0,
  confidence: 1,
  voiceCue: "",
  id: 0,
}) satisfies ReactionAttributes;

function reactionAttributes(reaction: ReactionSpec | null): ReactionAttributes {
  if (reaction === null) return NO_REACTION_ATTRIBUTES;
  return {
    kind: reaction.kind ?? "",
    expression: reaction.expression,
    intensity: reaction.intensity,
    motion: reaction.motion,
    durationMs: reaction.durationMs,
    confidence: clampNumber(reaction.confidence ?? 1, 0, 1),
    voiceCue: reaction.voiceCue,
    id: reaction.id,
  };
}

function clampNumber(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return max;
  return Math.max(min, Math.min(max, n));
}

// Rejected SVG degrades to one blank layer instead of throwing: a rig renders
// on the synchronous table-render path, and callers restore avatar markup from
// storage written before this grammar existed. One blank face is recoverable;
// a thrown render is not. The replacement keeps the wrapper attributes so the
// browser runtime still finds the element it expects.
function inlineSvgAttrs(
  svg: string,
  attrs: Record<string, string>,
  reportRejection: ReportSvgRejection,
): string {
  const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  const validation = validateInlineSvg(svg);
  if (validation.tag === "rejected") {
    reportRejection(validation.reason);
    return `<svg ${attrStr} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`;
  }
  // A function replacement keeps `$&`, "$`" and `$'` in caller-supplied labels
  // and ids literal; a string replacement would re-expand them after esc().
  return renderInlineSvg(validation.svg, attrStr);
}

function renderInlineSvg(svg: SafeInlineSvg, attrStr: string): string {
  return svg.replace(/^<svg(?=[\s>])/, () => `<svg ${attrStr}`);
}

// Inline SVG is executable markup. Keep this grammar deliberately narrower
// than general SVG and expand it only when package-owned generator output does.
// Produces the only SafeInlineSvg values consumed by the renderer.
function validateInlineSvg(svg: string): SvgValidation {
  const stack: string[] = [];
  let cursor = 0;
  let rootSeen = false;
  let rootClosed = false;

  for (const match of svg.matchAll(SVG_TAG)) {
    const index = match.index;
    if (!rootSeen && index !== 0) return { tag: "rejected", reason: "root element" };
    if (svg.slice(cursor, index).includes("<")) {
      return { tag: "rejected", reason: "invalid markup" };
    }
    if (rootClosed && svg.slice(cursor, index).trim() !== "") {
      return { tag: "rejected", reason: "content after root" };
    }

    const closing = match[1] === "/";
    const element = match[2]!;
    const rawAttributes = match[3]!;
    if (!SAFE_SVG_ELEMENTS.has(element)) {
      return { tag: "rejected", reason: `element ${element}` };
    }

    if (closing) {
      if (rawAttributes.trim() !== "") {
        return { tag: "rejected", reason: `closing element ${element}` };
      }
      if (stack.pop() !== element) {
        return { tag: "rejected", reason: `unbalanced element ${element}` };
      }
      if (stack.length === 0) rootClosed = true;
    } else {
      const selfClosing = rawAttributes.trimEnd().endsWith("/");
      if (stack.length === 0) {
        if (rootSeen || element !== "svg") {
          return { tag: "rejected", reason: "root element" };
        }
        rootSeen = true;
      }
      const attributeRejection = svgAttributeRejection(rawAttributes, element);
      if (attributeRejection !== null) {
        return { tag: "rejected", reason: attributeRejection };
      }
      if (!selfClosing) stack.push(element);
      else if (stack.length === 0) rootClosed = true;
    }
    cursor = index + match[0].length;
  }

  if (!rootSeen || !rootClosed || stack.length !== 0) {
    return { tag: "rejected", reason: "incomplete root" };
  }
  if (svg.slice(cursor).trim() !== "" || svg.slice(cursor).includes("<")) {
    return { tag: "rejected", reason: "content after root" };
  }
  return { tag: "safe", svg: svg as SafeInlineSvg };
}

function svgAttributeRejection(source: string, element: string): SvgRejection | null {
  let cursor = 0;
  while (!/^[\s/]*$/.test(source.slice(cursor))) {
    SVG_ATTRIBUTE.lastIndex = cursor;
    const match = SVG_ATTRIBUTE.exec(source);
    if (!match) return `attributes on ${element}`;
    const name = match[1]!;
    const value = match[2] ?? match[3] ?? "";
    if (!SAFE_SVG_ATTRIBUTES.has(name) && !/^data-[a-z][\w.-]*$/.test(name)) {
      return `attribute ${name}`;
    }
    if (/javascript\s*:|data\s*:\s*text\/html/i.test(value)) return `value for ${name}`;
    if (UNSAFE_URL_SYNTAX.test(`${name}\0${value}`) && !LOCAL_URL.test(value)) {
      return `URL for ${name}`;
    }
    cursor = SVG_ATTRIBUTE.lastIndex;
  }
  return null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
