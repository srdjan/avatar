import { assertEquals } from "jsr:@std/assert@1.0.14";
import type { ReactionSpec } from "@srdjan/avatar";
import { AVATAR_ASSETS } from "@srdjan/avatar/assets";
import { renderFacialRig } from "@srdjan/avatar/server";
import { type Browser, chromium, type Page } from "npm:playwright@1.60.0";

const FACE_SVG = '<svg viewBox="0 0 112 112">' +
  '<g class="face-eyes"></g><g class="face-mouth"></g>' +
  '<g class="face-brows"></g><g class="face-nose"></g></svg>';

const PERSONALITY = {
  amplitudeScale: 1,
  durationScale: 1,
  audioProbability: 1,
} as const;

type FacialRigApi = Readonly<{
  init(config?: Readonly<Record<string, unknown>>): void;
  prepareSwap(fragment: ParentNode): void;
  sync(): void;
  play(request: Readonly<Record<string, unknown>>): void;
  startSpeaking(rigId: string, cue: string, durationMs: number): void;
  stopSpeaking(rigId: string): void;
}>;

function localPath(url: URL): string {
  return decodeURIComponent(url.pathname);
}

type V8Range = Readonly<{ startOffset: number; endOffset: number; count: number }>;
type V8Function = Readonly<{
  functionName: string;
  ranges: ReadonlyArray<V8Range>;
}>;
type CoverageEntry = Readonly<{
  url: string;
  source?: string;
  functions?: ReadonlyArray<V8Function>;
}>;

const COVERAGE_ENABLED = Deno.env.get("AVATAR_BROWSER_COVERAGE") === "1";
const coverageEntries: CoverageEntry[] = [];

async function launchBrowser(
  options: Parameters<typeof chromium.launch>[0] = { headless: true },
): Promise<Browser> {
  const browser = await chromium.launch(options);
  if (!COVERAGE_ENABLED) return browser;
  const pages: Page[] = [];
  return new Proxy(browser, {
    get(target, property, receiver) {
      if (property === "newPage") {
        return async (...args: Parameters<Browser["newPage"]>) => {
          const page = await target.newPage(...args);
          await page.coverage.startJSCoverage({ resetOnNavigation: false });
          pages.push(page);
          return page;
        };
      }
      if (property === "close") {
        return async () => {
          for (const page of pages) {
            if (!page.isClosed()) {
              coverageEntries.push(...await page.coverage.stopJSCoverage() as CoverageEntry[]);
            }
          }
          await target.close();
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function reaction(
  id: number,
  overrides: Partial<ReactionSpec> = {},
): ReactionSpec {
  return {
    kind: "TestReaction",
    expression: "happiness",
    intensity: 1,
    motion: "pop",
    voiceCue: "laugh",
    durationMs: 120,
    confidence: 1,
    id,
    ...overrides,
  };
}

function renderBotRig(
  overrides: Readonly<{
    id?: string;
    baseSvg?: string;
    amplitudeScale?: number;
    reaction?: ReactionSpec | null;
    precedingReaction?: ReactionSpec | null;
    microReaction?: ReactionSpec | null;
  }> = {},
): string {
  return renderFacialRig({
    id: overrides.id ?? "east",
    label: overrides.id ?? "East",
    reaction: overrides.reaction ?? null,
    precedingReaction: overrides.precedingReaction ?? null,
    microReaction: overrides.microReaction ?? null,
    personality: {
      ...PERSONALITY,
      amplitudeScale: overrides.amplitudeScale ?? PERSONALITY.amplitudeScale,
    },
    rigKind: "bot",
    baseSvg: overrides.baseSvg ?? FACE_SVG,
    expressionSvg: FACE_SVG,
    microSvg: FACE_SVG,
    reactionBotEmotion: "happy",
    microBotEmotion: "focused",
  });
}

async function loadFacialRig(page: Page): Promise<void> {
  await page.addStyleTag({ path: localPath(AVATAR_ASSETS.facialRigStyles.url) });
  await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });
  await page.evaluate(() => {
    const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
    api.init();
    api.sync();
  });
}

Deno.test("SSR rig IDs cannot create browser event attributes", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const hostileId = 'east" onpointerenter="globalThis.pwned=1';
    const svg = '<svg data-stub="safe" />';
    const html = renderFacialRig({
      id: hostileId,
      label: "East",
      reaction: null,
      precedingReaction: null,
      microReaction: null,
      personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 0 },
      rigKind: "bot",
      baseSvg: svg,
      expressionSvg: svg,
      microSvg: svg,
    });
    await page.setContent(html);
    await page.locator(".avatar-rig").hover();

    assertEquals(await page.locator("[onpointerenter]").count(), 0);
    assertEquals(await page.locator(".avatar-rig").getAttribute("id"), `avatar-rig-${hostileId}`);
    assertEquals(
      await page.evaluate(() => (globalThis as typeof globalThis & { pwned?: number }).pwned ?? 0),
      0,
    );
  } finally {
    await browser.close();
  }
});

Deno.test("SSR blocks obfuscated external SVG URLs before browser parsing", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const requestedUrls: string[] = [];
    await page.route("https://svg-escape.test/**", async (route) => {
      requestedUrls.push(route.request().url());
      await route.fulfill({ status: 204, body: "" });
    });
    const unsafeSvgs = [
      '<svg><path d="M0 0h10v10H0z" fill="u&#114;l(https://svg-escape.test/entity)"/></svg>',
      String.raw`<svg><path d="M0 0h10v10H0z" fill="u\72 l(https://svg-escape.test/css)"/></svg>`,
    ];
    const html = (() => {
      const realWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
      try {
        const result = unsafeSvgs.map((baseSvg, index) =>
          renderBotRig({ id: `unsafe-${index}`, baseSvg })
        );
        assertEquals(warnings.length, unsafeSvgs.length);
        return result;
      } finally {
        console.warn = realWarn;
      }
    })();

    for (const rigHtml of html) {
      await page.setContent(rigHtml);
    }
    await page.waitForTimeout(20);

    assertEquals(requestedUrls, []);
  } finally {
    await browser.close();
  }
});

Deno.test("browser runtime animates an AI turn rig without consumer coupling", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="seat is-turn is-ai">
        <span id="avatar-rig-east" class="avatar-rig" data-rig-kind="bot"
          data-seat-audio-probability="0"
          data-reaction-kind="" data-reaction-expression="" data-reaction-intensity="0"
          data-reaction-motion="" data-reaction-duration-ms="0" data-reaction-confidence="1"
          data-reaction-voice-cue="" data-reaction-id="0"
          data-preceding-kind="" data-preceding-expression="" data-preceding-intensity="0"
          data-preceding-motion="" data-preceding-duration-ms="0" data-preceding-confidence="1"
          data-preceding-voice-cue="" data-preceding-id="0"
          data-micro-kind="" data-micro-expression="" data-micro-intensity="0"
          data-micro-motion="" data-micro-duration-ms="0" data-micro-confidence="1"
          data-micro-voice-cue="" data-micro-id="0">
          <svg class="avatar-base"><g class="face-eyes"></g><g class="face-mouth"></g><g class="face-brows"></g></svg>
          <svg class="avatar-expression"><g class="face-eyes"></g><g class="face-mouth"></g><g class="face-brows"></g></svg>
        </span>
      </div>
    `);
    const globalsBefore = await page.evaluate(() => Object.getOwnPropertyNames(window));
    await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });
    assertEquals(
      await page.evaluate(
        (before) => Object.getOwnPropertyNames(window).filter((name) => !before.includes(name)),
        globalsBefore,
      ),
      ["FacialRig"],
    );
    await page.evaluate(() => {
      const api = (window as unknown as { FacialRig: { init(): void; sync(): void } }).FacialRig;
      api.init();
      api.sync();
    });
    await page.waitForTimeout(250);
    const idleScale = await page.locator("#avatar-rig-east").evaluate((element) =>
      (element as HTMLElement).style.getPropertyValue("--rig-breath-scale")
    );
    assertEquals(idleScale.length > 0, true);

    await page.locator("#avatar-rig-east").evaluate((element) => {
      element.setAttribute("data-reaction-kind", "TestReaction");
      element.setAttribute("data-reaction-expression", "happiness");
      element.setAttribute("data-reaction-intensity", "1");
      element.setAttribute("data-reaction-motion", "pop");
      element.setAttribute("data-reaction-duration-ms", "300");
      element.setAttribute("data-reaction-id", "1");
    });
    await page.evaluate(() => {
      (window as unknown as { FacialRig: { sync(): void } }).FacialRig.sync();
    });
    assertEquals(
      await page.locator("#avatar-rig-east").evaluate((element) =>
        element.classList.contains("is-reacting")
      ),
      true,
    );
  } finally {
    await browser.close();
  }
});

Deno.test("reaction poses scale SSR amplitude and confidence from neutral", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const cases = [
      { id: "amp-0", amplitudeScale: 0, confidence: 1 },
      { id: "amp-1", amplitudeScale: 1, confidence: 1 },
      { id: "amp-2", amplitudeScale: 2, confidence: 1 },
      { id: "confidence-0", amplitudeScale: 2, confidence: 0 },
    ] as const;
    await page.setContent(
      cases.map(({ id, amplitudeScale }) => renderBotRig({ id, amplitudeScale })).join(""),
    );
    await loadFacialRig(page);

    const incoming = cases.map(({ id, amplitudeScale, confidence }) =>
      renderBotRig({
        id,
        amplitudeScale,
        reaction: reaction(1, { confidence, durationMs: 2_000 }),
        microReaction: reaction(1, { confidence, durationMs: 2_000 }),
      })
    ).join("");
    const transforms = await page.evaluate((html) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const template = document.createElement("template");
      template.innerHTML = html;
      api.prepareSwap(template.content);
      api.sync();
      return [...document.querySelectorAll<HTMLElement>(".avatar-rig")].map((rig) => ({
        id: rig.id,
        macro: rig.querySelector<SVGElement>(".avatar-expression .face-mouth")?.style.transform,
        micro: rig.querySelector<SVGElement>(".avatar-micro-expression .face-mouth")?.style
          .transform,
      }));
    }, incoming);

    assertEquals(transforms, [
      { id: "avatar-rig-amp-0", macro: "translateY(0px) scale(1)", micro: "scale(1)" },
      { id: "avatar-rig-amp-1", macro: "translateY(-1px) scale(1.15)", micro: "scale(1.1)" },
      { id: "avatar-rig-amp-2", macro: "translateY(-2px) scale(1.3)", micro: "scale(1.2)" },
      { id: "avatar-rig-confidence-0", macro: "translateY(0px) scale(1)", micro: "scale(1)" },
    ]);
  } finally {
    await browser.close();
  }
});

Deno.test("direct same-ID DOM replacement applies an advanced reaction", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderBotRig({ reaction: reaction(0) }));
    await loadFacialRig(page);

    const reacting = await page.evaluate((html) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const template = document.createElement("template");
      template.innerHTML = html;
      document.querySelector("#avatar-rig-east")?.replaceWith(template.content);
      api.sync();
      return document.querySelector("#avatar-rig-east")?.classList.contains("is-reacting");
    }, renderBotRig({ reaction: reaction(1, { durationMs: 2_000 }) }));

    assertEquals(reacting, true);
  } finally {
    await browser.close();
  }
});

Deno.test("changed-signature prepareSwap preserves the caller fragment for the live swap", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderBotRig());
    await loadFacialRig(page);
    const changedSvg = FACE_SVG.replace("<svg ", '<svg data-version="2" ');

    const result = await page.evaluate((html) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const template = document.createElement("template");
      template.innerHTML = html;
      const fragmentHadRig = template.content.querySelector("#avatar-rig-east") !== null;
      api.prepareSwap(template.content);
      const fragmentStillHasRig = template.content.querySelector("#avatar-rig-east") !== null;
      document.querySelector("#avatar-rig-east")?.replaceWith(template.content);
      api.sync();
      const replacement = document.querySelector<HTMLElement>("#avatar-rig-east");
      return {
        fragmentHadRig,
        fragmentStillHasRig,
        version: replacement?.querySelector(".avatar-base")?.getAttribute("data-version") ?? null,
      };
    }, renderBotRig({ baseSvg: changedSvg }));

    assertEquals(result, {
      fragmentHadRig: true,
      fragmentStillHasRig: true,
      version: "2",
    });
  } finally {
    await browser.close();
  }
});

Deno.test("SSR output drives reactions and preserves only matching rig substrates", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const generated = renderFacialRig({
      id: "human-generated",
      label: "Generated human",
      reaction: null,
      precedingReaction: null,
      microReaction: null,
      personality: PERSONALITY,
      rigKind: "human-generated",
      baseSrc: "/human-base.svg",
      expressionSrc: "/human-expression.svg",
      microSrc: "/human-micro.svg",
      emotion: "focused",
      width: 36,
      height: 38,
    });
    const photo = renderFacialRig({
      id: "human-photo",
      label: "Human photo",
      reaction: null,
      precedingReaction: null,
      microReaction: null,
      personality: PERSONALITY,
      rigKind: "human-photo",
      src: "/photo.webp",
      emotion: null,
    });
    await page.setContent(renderBotRig({ reaction: reaction(1) }) + generated + photo);
    await loadFacialRig(page);

    assertEquals(
      await page.locator("#avatar-rig-east").evaluate((rig) =>
        rig.classList.contains("is-reacting")
      ),
      false,
    );

    assertEquals(
      await page.locator(".avatar-rig").evaluateAll((rigs) =>
        rigs.map((rig) => ({
          kind: rig.getAttribute("data-rig-kind"),
          images: rig.querySelectorAll("img").length,
          svgs: rig.querySelectorAll("svg").length,
        }))
      ),
      [
        { kind: "bot", images: 0, svgs: 3 },
        { kind: "human-generated", images: 3, svgs: 0 },
        { kind: "human-photo", images: 1, svgs: 0 },
      ],
    );

    const incoming = renderBotRig({
      precedingReaction: reaction(1, {
        kind: "LeadReaction",
        expression: "surprise",
        motion: "shake",
        durationMs: 40,
      }),
      reaction: reaction(2, { kind: "MainReaction", motion: "pop" }),
      microReaction: reaction(1, {
        kind: "MicroReaction",
        expression: "focused",
        motion: "sink",
        durationMs: 80,
      }),
    });
    const advancedIncoming = renderBotRig({
      reaction: reaction(3, { durationMs: 2_000 }),
      microReaction: reaction(2, { durationMs: 2_000 }),
    });
    const preserved = await page.evaluate((html) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const live = document.querySelector<HTMLElement>("#avatar-rig-east")!;
      live.dataset.liveMarker = "preserved";
      const template = document.createElement("template");
      template.innerHTML = html;
      api.prepareSwap(template.content);
      api.sync();
      return {
        marker: live.dataset.liveMarker,
        reactionId: live.getAttribute("data-reaction-id"),
        microId: live.getAttribute("data-micro-id"),
        reacting: live.classList.contains("is-reacting"),
        microReacting: live.classList.contains("is-micro-reacting"),
        leadMotion: live.classList.contains("motion-shake"),
      };
    }, incoming);
    assertEquals(preserved, {
      marker: "preserved",
      reactionId: "2",
      microId: "1",
      reacting: true,
      microReacting: true,
      leadMotion: true,
    });

    await page.waitForTimeout(60);
    assertEquals(
      await page.locator("#avatar-rig-east").evaluate((rig) => ({
        motion: rig.classList.contains("motion-pop"),
        animation: getComputedStyle(rig).animationName,
        expressionOpacity: getComputedStyle(rig.querySelector(".avatar-expression")!).opacity,
      })),
      {
        motion: true,
        animation: "bot-avatar-react-pop",
        expressionOpacity: "1",
      },
    );

    const layerIdentity = await page.evaluate(({ sameHtml, advancedHtml }) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const rig = document.querySelector<HTMLElement>("#avatar-rig-east")!;
      rig.classList.add("is-reacting", "is-micro-reacting");
      const expression = rig.querySelector<SVGElement>(".avatar-expression")!;
      const micro = rig.querySelector<SVGElement>(".avatar-micro-expression")!;
      expression.dataset.layerMarker = "expression";
      micro.dataset.layerMarker = "micro";
      const prepare = (
        incomingHtml: string,
        markers: Readonly<{ expression: string; micro: string }> | null = null,
        removeExpression = false,
      ) => {
        const template = document.createElement("template");
        template.innerHTML = incomingHtml;
        if (markers !== null) {
          const expression = template.content.querySelector<SVGElement>(".avatar-expression");
          const micro = template.content.querySelector<SVGElement>(".avatar-micro-expression");
          if (expression !== null) expression.dataset.layerMarker = markers.expression;
          if (micro !== null) micro.dataset.layerMarker = markers.micro;
        }
        if (removeExpression) template.content.querySelector(".avatar-expression")?.remove();
        api.prepareSwap(template.content);
      };
      prepare(sameHtml);
      const active = {
        expression: rig.querySelector<SVGElement>(".avatar-expression")?.dataset.layerMarker,
        micro: rig.querySelector<SVGElement>(".avatar-micro-expression")?.dataset.layerMarker,
      };
      prepare(advancedHtml, { expression: "advanced-expression", micro: "advanced-micro" });
      const advanced = {
        expression: rig.querySelector<SVGElement>(".avatar-expression")?.dataset.layerMarker,
        micro: rig.querySelector<SVGElement>(".avatar-micro-expression")?.dataset.layerMarker,
      };
      rig.classList.remove("is-reacting", "is-micro-reacting");
      prepare(advancedHtml);
      const inactive = {
        expression: rig.querySelector<SVGElement>(".avatar-expression")?.dataset.layerMarker ??
          null,
        micro: rig.querySelector<SVGElement>(".avatar-micro-expression")?.dataset.layerMarker ??
          null,
      };
      rig.querySelector<SVGElement>(".avatar-expression")!.dataset.missingMarker = "preserved";
      prepare(advancedHtml, null, true);
      const missingExpression = rig.querySelector<SVGElement>(".avatar-expression")?.dataset
        .missingMarker;
      return { active, advanced, inactive, missingExpression };
    }, { sameHtml: incoming, advancedHtml: advancedIncoming });
    assertEquals(layerIdentity, {
      active: { expression: "expression", micro: "micro" },
      advanced: { expression: "advanced-expression", micro: "advanced-micro" },
      inactive: { expression: null, micro: null },
      missingExpression: "preserved",
    });

    const clearedIdleProperties = await page.locator("#avatar-rig-east").evaluate((rig) => {
      const element = rig as HTMLElement;
      element.style.setProperty("--idle-gaze-tx", "2px");
      element.style.setProperty("--rig-breath-scale", "1.01");
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      return {
        gaze: element.style.getPropertyValue("--idle-gaze-tx"),
        breath: element.style.getPropertyValue("--rig-breath-scale"),
      };
    });
    assertEquals(clearedIdleProperties, { gaze: "", breath: "" });

    const changedSvg = FACE_SVG.replace("<svg ", '<svg data-version="2" ');
    const changedSubstrate = renderBotRig({ baseSvg: changedSvg });
    assertEquals(
      await page.evaluate((html) => {
        const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
        const template = document.createElement("template");
        template.innerHTML = html;
        api.prepareSwap(template.content);
        const replacement = document.querySelector<HTMLElement>("#avatar-rig-east")!;
        return {
          marker: replacement.dataset.liveMarker ?? null,
          version: replacement.querySelector(".avatar-base")?.getAttribute("data-version"),
        };
      }, changedSubstrate),
      { marker: null, version: "2" },
    );
  } finally {
    await browser.close();
  }
});

Deno.test("runtime isolates incomplete rigs while advancing each reaction state", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const rigIds = ["actor", "observer", "no-layer", "no-features", "eyes-only", "mouth-only"];
    await page.setContent(
      rigIds.map((id) => renderBotRig({ id })).join("") +
        renderFacialRig({
          id: "photo",
          label: "Photo",
          reaction: null,
          precedingReaction: null,
          microReaction: null,
          personality: PERSONALITY,
          rigKind: "human-photo",
          src: "/photo.webp",
          emotion: null,
        }) + '<span class="avatar-rig"></span>',
    );
    await page.locator(".avatar-rig").evaluateAll((rigs) => {
      for (const rig of rigs) {
        const element = rig as HTMLElement;
        element.style.display = "inline-block";
        element.style.width = "24px";
        element.style.height = "24px";
      }
      document.querySelector("#avatar-rig-no-layer .avatar-expression")?.remove();
      document.querySelector("#avatar-rig-no-layer .avatar-micro-expression")?.remove();
      document.querySelector("#avatar-rig-no-features .avatar-expression")?.replaceChildren();
      document.querySelector("#avatar-rig-no-features .avatar-micro-expression")?.replaceChildren();
      for (const layer of document.querySelectorAll("#avatar-rig-eyes-only .avatar")) {
        const feature = document.createElementNS("http://www.w3.org/2000/svg", "g");
        feature.setAttribute("class", "face-eyes");
        layer.replaceChildren(feature);
      }
      for (const layer of document.querySelectorAll("#avatar-rig-mouth-only .avatar")) {
        const feature = document.createElementNS("http://www.w3.org/2000/svg", "g");
        feature.setAttribute("class", "face-mouth");
        layer.replaceChildren(feature);
      }
    });
    await loadFacialRig(page);

    const state = await page.evaluate(async (missingLiveHtml) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const rigs = [...document.querySelectorAll<HTMLElement>(".avatar-rig[id]")];
      const setReaction = (
        rig: HTMLElement,
        prefix: "reaction" | "preceding" | "micro",
        id: number,
        kind: string,
        expression: string,
      ) => {
        rig.setAttribute(`data-${prefix}-id`, String(id));
        rig.setAttribute(`data-${prefix}-kind`, kind);
        rig.setAttribute(`data-${prefix}-expression`, expression);
        rig.setAttribute(`data-${prefix}-intensity`, "3");
        rig.setAttribute(`data-${prefix}-motion`, "shake");
        rig.setAttribute(`data-${prefix}-duration-ms`, "30");
        rig.setAttribute(`data-${prefix}-confidence`, "0.8");
        rig.setAttribute(`data-${prefix}-voice-cue`, "");
      };
      for (const rig of rigs) {
        setReaction(rig, "reaction", 1, "Main", "anger");
        setReaction(rig, "micro", 1, "CardPlayedHigh", "focused");
      }
      api.sync();
      api.sync();

      const actor = document.querySelector<HTMLElement>("#avatar-rig-actor")!;
      setReaction(actor, "reaction", 2, "", "sadness");
      setReaction(actor, "preceding", 2, "", "fear");
      setReaction(actor, "micro", 2, "", "focused");
      api.sync();
      setReaction(actor, "preceding", 3, "LeadOnly", "surprise");
      api.sync();
      setReaction(actor, "reaction", 3, "MainOnly", "sadness");
      setReaction(actor, "micro", 3, "DecisionMadeMogu", "focused");
      api.sync();

      api.startSpeaking("missing-rig", "gasp", 240);
      api.startSpeaking("avatar-rig-photo", "gasp", 240);
      api.startSpeaking("avatar-rig-no-features", "gasp", 240);
      api.prepareSwap(null as unknown as ParentNode);
      const invalid = document.createElement("template");
      invalid.innerHTML = '<span class="avatar-rig"></span>' +
        missingLiveHtml;
      api.prepareSwap(invalid.content);

      const observer = document.querySelector<HTMLElement>("#avatar-rig-observer")!;
      for (
        const field of [
          "expression",
          "intensity",
          "motion",
          "duration-ms",
          "confidence",
          "voice-cue",
        ]
      ) {
        observer.removeAttribute(`data-reaction-${field}`);
      }
      observer.setAttribute("data-reaction-id", "2");
      observer.setAttribute("data-reaction-kind", "Defaults");
      observer.setAttribute("data-seat-audio-probability", "invalid");
      api.sync();

      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        actorReacting: actor.classList.contains("is-reacting"),
        actorMicro: actor.classList.contains("is-micro-reacting"),
        photoMotion: document.querySelector("#avatar-rig-photo")?.classList
          .contains("motion-shake"),
        noLayerReacting: document.querySelector("#avatar-rig-no-layer")?.classList
          .contains("is-reacting"),
        anonymousReacting: document.querySelector(".avatar-rig:not([id])")?.classList
          .contains("is-reacting"),
        observerGaze: observer.style.getPropertyValue("--idle-gaze-tx") !== "",
        observerDuration: observer.style.getPropertyValue("--reaction-duration-ms"),
      };
    }, renderBotRig({ id: "missing-live" }));
    assertEquals(state, {
      actorReacting: true,
      actorMicro: true,
      photoMotion: false,
      noLayerReacting: true,
      anonymousReacting: false,
      observerGaze: true,
      observerDuration: "2000ms",
    });
  } finally {
    await browser.close();
  }
});

Deno.test("voice cues are cancelable and audio admission stays bounded", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderBotRig());
    await page.evaluate(() => {
      type Listener = () => void;
      class FakeAudioContext {
        readonly destination = {};
        resumeCalled = false;
        sampleCalls = 0;
        state = "running";

        constructor() {
          (window as unknown as { audioContexts: FakeAudioContext[] }).audioContexts.push(this);
        }

        createMediaElementSource(): Readonly<{ connect(): void }> {
          return { connect() {} };
        }

        createAnalyser(): {
          connect(): void;
          fftSize: number;
          frequencyBinCount: number;
          getByteTimeDomainData(buffer: Uint8Array): void;
          smoothingTimeConstant: number;
        } {
          return {
            connect() {},
            fftSize: 0,
            frequencyBinCount: 8,
            getByteTimeDomainData: (buffer) => {
              this.sampleCalls += 1;
              buffer.fill(144);
            },
            smoothingTimeConstant: 0,
          };
        }

        resume(): Promise<void> {
          this.resumeCalled = true;
          this.state = "running";
          return Promise.resolve();
        }
      }

      class FakeAudio {
        ended = false;
        loaded = false;
        played = false;
        preload = "";
        src: string;
        volume = 1;
        readonly listeners = new Map<string, Listener[]>();

        constructor(src = "") {
          this.src = src;
          (window as unknown as { audioInstances: FakeAudio[] }).audioInstances.push(this);
        }

        addEventListener(type: string, listener: Listener): void {
          const listeners = this.listeners.get(type) ?? [];
          listeners.push(listener);
          this.listeners.set(type, listeners);
        }

        play(): Promise<void> | undefined {
          this.played = true;
          if (this.src === "/challenge.mp3") return undefined;
          return Promise.resolve();
        }

        pause(): void {}
        load(): void {
          this.loaded = true;
        }

        finish(): void {
          this.ended = true;
          for (const listener of this.listeners.get("ended") ?? []) listener();
        }

        fail(): void {
          for (const listener of this.listeners.get("error") ?? []) listener();
        }
      }

      const target = window as unknown as {
        Audio: typeof FakeAudio;
        AudioContext: typeof FakeAudioContext;
        audioContexts: FakeAudioContext[];
        audioEnabled: boolean;
        audioInstances: FakeAudio[];
        now: number;
      };
      target.audioContexts = [];
      target.audioEnabled = true;
      target.audioInstances = [];
      target.now = 1_000;
      target.Audio = FakeAudio;
      target.AudioContext = FakeAudioContext;
      Date.now = () => target.now;
      Math.random = () => 0;
    });
    await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });

    const result = await page.evaluate(async () => {
      type FakeAudio = Readonly<{
        fail(): void;
        loaded: boolean;
        played: boolean;
        preload: string;
        src: string;
        finish(): void;
      }>;
      type VoiceDetail = Readonly<{ cue: string; src: string; seatId: string }>;
      const target = window as unknown as {
        FacialRig: FacialRigApi;
        audioContexts: Array<{
          resumeCalled: boolean;
          sampleCalls: number;
          state: string;
        }>;
        audioEnabled: boolean;
        audioInstances: FakeAudio[];
        now: number;
      };
      const rig = document.querySelector("#avatar-rig-east")!;
      const events: VoiceDetail[] = [];
      const cancelFirst = (event: Event) => {
        events.push((event as CustomEvent<VoiceDetail>).detail);
        event.preventDefault();
        rig.removeEventListener("facial-rig:voice-cue", cancelFirst);
      };
      rig.addEventListener("facial-rig:voice-cue", cancelFirst);
      rig.addEventListener("facial-rig:voice-cue", (event) => {
        if (!event.defaultPrevented) events.push((event as CustomEvent<VoiceDetail>).detail);
      });

      target.FacialRig.init({
        audioAssets: {
          gasp: "/gasp.mp3",
          laugh: "/laugh.mp3",
          laughClimactic: "/laugh-big.mp3",
          sigh: "/sigh.mp3",
          groan: "/groan.mp3",
          challenge: "/challenge.mp3",
        },
        silenceSrc: "/silence.mp3",
        isAudioEnabled: () => target.audioEnabled,
      });
      const request = (cue: string, seatId: string) => ({
        cue,
        intensity: 1,
        rigKind: "bot",
        seatId,
        rigId: "avatar-rig-east",
        seatAudioProbability: 1,
      });
      target.audioEnabled = false;
      target.FacialRig.play(request("gasp", "disabled"));
      target.audioEnabled = true;
      target.FacialRig.play(request("", "empty-cue"));
      target.FacialRig.play({ ...request("gasp", "unknown"), rigKind: "unknown" });
      target.FacialRig.play({ ...request("gasp", "photo"), rigKind: "human-photo" });
      target.FacialRig.play(request("missing", "missing-asset"));
      target.FacialRig.play(request("laugh", "east"));
      target.FacialRig.play(request("gasp", "west"));
      target.FacialRig.play(request("challenge", "north"));
      target.FacialRig.play(request("sigh", "west"));
      target.FacialRig.play(request("groan", "south"));
      await Promise.resolve();
      await new Promise(requestAnimationFrame);

      const admitted = target.audioInstances.length;
      const speaking = rig.classList.contains("is-speaking");
      for (const audio of target.audioInstances) audio.finish();

      target.FacialRig.play(request("groan", "north"));
      target.FacialRig.play(request("gasp", "east"));
      target.FacialRig.play({ ...request("laugh", "south"), intensity: 3 });
      await Promise.resolve();
      const afterCooldownChecks = target.audioInstances.length;
      const climacticSource = target.audioInstances.at(-1)?.src;
      target.audioInstances.at(-1)?.finish();

      Math.random = () => 0.999;
      target.FacialRig.play(request("sigh", "random-loss"));
      await Promise.resolve();
      const afterFailedRoll = target.audioInstances.length;
      const voiceInstances = target.audioInstances.length;

      Math.random = () => 0;
      target.now = 4_000;
      target.FacialRig.play(request("gasp", "cooldown-expired"));
      await Promise.resolve();
      target.audioInstances.at(-1)?.finish();
      target.now = 7_000;
      target.FacialRig.play({
        cue: "groan",
        intensity: 0,
        rigKind: "bot",
        rigId: "",
      });
      await Promise.resolve();
      target.audioInstances.at(-1)?.finish();
      const decisionMatrixInstances = target.audioInstances.length;

      target.now = 10_000;
      target.FacialRig.play({ ...request("gasp", "failed"), rigId: "" });
      target.audioInstances.at(-1)?.fail();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const samplesAfterFailure = target.audioContexts[0]?.sampleCalls ?? 0;
      await new Promise(requestAnimationFrame);
      const analyserStoppedAfterFailure =
        (target.audioContexts[0]?.sampleCalls ?? 0) === samplesAfterFailure;

      if (target.audioContexts[0]) target.audioContexts[0].state = "suspended";
      document.body.click();
      await Promise.resolve();
      return {
        admitted,
        afterCooldownChecks,
        afterFailedRoll,
        cues: events.map((event) => event.cue),
        canceledCreatedAudio: events[0]?.src === "/laugh.mp3" && admitted === 2,
        climacticSource,
        preloaded: target.audioInstances.filter((audio) =>
          audio.preload === "auto" && audio.loaded
        ).length,
        silencePlayed: target.audioInstances.some((audio) =>
          audio.src === "/silence.mp3" && audio.played
        ),
        speaking,
        speakingAfterFinish: rig.classList.contains("is-speaking"),
        analyserSampled: (target.audioContexts[0]?.sampleCalls ?? 0) > 0,
        analyserStoppedAfterFailure,
        contextResumed: target.audioContexts[0]?.resumeCalled ?? false,
        decisionMatrixInstances,
        voiceInstances,
      };
    });

    assertEquals(result, {
      admitted: 2,
      afterCooldownChecks: 3,
      afterFailedRoll: 3,
      cues: ["laugh", "gasp", "challenge", "laugh", "gasp"],
      canceledCreatedAudio: true,
      climacticSource: "/laugh-big.mp3",
      preloaded: 7,
      silencePlayed: true,
      speaking: true,
      speakingAfterFinish: false,
      analyserSampled: true,
      analyserStoppedAfterFailure: true,
      contextResumed: true,
      decisionMatrixInstances: 5,
      voiceInstances: 3,
    });
  } finally {
    await browser.close();
  }
});

Deno.test("voice admission preserves legacy probabilities and seat and cue gates", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderBotRig({ id: "confidence" }));
    await page.evaluate(() => {
      type Listener = () => void;
      class PolicyAudio {
        ended = false;
        preload = "";
        src: string;
        volume = 1;
        readonly listeners = new Map<string, Listener[]>();

        constructor(src = "") {
          this.src = src;
          (window as unknown as { policyAudio: PolicyAudio[] }).policyAudio.push(this);
        }

        addEventListener(type: string, listener: Listener): void {
          const listeners = this.listeners.get(type) ?? [];
          listeners.push(listener);
          this.listeners.set(type, listeners);
        }

        load(): void {}
        pause(): void {}
        play(): undefined {
          return undefined;
        }

        finish(): void {
          if (this.ended) return;
          this.ended = true;
          for (const listener of this.listeners.get("ended") ?? []) listener();
        }
      }

      const target = window as unknown as {
        Audio: typeof PolicyAudio;
        now: number;
        policyAudio: PolicyAudio[];
        randomSample: number;
      };
      target.now = 1_000;
      target.policyAudio = [];
      target.randomSample = 0;
      target.Audio = PolicyAudio;
      Date.now = () => target.now;
      Math.random = () => target.randomSample;
    });
    await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });

    const result = await page.evaluate(() => {
      type PolicyAudio = Readonly<{ finish(): void }>;
      const target = window as unknown as {
        FacialRig: FacialRigApi;
        now: number;
        policyAudio: PolicyAudio[];
        randomSample: number;
      };
      target.FacialRig.init({
        audioAssets: {
          gasp: "/gasp.mp3",
          laugh: "/laugh.mp3",
          laughClimactic: "/laugh-big.mp3",
          sigh: "/sigh.mp3",
          groan: "/groan.mp3",
        },
        isAudioEnabled: () => true,
      });
      target.FacialRig.sync();
      const play = (
        cue: string,
        intensity: number,
        rigKind: string,
        seatId: string,
        rigId = "",
      ) => {
        target.FacialRig.play({
          cue,
          intensity,
          rigKind,
          rigId,
          seatId,
          seatAudioProbability: 1,
        });
      };
      const finishAll = () => {
        for (const audio of target.policyAudio) audio.finish();
      };

      target.randomSample = 0.1;
      play("gasp", 1, "human-generated", "human");
      const lowHumanCreated = target.policyAudio.length;
      finishAll();

      target.randomSample = 0;
      target.now = 6_000;
      const activeStart = target.policyAudio.length;
      play("laugh", 3, "bot", "active-seat");
      target.now = 8_501;
      play("gasp", 1, "bot", "active-seat");
      const sameSeatWhileActive = target.policyAudio.length - activeStart;
      finishAll();

      target.now = 10_000;
      const gapStart = target.policyAudio.length;
      play("gasp", 1, "bot", "gap-seat");
      target.policyAudio.at(-1)?.finish();
      target.now = 10_700;
      play("laugh", 1, "bot", "gap-seat");
      const afterLegacySeatGap = target.policyAudio.length - gapStart;
      finishAll();

      target.now = 20_000;
      const cueStart = target.policyAudio.length;
      play("sigh", 1, "bot", "west");
      target.policyAudio.at(-1)?.finish();
      target.now = 20_100;
      play("sigh", 1, "bot", "north");
      const sameCueAcrossSeats = target.policyAudio.length - cueStart;
      finishAll();

      target.now = 30_000;
      const confidenceStart = target.policyAudio.length;
      const rig = document.querySelector<HTMLElement>("#avatar-rig-confidence")!;
      rig.dataset.reactionKind = "ConfidenceProbe";
      rig.dataset.reactionExpression = "happiness";
      rig.dataset.reactionIntensity = "1";
      rig.dataset.reactionMotion = "pop";
      rig.dataset.reactionDurationMs = "77";
      rig.dataset.reactionConfidence = "0";
      rig.dataset.reactionVoiceCue = "groan";
      rig.dataset.reactionId = "1";
      target.FacialRig.sync();
      const confidenceZeroCreated = target.policyAudio.length - confidenceStart;

      return {
        afterLegacySeatGap,
        confidenceZeroCreated,
        lowHumanCreated,
        sameCueAcrossSeats,
        sameSeatWhileActive,
      };
    });

    assertEquals(result, {
      afterLegacySeatGap: 2,
      confidenceZeroCreated: 0,
      lowHumanCreated: 0,
      sameCueAcrossSeats: 1,
      sameSeatWhileActive: 1,
    });
  } finally {
    await browser.close();
  }
});

Deno.test("voice timing follows cue duration and resolved playback", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderBotRig({ id: "playback" }));
    await page.evaluate(() => {
      type Listener = () => void;
      class TimingAudioContext {
        readonly destination = {};
        state = "running";

        constructor() {
          (window as unknown as { timingContextCount: number }).timingContextCount += 1;
        }

        createMediaElementSource(): Readonly<{ connect(): void }> {
          return { connect() {} };
        }

        createAnalyser(): {
          connect(): void;
          fftSize: number;
          frequencyBinCount: number;
          getByteTimeDomainData(buffer: Uint8Array): void;
          smoothingTimeConstant: number;
        } {
          return {
            connect() {},
            fftSize: 0,
            frequencyBinCount: 8,
            getByteTimeDomainData: (buffer) => buffer.fill(128),
            smoothingTimeConstant: 0,
          };
        }

        resume(): Promise<void> {
          return Promise.resolve();
        }
      }

      class TimingAudio {
        ended = false;
        preload = "";
        resolvePlay: (() => void) | null = null;
        src: string;
        volume = 1;
        readonly listeners = new Map<string, Listener[]>();

        constructor(src = "") {
          this.src = src;
          (window as unknown as { timingAudio: TimingAudio[] }).timingAudio.push(this);
        }

        addEventListener(type: string, listener: Listener): void {
          const listeners = this.listeners.get(type) ?? [];
          listeners.push(listener);
          this.listeners.set(type, listeners);
        }

        load(): void {}
        pause(): void {}
        play(): Promise<void> | undefined {
          const target = window as unknown as { deferNextPlay: boolean };
          if (!target.deferNextPlay) return undefined;
          target.deferNextPlay = false;
          return new Promise((resolve) => {
            this.resolvePlay = resolve;
          });
        }

        finish(): void {
          if (this.ended) return;
          this.ended = true;
          for (const listener of this.listeners.get("ended") ?? []) listener();
        }
      }

      const target = window as unknown as {
        Audio: typeof TimingAudio;
        AudioContext: typeof TimingAudioContext;
        deferNextPlay: boolean;
        now: number;
        timingAudio: TimingAudio[];
        timingContextCount: number;
      };
      target.deferNextPlay = false;
      target.now = 1_000;
      target.timingAudio = [];
      target.timingContextCount = 0;
      target.Audio = TimingAudio;
      target.AudioContext = TimingAudioContext;
      Date.now = () => target.now;
      Math.random = () => 0;
    });
    await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });

    const result = await page.evaluate(async () => {
      type TimingAudio = Readonly<{
        finish(): void;
        resolvePlay: (() => void) | null;
      }>;
      type VoiceDetail = Readonly<{ cue: string; durationMs: number; intensity: number }>;
      const target = window as unknown as {
        FacialRig: FacialRigApi;
        deferNextPlay: boolean;
        now: number;
        timingAudio: TimingAudio[];
        timingContextCount: number;
      };
      const rig = document.querySelector<HTMLElement>("#avatar-rig-playback")!;
      const events: VoiceDetail[] = [];
      rig.addEventListener("facial-rig:voice-cue", (event) => {
        events.push((event as CustomEvent<VoiceDetail>).detail);
      });
      target.FacialRig.init({
        audioAssets: {
          gasp: "/gasp.mp3",
          laugh: "/laugh.mp3",
          laughClimactic: "/laugh-big.mp3",
          sigh: "/sigh.mp3",
          groan: "/groan.mp3",
          challenge: "/challenge.mp3",
          custom: "/custom.mp3",
        },
        isAudioEnabled: () => true,
      });
      target.FacialRig.sync();
      const play = (cue: string, intensity: number, seatId: string) => {
        target.FacialRig.play({
          cue,
          intensity,
          rigKind: "bot",
          rigId: "avatar-rig-playback",
          seatId,
          seatAudioProbability: 1,
        });
      };

      target.deferNextPlay = true;
      play("gasp", 1, "pending");
      const beforeResolve = {
        analyserContexts: target.timingContextCount,
        speaking: rig.classList.contains("is-speaking"),
      };
      target.timingAudio.at(-1)?.resolvePlay?.();
      await Promise.resolve();
      await Promise.resolve();
      const afterResolve = {
        analyserContexts: target.timingContextCount,
        speaking: rig.classList.contains("is-speaking"),
      };
      target.timingAudio.at(-1)?.finish();

      const cases = [
        ["laugh", 1, "laugh"],
        ["sigh", 1, "sigh"],
        ["groan", 1, "groan"],
        ["challenge", 1, "challenge"],
        ["laugh", 3, "climactic"],
        ["custom", 2, "fallback"],
      ] as const;
      for (const [cue, intensity, seatId] of cases) {
        target.now += 3_000;
        play(cue, intensity, seatId);
        target.timingAudio.at(-1)?.finish();
      }

      target.now += 3_000;
      rig.dataset.reactionKind = "DurationProbe";
      rig.dataset.reactionExpression = "happiness";
      rig.dataset.reactionIntensity = "1";
      rig.dataset.reactionMotion = "pop";
      rig.dataset.reactionDurationMs = "77";
      rig.dataset.reactionConfidence = "1";
      rig.dataset.reactionVoiceCue = "gasp";
      rig.dataset.reactionId = "1";
      target.FacialRig.sync();
      target.timingAudio.at(-1)?.finish();

      return {
        afterResolve,
        beforeResolve,
        durations: events.map(({ cue, durationMs, intensity }) => ({
          cue,
          durationMs,
          intensity,
        })),
      };
    });

    assertEquals(result, {
      afterResolve: { analyserContexts: 1, speaking: true },
      beforeResolve: { analyserContexts: 0, speaking: false },
      durations: [
        { cue: "gasp", durationMs: 1_800, intensity: 1 },
        { cue: "laugh", durationMs: 945, intensity: 1 },
        { cue: "sigh", durationMs: 1_800, intensity: 1 },
        { cue: "groan", durationMs: 1_800, intensity: 1 },
        { cue: "challenge", durationMs: 1_800, intensity: 1 },
        { cue: "laugh", durationMs: 1_800, intensity: 3 },
        { cue: "custom", durationMs: 2_400, intensity: 2 },
        { cue: "gasp", durationMs: 1_800, intensity: 1 },
      ],
    });
  } finally {
    await browser.close();
  }
});

Deno.test("stalled audio releases channel capacity at the legacy timeout bound", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent("");
    await page.evaluate(() => {
      type TimerEntry = { callback: () => void; cleared: boolean; delayMs: number };
      class StalledAudio {
        ended = false;
        paused = false;
        preload = "";
        src: string;
        volume = 1;

        constructor(src = "") {
          this.src = src;
          (window as unknown as { stalledAudio: StalledAudio[] }).stalledAudio.push(this);
        }

        addEventListener(): void {}
        load(): void {}
        pause(): void {
          this.paused = true;
        }
        play(): Promise<void> {
          return new Promise(() => undefined);
        }
      }

      const target = window as unknown as {
        Audio: typeof StalledAudio;
        now: number;
        stalledAudio: StalledAudio[];
        timers: TimerEntry[];
      };
      target.now = 1_000;
      target.stalledAudio = [];
      target.timers = [];
      target.Audio = StalledAudio;
      Date.now = () => target.now;
      Math.random = () => 0;
      globalThis.setTimeout = ((callback: TimerHandler, delayMs = 0) => {
        if (typeof callback !== "function") throw new Error("unexpected string timer");
        target.timers.push({ callback: callback as () => void, cleared: false, delayMs });
        return target.timers.length;
      }) as typeof window.setTimeout;
      globalThis.clearTimeout = ((timerId: number | undefined) => {
        const timer = timerId === undefined ? undefined : target.timers[timerId - 1];
        if (timer !== undefined) timer.cleared = true;
      }) as typeof window.clearTimeout;
    });
    await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });

    const result = await page.evaluate(() => {
      type TimerEntry = { callback: () => void; cleared: boolean; delayMs: number };
      type StalledAudio = Readonly<{ paused: boolean }>;
      const target = window as unknown as {
        FacialRig: FacialRigApi;
        now: number;
        stalledAudio: StalledAudio[];
        timers: TimerEntry[];
      };
      target.FacialRig.init({
        audioAssets: {
          challenge: "/challenge.mp3",
          gasp: "/gasp.mp3",
          groan: "/groan.mp3",
        },
        isAudioEnabled: () => true,
      });
      const request = (cue: string, seatId: string) => ({
        cue,
        intensity: 1,
        rigKind: "bot",
        rigId: "",
        seatId,
        seatAudioProbability: 1,
      });
      target.FacialRig.play(request("gasp", "east"));
      target.FacialRig.play(request("groan", "west"));
      target.FacialRig.play(request("challenge", "blocked"));
      const createdBeforeTimeout = target.stalledAudio.length;
      const watchdogs = target.timers.filter((timer) => timer.delayMs === 2_000);
      for (const watchdog of watchdogs) watchdog.callback();
      target.now = 4_000;
      target.FacialRig.play(request("gasp", "released"));
      return {
        createdBeforeTimeout,
        createdAfterTimeout: target.stalledAudio.length,
        paused: target.stalledAudio.map((audio) => audio.paused),
        watchdogDelays: watchdogs.map((timer) => timer.delayMs),
      };
    });

    assertEquals(result, {
      createdBeforeTimeout: 2,
      createdAfterTimeout: 3,
      paused: [true, true, false],
      watchdogDelays: [2_000, 2_000],
    });
  } finally {
    await browser.close();
  }
});

Deno.test("speech frames follow replacement mouth layers during a same-signature swap", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderBotRig({ id: "speech-swap" }));
    await loadFacialRig(page);

    const result = await page.evaluate(async (html) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      api.startSpeaking("avatar-rig-speech-swap", "challenge", 1_000);
      await new Promise(requestAnimationFrame);
      const template = document.createElement("template");
      template.innerHTML = html;
      const incoming = template.content.querySelector<SVGElement>(".avatar-expression");
      if (incoming !== null) incoming.dataset.layerMarker = "incoming";
      api.prepareSwap(template.content);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const live = document.querySelector<HTMLElement>("#avatar-rig-speech-swap")!;
      const expression = live.querySelector<SVGElement>(".avatar-expression")!;
      return {
        layerMarker: expression.dataset.layerMarker,
        mouthTransform: expression.querySelector<SVGElement>(".face-mouth")?.style.transform,
      };
    }, renderBotRig({ id: "speech-swap" }));

    assertEquals(result.layerMarker, "incoming");
    assertEquals(result.mouthTransform !== "", true);
  } finally {
    await browser.close();
  }
});

Deno.test("speaking fades cleanly and reduced motion suppresses runtime feature writes", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const speakingRigs = [
      ["east", "gasp"],
      ["sigh", "sigh"],
      ["groan", "groan"],
      ["challenge", "challenge"],
      ["laugh", "laugh"],
    ] as const;
    await page.setContent(speakingRigs.map(([id]) => renderBotRig({ id })).join(""));
    await loadFacialRig(page);

    await page.evaluate((rigs) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      for (const [id, cue] of rigs) {
        document.querySelector(`#avatar-rig-${id}`)?.classList.add("is-speaking");
        api.startSpeaking(`avatar-rig-${id}`, cue, 240);
      }
    }, speakingRigs);
    await page.waitForTimeout(140);
    assertEquals(
      await page.locator(
        ".avatar-rig .avatar-base .face-mouth, " +
          ".avatar-rig .avatar-expression .face-mouth",
      ).evaluateAll((mouths) =>
        mouths.every((mouth) => (mouth as SVGElement).style.transform !== "")
      ),
      true,
    );

    await page.evaluate((rigs) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      for (const [id] of rigs) {
        document.querySelector(`#avatar-rig-${id}`)?.classList.remove("is-speaking");
        api.stopSpeaking(`avatar-rig-${id}`);
      }
    }, speakingRigs);
    await page.waitForTimeout(220);
    assertEquals(
      await page.locator(
        ".avatar-rig .avatar-base .face-mouth, " +
          ".avatar-rig .avatar-expression .face-mouth",
      ).evaluateAll((mouths) =>
        mouths.every((mouth) => (mouth as SVGElement).style.transform === "")
      ),
      true,
    );

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedIncoming = renderBotRig({
      reaction: reaction(1, { motion: "shake", durationMs: 80 }),
    });
    const reducedState = await page.evaluate(async (html) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const template = document.createElement("template");
      template.innerHTML = html;
      api.prepareSwap(template.content);
      api.sync();
      const rig = document.querySelector<HTMLElement>("#avatar-rig-east")!;
      rig.classList.add("is-speaking");
      api.startSpeaking("avatar-rig-east", "challenge", 240);
      const immediate = {
        reacting: rig.classList.contains("is-reacting"),
        motion: rig.classList.contains("motion-shake"),
        featureTransforms: [...rig.querySelectorAll<SVGElement>(".face-mouth")]
          .map((mouth) => mouth.style.transform),
      };
      await new Promise((resolve) => setTimeout(resolve, 260));
      return {
        ...immediate,
        speakingAfterDuration: rig.classList.contains("is-speaking"),
      };
    }, reducedIncoming);
    assertEquals(reducedState, {
      reacting: true,
      motion: false,
      featureTransforms: ["", "", ""],
      speakingAfterDuration: false,
    });
  } finally {
    await browser.close();
  }
});

Deno.test("runtime schedules autonomous work only for connected animated rigs", async () => {
  const browser = await launchBrowser();
  try {
    const observeScheduling = async (html: string, detach = false) => {
      const page = await browser.newPage();
      await page.setContent(html);
      await page.evaluate(() => {
        const target = window as unknown as {
          frameRequests: number;
          timerCallbacks: Array<() => void>;
        };
        target.frameRequests = 0;
        target.timerCallbacks = [];
        globalThis.requestAnimationFrame = () => ++target.frameRequests;
        globalThis.cancelAnimationFrame = () => undefined;
        globalThis.setTimeout = ((callback: TimerHandler) => {
          if (typeof callback === "function") {
            target.timerCallbacks.push(callback as () => void);
          }
          return target.timerCallbacks.length;
        }) as typeof window.setTimeout;
        globalThis.clearTimeout = () => undefined;
      });
      await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });
      return await page.evaluate((removeRig) => {
        const target = window as unknown as {
          frameRequests: number;
          timerCallbacks: Array<() => void>;
        };
        const scheduledAtStart = {
          frames: target.frameRequests,
          timers: target.timerCallbacks.length,
        };
        if (removeRig) {
          document.querySelector(".avatar-rig")?.remove();
          target.timerCallbacks[0]?.();
        }
        return {
          scheduledAtStart,
          timersAfterDetach: target.timerCallbacks.length,
        };
      }, detach);
    };

    const bot = await observeScheduling(renderBotRig(), true);
    const photo = await observeScheduling(
      renderBotRig({ id: "photo" }).replace('data-rig-kind="bot"', 'data-rig-kind="human-photo"'),
    );
    const empty = await observeScheduling("");

    assertEquals(bot, {
      scheduledAtStart: { frames: 1, timers: 1 },
      timersAfterDetach: 1,
    });
    assertEquals(photo.scheduledAtStart, { frames: 0, timers: 0 });
    assertEquals(empty.scheduledAtStart, { frames: 0, timers: 0 });
  } finally {
    await browser.close();
  }
});

Deno.test("standalone CSS preserves consumer tokens and supplies defaults", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>.avatar-rig.probe { color: var(--avatar-primary-fixed); }</style>
      <span id="fallback" class="avatar-rig probe"></span>
      <span id="consumer" class="avatar-rig probe" style="--primary-fixed: #010203"></span>
      <span id="override" class="avatar-rig probe" style="--avatar-primary-fixed: #040506"></span>
    `);
    await page.addStyleTag({ path: localPath(AVATAR_ASSETS.facialRigStyles.url) });
    const colors = await page.locator(".probe").evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).color)
    );
    assertEquals(colors, ["rgb(245, 224, 189)", "rgb(1, 2, 3)", "rgb(4, 5, 6)"]);
  } finally {
    await browser.close();
  }
});

Deno.test("iPhone idle mode performs no style-attribute churn", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await page.clock.install();
    await page.setContent(`
      <span id="avatar-rig-ios" class="avatar-rig" data-rig-kind="bot"
        data-seat-audio-probability="0"
        data-reaction-kind="" data-reaction-expression="" data-reaction-intensity="0"
        data-reaction-motion="" data-reaction-duration-ms="0" data-reaction-confidence="1"
        data-reaction-voice-cue="" data-reaction-id="0"
        data-preceding-kind="" data-preceding-expression="" data-preceding-intensity="0"
        data-preceding-motion="" data-preceding-duration-ms="0" data-preceding-confidence="1"
        data-preceding-voice-cue="" data-preceding-id="0"
        data-micro-kind="" data-micro-expression="" data-micro-intensity="0"
        data-micro-motion="" data-micro-duration-ms="0" data-micro-confidence="1"
        data-micro-voice-cue="" data-micro-id="0">
        <svg class="avatar-base">
          <g class="face-eyes"></g><g class="face-mouth"></g><g class="face-brows"></g>
        </svg>
        <svg class="avatar-expression">
          <g class="face-eyes"></g><g class="face-mouth"></g><g class="face-brows"></g>
        </svg>
      </span>
    `);
    await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });
    await page.evaluate(() => {
      const api = (window as unknown as { FacialRig: { init(): void; sync(): void } }).FacialRig;
      api.init();
      api.sync();

      const rig = document.querySelector("#avatar-rig-ios")!;
      const observer = new MutationObserver((records) => {
        const target = window as unknown as { iosStyleMutationCount: number };
        target.iosStyleMutationCount += records.filter((record) =>
          record.attributeName === "style"
        ).length;
      });
      const target = window as unknown as {
        iosStyleMutationCount: number;
        iosStyleObserver: MutationObserver;
      };
      target.iosStyleMutationCount = 0;
      target.iosStyleObserver = observer;
      observer.observe(rig, { attributes: true, attributeFilter: ["style"], subtree: true });
    });
    await page.clock.runFor(5_000);
    const mutationCount = await page.evaluate(() => {
      const target = window as unknown as {
        iosStyleMutationCount: number;
        iosStyleObserver: MutationObserver;
      };
      target.iosStyleObserver.disconnect();
      return target.iosStyleMutationCount;
    });
    assertEquals(mutationCount, 0);
  } finally {
    await browser.close();
  }
});

Deno.test("computed style oracle pins motion, crossfade, and reduced-motion behavior", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(`
      <span id="rig" class="avatar-rig is-reacting motion-pop" data-rig-kind="bot"
        data-reaction-expression="happiness">
        <svg class="avatar avatar-base"><g class="face-eyes-plane"></g></svg>
        <svg class="avatar avatar-expression"></svg>
        <svg class="avatar avatar-micro-expression"></svg>
      </span>
    `);
    await page.addStyleTag({ path: localPath(AVATAR_ASSETS.facialRigStyles.url) });
    const active = await page.locator("#rig").evaluate((rig) => {
      const style = getComputedStyle(rig);
      const base = getComputedStyle(rig.querySelector(".avatar-base")!);
      const expression = getComputedStyle(rig.querySelector(".avatar-expression")!);
      return {
        display: style.display,
        position: style.position,
        animationName: style.animationName,
        baseOpacity: base.opacity,
        expressionOpacity: expression.opacity,
      };
    });
    assertEquals(active, {
      display: "inline-grid",
      position: "relative",
      animationName: "bot-avatar-react-pop",
      baseOpacity: "0",
      expressionOpacity: "1",
    });

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await page.locator("#rig").evaluate((rig) => ({
      animationName: getComputedStyle(rig).animationName,
      planeTransform: getComputedStyle(rig.querySelector(".face-eyes-plane")!).transform,
      expressionAnimationName: getComputedStyle(
        rig.querySelector(".avatar-expression")!,
      ).animationName,
    }));
    assertEquals(reduced, {
      animationName: "none",
      planeTransform: "none",
      expressionAnimationName: "none",
    });
  } finally {
    await browser.close();
  }
});

// The tear-line has no runtime writer: nothing in facial-rig.js touches it.
// Its whole reveal lives in the stylesheet, so pin both the paint and the
// gate here - a tear-line that computes to zero opacity everywhere is a
// silently dead feature the SSR and script contracts cannot detect.
Deno.test("tear-line paints only while a sad reaction is active", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(`
      <span id="rig" class="avatar-rig" data-rig-kind="bot"
        data-reaction-expression="" data-reaction-bot-emotion="">
        <svg class="avatar avatar-base">
          <g class="face-tearline-plane">
            <path class="face-tearline" d="M32 52 Q37 54 42 52 Q37 55 32 52 Z" />
          </g>
        </svg>
      </span>
    `);
    await page.addStyleTag({ path: localPath(AVATAR_ASSETS.facialRigStyles.url) });
    // Sample the reveal gate, not the 280ms fade that carries it, so the
    // assertions never race the transition.
    await page.addStyleTag({ content: ".face-tearline-plane { transition: none !important; }" });
    const read = (expression: string, botEmotion: string, reacting: boolean) =>
      page.locator("#rig").evaluate(
        (rig, state: { expression: string; botEmotion: string; reacting: boolean }) => {
          rig.setAttribute("data-reaction-expression", state.expression);
          rig.setAttribute("data-reaction-bot-emotion", state.botEmotion);
          rig.classList.toggle("is-reacting", state.reacting);
          return {
            planeOpacity: getComputedStyle(rig.querySelector(".face-tearline-plane")!).opacity,
            fillOpacity: getComputedStyle(rig.querySelector(".face-tearline")!).fillOpacity,
          };
        },
        { expression, botEmotion, reacting },
      );

    // The paint must be non-zero on its own, or the reveal gate reveals nothing.
    assertEquals(await read("sadness", "", true), { planeOpacity: "1", fillOpacity: "0.06" });
    assertEquals(await read("", "sad", true), { planeOpacity: "1", fillOpacity: "0.06" });
    assertEquals(await read("happiness", "", true), { planeOpacity: "0", fillOpacity: "0.06" });
    assertEquals(await read("sadness", "", false), { planeOpacity: "0", fillOpacity: "0.06" });
  } finally {
    await browser.close();
  }
});

if (COVERAGE_ENABLED) {
  Deno.test("browser runtime meets precise coverage budgets", () => {
    const report = runtimeCoverageReport(
      coverageEntries,
      localPath(AVATAR_ASSETS.facialRigScript.url),
    );
    console.log(JSON.stringify(report));
    assertEquals(report.lines.percent >= 80, true, JSON.stringify(report));
    assertEquals(report.blocks.percent >= 70, true, JSON.stringify(report));
    assertEquals(report.functions.percent >= 80, true, JSON.stringify(report));
  });
}

type CoverageMetric = Readonly<{ hit: number; total: number; percent: number }>;
type CoverageReport = Readonly<{
  entries: number;
  lines: CoverageMetric;
  blocks: CoverageMetric;
  functions: CoverageMetric;
}>;

function runtimeCoverageReport(
  entries: ReadonlyArray<CoverageEntry>,
  scriptPath: string,
): CoverageReport {
  const runtimeEntries = entries.filter((entry) => entry.url === scriptPath);
  const source = runtimeEntries[0]?.source;
  if (source === undefined) throw new Error(`no runtime coverage for ${scriptPath}`);
  const hitCharacters = new Array<boolean>(source.length).fill(false);
  const blocks = new Set<string>();
  const hitBlocks = new Set<string>();
  const functions = new Set<string>();
  const hitFunctions = new Set<string>();

  for (const entry of runtimeEntries) {
    const entryHits = new Array<boolean>(source.length).fill(false);
    for (const fn of entry.functions ?? []) {
      const outer = fn.ranges[0];
      if (outer === undefined) continue;
      const functionKey = `${fn.functionName}:${outer.startOffset}:${outer.endOffset}`;
      functions.add(functionKey);
      if (outer.count > 0) hitFunctions.add(functionKey);
      for (const range of fn.ranges.slice(1)) {
        const blockKey = `${range.startOffset}:${range.endOffset}`;
        blocks.add(blockKey);
        if (range.count > 0) hitBlocks.add(blockKey);
      }
      const widestFirst = [...fn.ranges].sort(
        (a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset),
      );
      for (const range of widestFirst) {
        entryHits.fill(range.count > 0, range.startOffset, range.endOffset);
      }
    }
    for (let index = 0; index < entryHits.length; index += 1) {
      if (entryHits[index]) hitCharacters[index] = true;
    }
  }

  let cursor = 0;
  let executableLines = 0;
  let hitLines = 0;
  for (const line of source.split("\n")) {
    const executable = line.trim() !== "" && !line.trimStart().startsWith("//");
    if (executable) {
      executableLines += 1;
      if (hitCharacters.slice(cursor, cursor + line.length).some(Boolean)) hitLines += 1;
    }
    cursor += line.length + 1;
  }
  return {
    entries: runtimeEntries.length,
    lines: coverageMetric(hitLines, executableLines),
    blocks: coverageMetric(hitBlocks.size, blocks.size),
    functions: coverageMetric(hitFunctions.size, functions.size),
  };
}

function coverageMetric(hit: number, total: number): CoverageMetric {
  return { hit, total, percent: Number((100 * hit / total).toFixed(1)) };
}
