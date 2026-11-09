import { assertEquals } from "jsr:@std/assert@1.0.14";
import type {
  CharacterAudioProfile,
  CharacterAudioProfileCatalog,
  FacialReaction,
  FacialRigApi,
  FacialRigSemanticAudioDetail,
  RigControlBank,
} from "@srdjan/avatar";
import {
  CHARACTER_AUDIO_PROFILE_SLOTS,
  createAvatarGenerator,
  RIG_CONTROL_PRESETS,
} from "@srdjan/avatar";
import { AVATAR_ASSETS } from "@srdjan/avatar/assets";
import { createRigControlBank, renderFacialRig } from "@srdjan/avatar/server";
import { type Browser, chromium, type Page } from "npm:playwright@1.60.0";
import { fileURLToPath } from "node:url";

const FACE_SVG = '<svg viewBox="0 0 112 112">' +
  '<g class="face-eyes"></g><g class="face-mouth"></g>' +
  '<g class="face-brows"></g><g class="face-nose"></g></svg>';

const PERSONALITY = {
  amplitudeScale: 1,
  durationScale: 1,
  audioProbability: 1,
} as const;

function localPath(url: URL): string {
  return fileURLToPath(url);
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
  overrides: Readonly<Record<string, unknown>> = {},
): FacialReaction {
  const expressionToState = {
    neutral: "neutral",
    focused: "focused",
    happiness: "smile",
    sadness: "sad",
    anger: "mad",
    fear: "worry",
    surprise: "surprised",
  } as const;
  const expression = overrides.expression;
  const state = typeof overrides.state === "string"
    ? overrides.state as FacialReaction["state"]
    : typeof expression === "string" && Object.hasOwn(expressionToState, expression)
    ? expressionToState[expression as keyof typeof expressionToState]
    : "smile";
  return {
    identity: typeof overrides.identity === "string" ? overrides.identity : `reaction-${id}`,
    state,
    kind: typeof overrides.kind === "string" ? overrides.kind : "TestReaction",
    intensity: overrides.intensity === 2 || overrides.intensity === 3 ? overrides.intensity : 1,
    motion: overrides.motion === "shake" || overrides.motion === "sink" ? overrides.motion : "pop",
    durationMs: typeof overrides.durationMs === "number" ? overrides.durationMs : 120,
    confidence: typeof overrides.confidence === "number" ? overrides.confidence : 1,
    ...(overrides.gesture === "laugh" &&
        (overrides.qualifier === "standard" || overrides.qualifier === "climactic")
      ? { gesture: "laugh" as const, qualifier: overrides.qualifier }
      : {}),
  } as FacialReaction;
}

const COMPLETE_AUDIO_PROFILE = Object.fromEntries(
  CHARACTER_AUDIO_PROFILE_SLOTS.map((slot) => [slot, { src: `/${slot}.mp3`, gain: 1 }]),
) as CharacterAudioProfile;

const COMPLETE_AUDIO_PROFILES: CharacterAudioProfileCatalog = {
  "bot-test": COMPLETE_AUDIO_PROFILE,
};

function renderBotRig(
  overrides: Readonly<{
    id?: string;
    baseSvg?: string;
    amplitudeScale?: number;
    matchScope?: string;
    audioProfileId?: string;
    reaction?: FacialReaction | null;
    precedingReaction?: FacialReaction | null;
    microReaction?: FacialReaction | null;
    controlBank?: boolean;
  }> = {},
): string {
  const controlBank: Extract<RigControlBank, { rigKind: "bot" }> = {
    rigKind: "bot",
    layers: {
      neutral: FACE_SVG,
      focused: FACE_SVG,
      smile: FACE_SVG,
      sad: FACE_SVG,
      worry: FACE_SVG,
      mad: FACE_SVG,
      surprised: FACE_SVG,
      laugh: FACE_SVG,
    },
  };
  return renderFacialRig({
    id: overrides.id ?? "east",
    label: overrides.id ?? "East",
    matchScope: overrides.matchScope ?? "match-1",
    audioProfileId: overrides.audioProfileId ?? "bot-test",
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
    ...(overrides.controlBank === true ? { controlBank } : {}),
  });
}

Deno.test("script installation is inert and init snapshots a complete profile catalog", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderBotRig({ reaction: reaction(1) }));
    await page.evaluate(() => Math.random = () => 0);
    await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });
    const result = await page.evaluate((profiles) => {
      const target = window as unknown as { FacialRig: FacialRigApi };
      const rig = document.querySelector<HTMLElement>("#avatar-rig-east")!;
      const before = {
        keys: Object.keys(target.FacialRig).sort(),
        reacting: rig.classList.contains("is-reacting"),
      };
      const rejected = target.FacialRig.init({
        audioProfiles: {},
        silenceSrc: "/silence.mp3",
        isAudioEnabled: () => true,
      });
      const accepted = target.FacialRig.init({
        audioProfiles: profiles,
        silenceSrc: "/silence.mp3",
        isAudioEnabled: () => true,
      });
      target.FacialRig.sync();
      const reactingAfterHydration = rig.classList.contains("is-reacting");
      const mutableProfiles = profiles as unknown as Record<
        string,
        Record<string, { src: string; gain: number }>
      >;
      mutableProfiles["bot-test"]!.Happiness!.src = "/mutated.mp3";
      const rejectedAfterAccepted = target.FacialRig.init({
        audioProfiles: {},
        silenceSrc: "/invalid-silence.mp3",
        isAudioEnabled: () => false,
      });
      let retainedSrc: string | null = null;
      rig.addEventListener("facial-rig:voice-cue", (event) => {
        retainedSrc = (event as CustomEvent<FacialRigSemanticAudioDetail>).detail.src;
      });
      rig.setAttribute("data-reaction", "null");
      target.FacialRig.sync();
      rig.setAttribute(
        "data-reaction",
        JSON.stringify({
          identity: "after-rejected-init",
          state: "smile",
          kind: "InitSnapshot",
          intensity: 3,
          motion: "pop",
          durationMs: 20,
          confidence: 1,
        }),
      );
      target.FacialRig.sync();
      const corrected = target.FacialRig.init({
        audioProfiles: profiles,
        silenceSrc: "/silence.mp3",
        isAudioEnabled: () => true,
      });
      return {
        before,
        rejected,
        accepted,
        reactingAfterHydration,
        rejectedAfterAccepted,
        retainedSrc: retainedSrc as string | null,
        corrected,
      };
    }, COMPLETE_AUDIO_PROFILES);
    assertEquals(result, {
      before: {
        keys: ["control", "init", "prepareSwap", "startSpeaking", "stopSpeaking", "sync"],
        reacting: false,
      },
      rejected: { tag: "rejected", reason: "invalid-profile-catalog" },
      accepted: { tag: "accepted" },
      reactingAfterHydration: false,
      rejectedAfterAccepted: { tag: "rejected", reason: "invalid-profile-catalog" },
      retainedSrc: "/Happiness.mp3",
      corrected: { tag: "accepted" },
    });
  } finally {
    await browser.close();
  }
});

Deno.test("external control composes persistent affect, speech, and release", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderBotRig({ id: "controlled", controlBank: true }));
    await loadFacialRig(page);

    const setResult = await page.evaluate(async () => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const receipt = api.control({
        tag: "set",
        rigId: "avatar-rig-controlled",
        sourceId: "game-state",
        sequence: 1,
        preset: "smile",
        features: { jawOpen: 0.25 },
        transitionMs: 0,
      });
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const rig = document.querySelector<HTMLElement>("#avatar-rig-controlled")!;
      const layer = rig.querySelector<HTMLElement>(".avatar-control-expression");
      return {
        receipt,
        active: rig.classList.contains("is-control-active"),
        preset: rig.dataset.controlPreset,
        layerPreset: layer?.dataset.controlPreset,
        layerOpacity: layer === null ? null : getComputedStyle(layer).opacity,
        mouth: rig.style.getPropertyValue("--control-mouth-transform"),
      };
    });
    assertEquals(setResult, {
      receipt: {
        tag: "accepted",
        fidelity: "full",
        rigId: "avatar-rig-controlled",
        sourceId: "game-state",
        sequence: 1,
        capabilities: {
          artwork: true,
          featurePose: true,
          wrapperMotion: true,
          tint: true,
          speech: true,
        },
        applied: ["artwork", "featurePose", "wrapperMotion", "tint"],
        ignoredFeatures: [],
      },
      active: true,
      preset: "smile",
      layerPreset: "smile",
      layerOpacity: "1",
      mouth: "translateY(-1.3px) scaleX(1.052) scaleY(1.2)",
    });

    const state = await page.evaluate(async () => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const stale = api.control({
        tag: "set",
        rigId: "avatar-rig-controlled",
        sourceId: "game-state",
        sequence: 1,
        preset: "sad",
      });
      const busy = api.control({
        tag: "set",
        rigId: "avatar-rig-controlled",
        sourceId: "camera",
        sequence: 1,
        preset: "sad",
      });
      api.control({
        tag: "set",
        rigId: "avatar-rig-controlled",
        sourceId: "game-state",
        sequence: 2,
        preset: "worry",
      });
      await new Promise(requestAnimationFrame);
      api.startSpeaking("avatar-rig-controlled", "laugh", 100);
      await new Promise(requestAnimationFrame);
      const rig = document.querySelector<HTMLElement>("#avatar-rig-controlled")!;
      const during = {
        preset: rig.querySelector<HTMLElement>(
          ".avatar-control-expression.is-control-current",
        )?.dataset.controlPreset,
        speakingMouth: rig.querySelector<SVGElement>(
          ".avatar-control-expression.is-control-current .face-mouth",
        )?.style.transform ?? "",
      };
      await new Promise((resolve) => setTimeout(resolve, 160));
      const release = api.control({
        tag: "release",
        rigId: "avatar-rig-controlled",
        sourceId: "game-state",
        sequence: 3,
        transitionMs: 80,
      });
      const releaseTransition = rig.style.getPropertyValue("--control-transition-ms");
      const nextOwner = api.control({
        tag: "set",
        rigId: "avatar-rig-controlled",
        sourceId: "camera",
        sequence: 2,
        preset: "focused",
        transitionMs: 0,
      });
      await new Promise(requestAnimationFrame);
      return {
        stale,
        busyReason: busy.tag === "rejected" ? busy.reason : null,
        during,
        release,
        releaseTransition,
        nextOwner: nextOwner.tag,
        releasingAfterSet: rig.classList.contains("is-control-releasing"),
        finalPreset: rig.dataset.controlPreset,
      };
    });
    assertEquals(state.stale, {
      tag: "rejected",
      reason: "stale-sequence",
      rigId: "avatar-rig-controlled",
      sourceId: "game-state",
      sequence: 1,
    });
    assertEquals(state.busyReason, "source-busy");
    assertEquals(state.during.preset, "worry");
    assertEquals(state.during.speakingMouth !== "", true);
    assertEquals(state.release.tag, "accepted");
    assertEquals(state.releaseTransition, "80ms");
    assertEquals(state.nextOwner, "accepted");
    assertEquals(state.releasingAfterSet, false);
    assertEquals(state.finalPreset, "focused");
  } finally {
    await browser.close();
  }
});

Deno.test("continuous control keeps only the freshest set before paint", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderBotRig({ id: "mailbox", controlBank: true }));
    await loadFacialRig(page);
    const result = await page.evaluate(async () => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const presets = ["smile", "sad", "worry", "mad", "surprised"] as const;
      const receipts = Array.from({ length: 100 }, (_, index) =>
        api.control({
          tag: "set",
          rigId: "avatar-rig-mailbox",
          sourceId: "stream",
          sequence: index + 1,
          preset: presets[index % presets.length]!,
          transitionMs: 0,
        }));
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const rig = document.querySelector<HTMLElement>("#avatar-rig-mailbox")!;
      return {
        accepted: receipts.every((receipt) => receipt.tag === "accepted"),
        preset: rig.dataset.controlPreset,
        layers: rig.querySelectorAll(":scope > .avatar-control-expression").length,
      };
    });
    assertEquals(result, { accepted: true, preset: "surprised", layers: 1 });
  } finally {
    await browser.close();
  }
});

Deno.test("bankless rigs remain visible under persistent control", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const image = "data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="%23d8c4a2"/></svg>',
    );
    const generated = renderFacialRig({
      id: "bankless-generated",
      label: "Bankless generated",
      matchScope: "match-1",
      audioProfileId: "bot-test",
      reaction: null,
      precedingReaction: null,
      microReaction: null,
      personality: PERSONALITY,
      rigKind: "human-generated",
      baseSrc: image,
      expressionSrc: image,
      microSrc: image,
      emotion: null,
    });
    await page.setContent(renderBotRig({ id: "bankless-bot" }) + generated);
    await loadFacialRig(page);
    const result = await page.evaluate(async () => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      api.control({
        tag: "set",
        rigId: "avatar-rig-bankless-bot",
        sourceId: "director",
        sequence: 1,
        preset: "smile",
        transitionMs: 0,
      });
      api.control({
        tag: "set",
        rigId: "avatar-rig-bankless-generated",
        sourceId: "director",
        sequence: 1,
        preset: "smile",
        transitionMs: 0,
      });
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return ["bankless-bot", "bankless-generated"].map((id) => {
        const rig = document.querySelector<HTMLElement>(`#avatar-rig-${id}`)!;
        return {
          id,
          baseOpacity: getComputedStyle(rig.querySelector(".avatar-base")!).opacity,
          controlLayers: rig.querySelectorAll(":scope > .avatar-control-expression").length,
          preset: rig.dataset.controlPreset,
        };
      });
    });
    assertEquals(result, [
      { id: "bankless-bot", baseOpacity: "1", controlLayers: 0, preset: "smile" },
      { id: "bankless-generated", baseOpacity: "1", controlLayers: 0, preset: "smile" },
    ]);
  } finally {
    await browser.close();
  }
});

Deno.test("control reports substrate capability degradation and boundary failures", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const image = "data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="%23d8c4a2"/></svg>',
    );
    const generatedBank: Extract<RigControlBank, { rigKind: "human-generated" }> = {
      rigKind: "human-generated",
      layers: {
        neutral: image,
        focused: image,
        smile: image,
        sad: image,
        worry: image,
        mad: image,
        surprised: image,
        laugh: image,
      },
    };
    const generated = renderFacialRig({
      id: "generated-control",
      label: "Generated",
      matchScope: "match-1",
      audioProfileId: "bot-test",
      reaction: null,
      precedingReaction: null,
      microReaction: null,
      personality: PERSONALITY,
      rigKind: "human-generated",
      baseSrc: image,
      expressionSrc: image,
      microSrc: image,
      emotion: null,
      controlBank: generatedBank,
    });
    const photo = renderFacialRig({
      id: "photo-control",
      label: "Photo",
      matchScope: "match-1",
      audioProfileId: "bot-test",
      reaction: null,
      precedingReaction: null,
      microReaction: null,
      personality: PERSONALITY,
      rigKind: "human-photo",
      src: image,
      emotion: null,
    });
    const unknown = '<span id="avatar-rig-unknown-control" class="avatar-rig" ' +
      'data-rig-kind="unknown"><img class="avatar avatar-base" alt="Unknown"></span>';
    await page.setContent(renderBotRig({ id: "bot-control" }) + generated + photo + unknown);
    await loadFacialRig(page);
    const result = await page.evaluate(async () => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const generatedReceipt = api.control({
        tag: "set",
        rigId: "avatar-rig-generated-control",
        sourceId: "operator",
        sequence: 1,
        preset: "sad",
        features: { jawOpen: 0.4 },
        transitionMs: 0,
      });
      const photoReceipt = api.control({
        tag: "set",
        rigId: "avatar-rig-photo-control",
        sourceId: "operator",
        sequence: 1,
        preset: "mad",
        transitionMs: 0,
      });
      const invalid = (api.control as unknown as (
        input: unknown,
      ) => ReturnType<FacialRigApi["control"]>)({
        tag: "set",
        rigId: "avatar-rig-bot-control",
        sourceId: "operator",
        sequence: 1,
        preset: "smile",
        features: { jawOpen: 2 },
      });
      const missing = api.control({
        tag: "set",
        rigId: "avatar-rig-missing",
        sourceId: "operator",
        sequence: 1,
        preset: "smile",
      });
      const unknown = api.control({
        tag: "set",
        rigId: "avatar-rig-unknown-control",
        sourceId: "operator",
        sequence: 1,
        preset: "smile",
      });
      await new Promise(requestAnimationFrame);
      api.startSpeaking("avatar-rig-generated-control", "laugh", 400);
      await new Promise((resolve) => setTimeout(resolve, 60));
      const generatedRig = document.querySelector<HTMLElement>(
        "#avatar-rig-generated-control",
      )!;
      const photoRig = document.querySelector<HTMLElement>("#avatar-rig-photo-control")!;
      const generatedLayer = generatedRig.querySelector<HTMLImageElement>(
        ":scope > .avatar-control-expression.is-control-current",
      );
      const generatedSpeech = {
        speaking: generatedRig.classList.contains("is-speaking"),
        moved: generatedLayer?.style.scale !== "" && generatedLayer?.style.scale !== "1",
      };
      api.stopSpeaking(generatedRig.id);
      await new Promise((resolve) => setTimeout(resolve, 220));
      return {
        generatedReceipt,
        photoReceipt,
        invalidReason: invalid.tag === "rejected" ? invalid.reason : null,
        missingReason: missing.tag === "rejected" ? missing.reason : null,
        unknownReason: unknown.tag === "rejected" ? unknown.reason : null,
        generatedPreset: generatedRig.dataset.controlPreset,
        generatedLayers: generatedRig.querySelectorAll(
          ":scope > .avatar-control-expression.is-control-current",
        ).length,
        generatedSpeech,
        generatedSpeechCleared: generatedLayer?.style.scale === "" &&
          !generatedRig.classList.contains("is-speaking"),
        photoPreset: photoRig.dataset.controlPreset,
        photoOutline: getComputedStyle(photoRig.querySelector(".avatar-base")!).outlineStyle,
      };
    });
    assertEquals(result.generatedReceipt, {
      tag: "accepted",
      fidelity: "degraded",
      rigId: "avatar-rig-generated-control",
      sourceId: "operator",
      sequence: 1,
      capabilities: {
        artwork: true,
        featurePose: false,
        wrapperMotion: true,
        tint: true,
        speech: true,
      },
      applied: ["artwork", "wrapperMotion", "tint"],
      ignoredFeatures: ["jawOpen"],
    });
    assertEquals(result.photoReceipt, {
      tag: "accepted",
      fidelity: "degraded",
      rigId: "avatar-rig-photo-control",
      sourceId: "operator",
      sequence: 1,
      capabilities: {
        artwork: false,
        featurePose: false,
        wrapperMotion: false,
        tint: true,
        speech: false,
      },
      applied: ["tint"],
      ignoredFeatures: [],
    });
    assertEquals(result.invalidReason, "invalid-command");
    assertEquals(result.missingReason, "rig-not-found");
    assertEquals(result.unknownReason, "rig-not-found");
    assertEquals(result.generatedPreset, "sad");
    assertEquals(result.generatedLayers, 1);
    assertEquals(result.generatedSpeech, { speaking: true, moved: true });
    assertEquals(result.generatedSpeechCleared, true);
    assertEquals(result.photoPreset, "mad");
    assertEquals(result.photoOutline, "solid");
  } finally {
    await browser.close();
  }
});

Deno.test("control state survives matching swaps and clears on changed signatures", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderBotRig({ id: "control-swap", controlBank: true }));
    await loadFacialRig(page);
    const result = await page.evaluate(async ({ matching, changed }) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      api.control({
        tag: "set",
        rigId: "avatar-rig-control-swap",
        sourceId: "game-state",
        sequence: 1,
        preset: "smile",
        transitionMs: 0,
      });
      await new Promise(requestAnimationFrame);
      const matchingTemplate = document.createElement("template");
      matchingTemplate.innerHTML = matching;
      api.prepareSwap(matchingTemplate.content);
      api.sync();
      const live = document.querySelector<HTMLElement>("#avatar-rig-control-swap")!;
      const preserved = {
        preset: live.dataset.controlPreset,
        layer: live.querySelector<HTMLElement>(
          ".avatar-control-expression.is-control-current",
        )?.dataset.controlPreset,
      };
      const changedTemplate = document.createElement("template");
      changedTemplate.innerHTML = changed;
      api.prepareSwap(changedTemplate.content);
      api.sync();
      const next = api.control({
        tag: "set",
        rigId: "avatar-rig-control-swap",
        sourceId: "camera",
        sequence: 1,
        preset: "focused",
        transitionMs: 0,
      });
      await new Promise(requestAnimationFrame);
      return {
        preserved,
        next: next.tag,
        finalPreset: document.querySelector<HTMLElement>("#avatar-rig-control-swap")?.dataset
          .controlPreset,
      };
    }, {
      matching: renderBotRig({ id: "control-swap", controlBank: true }),
      changed: renderBotRig({
        id: "control-swap",
        controlBank: true,
        baseSvg: FACE_SVG.replace("<svg ", '<svg data-version="2" '),
      }),
    });
    assertEquals(result, {
      preserved: { preset: "smile", layer: "smile" },
      next: "accepted",
      finalPreset: "focused",
    });
  } finally {
    await browser.close();
  }
});

Deno.test("persistent control restores across a direct same-signature replacement", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const html = renderBotRig({ id: "control-direct-swap", controlBank: true });
    await page.setContent(html);
    await loadFacialRig(page);
    const result = await page.evaluate(async (replacement) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      api.control({
        tag: "set",
        rigId: "avatar-rig-control-direct-swap",
        sourceId: "director",
        sequence: 1,
        preset: "smile",
        transitionMs: 0,
      });
      await new Promise(requestAnimationFrame);
      const template = document.createElement("template");
      template.innerHTML = replacement;
      document.querySelector("#avatar-rig-control-direct-swap")?.replaceWith(template.content);
      api.sync();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const rig = document.querySelector<HTMLElement>("#avatar-rig-control-direct-swap")!;
      const stale = api.control({
        tag: "set",
        rigId: rig.id,
        sourceId: "director",
        sequence: 1,
        preset: "sad",
      });
      const busy = api.control({
        tag: "set",
        rigId: rig.id,
        sourceId: "camera",
        sequence: 1,
        preset: "worry",
      });
      return {
        preset: rig.dataset.controlPreset,
        artwork: rig.querySelector<HTMLElement>(
          ":scope > .avatar-control-expression.is-control-current",
        )?.dataset.controlPreset,
        stale: stale.tag === "rejected" ? stale.reason : null,
        busy: busy.tag === "rejected" ? busy.reason : null,
      };
    }, html);
    assertEquals(result, {
      preset: "smile",
      artwork: "smile",
      stale: "stale-sequence",
      busy: "source-busy",
    });
  } finally {
    await browser.close();
  }
});

Deno.test("atomic laugh preserves control priority and reduced-motion hold behavior", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderBotRig({ id: "lanes", controlBank: true }));
    await loadFacialRig(page);
    const animated = await page.evaluate(
      async (reactionHtml) => {
        const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
        const rig = document.querySelector<HTMLElement>("#avatar-rig-lanes")!;
        api.control({
          tag: "set",
          rigId: rig.id,
          sourceId: "director",
          sequence: 1,
          preset: "worry",
          transitionMs: 0,
        });
        await new Promise(requestAnimationFrame);
        const template = document.createElement("template");
        template.innerHTML = reactionHtml;
        api.prepareSwap(template.content);
        api.sync();
        const duringGesture = {
          gesturing: rig.classList.contains("is-control-gesturing"),
          macro: getComputedStyle(rig.querySelector(".avatar-expression")!).opacity,
          control: getComputedStyle(
            rig.querySelector(".avatar-control-expression.is-control-current")!,
          ).opacity,
          zIndex: getComputedStyle(
            rig.querySelector(".avatar-control-expression.is-control-current")!,
          ).zIndex,
        };
        await new Promise((resolve) => setTimeout(resolve, 180));
        return {
          duringGesture,
          settled: {
            reacting: rig.classList.contains("is-reacting"),
            gesturing: rig.classList.contains("is-control-gesturing"),
            control: getComputedStyle(
              rig.querySelector(".avatar-control-expression.is-control-current")!,
            ).opacity,
            preset: rig.dataset.controlPreset,
          },
        };
      },
      renderBotRig({
        id: "lanes",
        controlBank: true,
        reaction: reaction(1, {
          state: "surprised",
          gesture: "laugh",
          qualifier: "standard",
          durationMs: 120,
        }),
      }),
    );
    assertEquals(animated, {
      duringGesture: { gesturing: true, macro: "1", control: "1", zIndex: "5" },
      settled: { reacting: false, gesturing: false, control: "1", preset: "worry" },
    });

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await page.evaluate(
      async (reactionHtml) => {
        const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
        const rig = document.querySelector<HTMLElement>("#avatar-rig-lanes")!;
        api.control({
          tag: "release",
          rigId: rig.id,
          sourceId: "director",
          sequence: 3,
          transitionMs: 0,
        });
        const receipt = api.control({
          tag: "set",
          rigId: rig.id,
          sourceId: "director",
          sequence: 4,
          preset: "smile",
        });
        await new Promise(requestAnimationFrame);
        const template = document.createElement("template");
        template.innerHTML = reactionHtml;
        api.prepareSwap(template.content);
        api.sync();
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          receipt,
          gesturing: rig.classList.contains("is-control-gesturing"),
          preset: rig.dataset.controlPreset,
          transition: rig.style.getPropertyValue("--control-transition-ms"),
          gestureWrite: rig.style.getPropertyValue("--control-gesture-y"),
          layerOpacity: getComputedStyle(
            rig.querySelector(".avatar-control-expression.is-control-current")!,
          ).opacity,
        };
      },
      renderBotRig({
        id: "lanes",
        matchScope: "match-2",
        controlBank: true,
        reaction: reaction(2, {
          state: "smile",
          gesture: "laugh",
          qualifier: "climactic",
          durationMs: 120,
        }),
      }),
    );
    assertEquals(reduced.receipt.tag, "accepted");
    if (reduced.receipt.tag === "accepted") {
      assertEquals(reduced.receipt.capabilities.wrapperMotion, false);
      assertEquals(reduced.receipt.applied, ["artwork", "featurePose", "tint"]);
    }
    assertEquals({
      gesturing: reduced.gesturing,
      preset: reduced.preset,
      transition: reduced.transition,
      gestureWrite: reduced.gestureWrite,
      layerOpacity: reduced.layerOpacity,
    }, {
      gesturing: true,
      preset: "laugh",
      transition: "0ms",
      gestureWrite: "",
      layerOpacity: "1",
    });
  } finally {
    await browser.close();
  }
});

async function loadFacialRig(page: Page): Promise<void> {
  await page.addStyleTag({ path: localPath(AVATAR_ASSETS.facialRigStyles.url) });
  await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });
  await page.evaluate((profiles) => {
    const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
    const receipt = api.init({
      audioProfiles: profiles,
      silenceSrc: "/silence.mp3",
      isAudioEnabled: () => (window as unknown as { audioEnabled?: boolean }).audioEnabled ?? true,
    });
    if (receipt.tag === "rejected") throw new Error(`facial rig init: ${receipt.reason}`);
    api.sync();
  }, COMPLETE_AUDIO_PROFILES);
}

async function installResolvingAudio(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Listener = () => void;
    class ResolvingAudio {
      ended = false;
      paused = false;
      src: string;
      volume = 1;
      readonly listeners = new Map<string, Listener[]>();

      constructor(src = "") {
        this.src = src;
        (window as unknown as { testAudio: ResolvingAudio[] }).testAudio.push(this);
      }

      addEventListener(type: string, listener: Listener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }

      removeEventListener(type: string, listener: Listener): void {
        this.listeners.set(
          type,
          (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
        );
      }

      pause(): void {
        this.paused = true;
      }
      play(): Promise<void> {
        const mode = (window as unknown as { audioMode: string }).audioMode;
        if (mode === "reject") return Promise.reject(new Error("autoplay denied"));
        if (mode === "pending") return new Promise(() => undefined);
        return Promise.resolve();
      }

      finish(): void {
        this.ended = true;
        for (const listener of this.listeners.get("ended") ?? []) listener();
      }
    }
    const target = window as unknown as {
      Audio: typeof ResolvingAudio;
      audioEnabled: boolean;
      audioMode: string;
      audioNow: number;
      audioRandom: number;
      testAudio: ResolvingAudio[];
    };
    target.audioNow = 1_000;
    target.audioEnabled = true;
    target.audioMode = "resolve";
    target.audioRandom = 0;
    target.testAudio = [];
    target.Audio = ResolvingAudio;
    Date.now = () => target.audioNow;
    Math.random = () => target.audioRandom;
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
      matchScope: "match-1",
      audioProfileId: "bot-test",
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
        ${renderBotRig()}
      </div>
    `);
    const globalsBefore = await page.evaluate(() => Object.getOwnPropertyNames(window));
    await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });
    assertEquals(
      await page.evaluate(() =>
        Object.keys((window as unknown as { FacialRig: FacialRigApi }).FacialRig).sort()
      ),
      ["control", "init", "prepareSwap", "startSpeaking", "stopSpeaking", "sync"],
    );
    assertEquals(
      await page.evaluate(
        (before) => Object.getOwnPropertyNames(window).filter((name) => !before.includes(name)),
        globalsBefore,
      ),
      ["FacialRig"],
    );
    await page.evaluate((profiles) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      api.init({
        audioProfiles: profiles,
        silenceSrc: "/silence.mp3",
        isAudioEnabled: () => true,
      });
      api.sync();
    }, COMPLETE_AUDIO_PROFILES);
    await page.waitForTimeout(250);
    const idleScale = await page.locator("#avatar-rig-east").evaluate((element) =>
      (element as HTMLElement).style.getPropertyValue("--rig-breath-scale")
    );
    assertEquals(idleScale.length > 0, true);

    await page.locator("#avatar-rig-east").evaluate((element, nextReaction) => {
      element.setAttribute("data-reaction", JSON.stringify(nextReaction));
    }, reaction(1, { durationMs: 300 }));
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
        microReaction: reaction(2, { confidence, durationMs: 2_000 }),
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
      matchScope: "match-1",
      audioProfileId: "bot-test",
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
      matchScope: "match-1",
      audioProfileId: "bot-test",
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
      precedingReaction: reaction(2, {
        kind: "LeadReaction",
        expression: "surprise",
        motion: "shake",
        durationMs: 40,
      }),
      reaction: reaction(3, { kind: "MainReaction", motion: "pop" }),
      microReaction: reaction(4, {
        kind: "MicroReaction",
        expression: "focused",
        motion: "sink",
        durationMs: 80,
      }),
    });
    const advancedIncoming = renderBotRig({
      reaction: reaction(5, { durationMs: 2_000 }),
      microReaction: reaction(6, { durationMs: 2_000 }),
    });
    const preserved = await page.evaluate((html) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const live = document.querySelector<HTMLElement>("#avatar-rig-east")!;
      live.dataset.liveMarker = "preserved";
      const template = document.createElement("template");
      template.innerHTML = html;
      api.prepareSwap(template.content);
      api.sync();
      const main = JSON.parse(live.getAttribute("data-reaction") ?? "null") as
        | FacialReaction
        | null;
      const micro = JSON.parse(live.getAttribute("data-micro-reaction") ?? "null") as
        | FacialReaction
        | null;
      return {
        marker: live.dataset.liveMarker,
        reactionIdentity: String(main?.identity ?? ""),
        microIdentity: String(micro?.identity ?? ""),
        reacting: live.classList.contains("is-reacting"),
        microReacting: live.classList.contains("is-micro-reacting"),
        leadMotion: live.classList.contains("motion-shake"),
      };
    }, incoming);
    assertEquals(preserved, {
      marker: "preserved",
      reactionIdentity: "reaction-3",
      microIdentity: "reaction-4",
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
          matchScope: "match-1",
          audioProfileId: "bot-test",
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
        lane: "reaction" | "preceding-reaction" | "micro-reaction",
        identity: string,
        kind: string,
        state: FacialReaction["state"],
      ) => {
        rig.setAttribute(
          `data-${lane}`,
          JSON.stringify({
            identity,
            state,
            kind,
            intensity: 3,
            motion: "shake",
            durationMs: 30,
            confidence: 0.8,
          }),
        );
      };
      for (const rig of rigs) {
        setReaction(rig, "reaction", `${rig.id}:main:1`, "Main", "mad");
        setReaction(rig, "micro-reaction", `${rig.id}:micro:1`, "CardPlayedHigh", "focused");
      }
      api.sync();
      api.sync();

      const actor = document.querySelector<HTMLElement>("#avatar-rig-actor")!;
      setReaction(actor, "reaction", "actor:main:2", "", "sad");
      setReaction(actor, "preceding-reaction", "actor:preceding:2", "", "worry");
      setReaction(actor, "micro-reaction", "actor:micro:2", "", "focused");
      api.sync();
      setReaction(actor, "preceding-reaction", "actor:preceding:3", "LeadOnly", "surprised");
      api.sync();
      setReaction(actor, "reaction", "actor:main:3", "MainOnly", "sad");
      setReaction(actor, "micro-reaction", "actor:micro:3", "DecisionMadeMogu", "focused");
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
      const observerDuration = observer.style.getPropertyValue("--reaction-duration-ms");
      observer.setAttribute("data-reaction", '{"identity":"incomplete"}');
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
        observerUnchanged: observer.style.getPropertyValue("--reaction-duration-ms") ===
          observerDuration,
      };
    }, renderBotRig({ id: "missing-live" }));
    assertEquals(state, {
      actorReacting: true,
      actorMicro: true,
      photoMotion: false,
      noLayerReacting: true,
      anonymousReacting: false,
      observerGaze: true,
      observerUnchanged: true,
    });
  } finally {
    await browser.close();
  }
});

Deno.test("atomic lifecycle keeps reconciliation silent and rejects retired-scope replay", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const seededReaction = reaction(1, { state: "smile", durationMs: 40 });
    await page.setContent(renderBotRig({ reaction: seededReaction }));
    await installResolvingAudio(page);
    await page.evaluate(() => {
      const target = window as unknown as { semanticEvents: FacialRigSemanticAudioDetail[] };
      target.semanticEvents = [];
      document.addEventListener("facial-rig:voice-cue", (event) => {
        target.semanticEvents.push(
          (event as CustomEvent<FacialRigSemanticAudioDetail>).detail,
        );
      });
    });
    await loadFacialRig(page);

    const result = await page.evaluate(async (html) => {
      type TestAudio = Readonly<{ finish(): void }>;
      const target = window as unknown as {
        FacialRig: FacialRigApi;
        audioNow: number;
        semanticEvents: FacialRigSemanticAudioDetail[];
        testAudio: TestAudio[];
      };
      const api = target.FacialRig;
      const apply = (markup: string) => {
        const template = document.createElement("template");
        template.innerHTML = markup;
        api.prepareSwap(template.content);
        api.sync();
      };
      const replace = (markup: string) => {
        const template = document.createElement("template");
        template.innerHTML = markup;
        document.querySelector("#avatar-rig-east")?.replaceWith(template.content);
        api.sync();
      };
      const finishAudio = () => {
        target.testAudio.at(-1)?.finish();
        target.audioNow += 3_000;
      };

      api.sync();
      const hydrationEvents = target.semanticEvents.length;
      replace(html.same);
      const replacementEvents = target.semanticEvents.length;
      apply(html.release);
      const releaseEvents = target.semanticEvents.length;
      apply(html.restore);
      const restorationEvents = target.semanticEvents.length;
      apply(html.moved);
      const movedEvents = target.semanticEvents.length;

      const beforeConflict = document.querySelector("#avatar-rig-east")?.getAttribute(
        "data-micro-reaction",
      );
      apply(html.conflict);
      const conflictRejected = document.querySelector("#avatar-rig-east")?.getAttribute(
        "data-micro-reaction",
      ) === beforeConflict;

      apply(html.distinct);
      const distinctEvents = target.semanticEvents.length;
      finishAudio();

      apply(html.unknownProfile);
      const unknownProfileRejected = document.querySelector<HTMLElement>("#avatar-rig-east")
        ?.dataset.audioProfileId === "bot-test";
      apply(html.correctedProfile);
      const correctedProfileEvents = target.semanticEvents.length;
      finishAudio();

      apply(html.scopeTwo);
      const scopeTwoEvents = target.semanticEvents.length;
      finishAudio();
      await new Promise((resolve) => setTimeout(resolve, 60));
      apply(html.retiredScope);
      const rig = document.querySelector<HTMLElement>("#avatar-rig-east")!;
      const retiredScopeRejected = rig.dataset.matchScope === "match-2" &&
        !rig.classList.contains("is-reacting");

      const reinit = api.init({
        audioProfiles: html.profiles,
        silenceSrc: "/silence.mp3",
        isAudioEnabled: () => true,
      });
      api.sync();
      return {
        hydrationEvents,
        replacementEvents,
        releaseEvents,
        restorationEvents,
        movedEvents,
        conflictRejected,
        distinctEvents,
        unknownProfileRejected,
        correctedProfileEvents,
        scopeTwoEvents,
        retiredScopeRejected,
        eventsAfterReinit: target.semanticEvents.length,
        reinit,
      };
    }, {
      same: renderBotRig({ reaction: seededReaction }),
      release: renderBotRig(),
      restore: renderBotRig({ reaction: seededReaction }),
      moved: renderBotRig({ microReaction: seededReaction }),
      conflict: renderBotRig({
        microReaction: { ...seededReaction, state: "mad" },
      }),
      distinct: renderBotRig({ reaction: reaction(2, { state: "smile", durationMs: 40 }) }),
      unknownProfile: renderBotRig({
        audioProfileId: "missing-profile",
        reaction: reaction(3, { state: "sad", durationMs: 40 }),
      }),
      correctedProfile: renderBotRig({
        reaction: reaction(3, { state: "sad", durationMs: 40 }),
      }),
      scopeTwo: renderBotRig({
        matchScope: "match-2",
        reaction: reaction(4, { state: "worry", durationMs: 40 }),
      }),
      retiredScope: renderBotRig({
        matchScope: "match-1",
        reaction: reaction(5, { state: "mad", durationMs: 40 }),
      }),
      profiles: COMPLETE_AUDIO_PROFILES,
    });

    assertEquals(result, {
      hydrationEvents: 0,
      replacementEvents: 0,
      releaseEvents: 0,
      restorationEvents: 0,
      movedEvents: 0,
      conflictRejected: true,
      distinctEvents: 1,
      unknownProfileRejected: true,
      correctedProfileEvents: 2,
      scopeTwoEvents: 3,
      retiredScopeRejected: true,
      eventsAfterReinit: 3,
      reinit: { tag: "accepted" },
    });
  } finally {
    await browser.close();
  }
});

Deno.test("preceding and micro visuals keep order while laugh overrides state audio", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderBotRig({ controlBank: true }));
    await installResolvingAudio(page);
    await loadFacialRig(page);

    const result = await page.evaluate(
      async (markup) => {
        const target = window as unknown as {
          FacialRig: FacialRigApi;
          semanticEvents: FacialRigSemanticAudioDetail[];
        };
        target.semanticEvents = [];
        document.addEventListener("facial-rig:voice-cue", (event) => {
          target.semanticEvents.push(
            (event as CustomEvent<FacialRigSemanticAudioDetail>).detail,
          );
        });
        const template = document.createElement("template");
        template.innerHTML = markup;
        target.FacialRig.prepareSwap(template.content);
        target.FacialRig.sync();
        const rig = document.querySelector<HTMLElement>("#avatar-rig-east")!;
        const immediate = {
          macroDuration: rig.style.getPropertyValue("--reaction-duration-ms"),
          microDuration: rig.style.getPropertyValue("--micro-duration-ms"),
          microActive: rig.classList.contains("is-micro-reacting"),
          gesturing: rig.classList.contains("is-control-gesturing"),
        };
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          immediate,
          delayed: {
            macroDuration: rig.style.getPropertyValue("--reaction-duration-ms"),
            microActive: rig.classList.contains("is-micro-reacting"),
            gesturing: rig.classList.contains("is-control-gesturing"),
          },
          events: target.semanticEvents.map(({ family, qualifier, src, identity }) => ({
            family,
            qualifier,
            src,
            identity: String(identity),
          })),
        };
      },
      renderBotRig({
        precedingReaction: reaction(10, { state: "focused", durationMs: 50 }),
        reaction: reaction(11, {
          state: "surprised",
          gesture: "laugh",
          qualifier: "climactic",
          durationMs: 160,
        }),
        microReaction: reaction(12, { state: "neutral", durationMs: 200 }),
        controlBank: true,
      }),
    );

    assertEquals(result, {
      immediate: {
        macroDuration: "50ms",
        microDuration: "200ms",
        microActive: true,
        gesturing: false,
      },
      delayed: {
        macroDuration: "160ms",
        microActive: true,
        gesturing: true,
      },
      events: [{
        family: "Laughter",
        qualifier: "climactic",
        src: "/Laughter.climactic.mp3",
        identity: "reaction-11",
      }],
    });
  } finally {
    await browser.close();
  }
});

Deno.test("every admission outcome consumes the accepted atomic identity", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const photo = renderFacialRig({
      id: "photo-admission",
      label: "Photo",
      matchScope: "match-1",
      audioProfileId: "bot-test",
      reaction: null,
      precedingReaction: null,
      microReaction: null,
      personality: PERSONALITY,
      rigKind: "human-photo",
      src: "/photo.webp",
      emotion: null,
    });
    await page.setContent(
      ["primary", "cooldown", "cap-a", "cap-b", "cap-c"]
        .map((id) => renderBotRig({ id }))
        .join("") + photo,
    );
    await installResolvingAudio(page);
    await loadFacialRig(page);

    const result = await page.evaluate(async () => {
      type TestAudio = Readonly<{ finish(): void }>;
      const target = window as unknown as {
        FacialRig: FacialRigApi;
        audioEnabled: boolean;
        audioMode: string;
        audioNow: number;
        audioRandom: number;
        semanticEvents: FacialRigSemanticAudioDetail[];
        testAudio: TestAudio[];
      };
      const api = target.FacialRig;
      target.semanticEvents = [];
      document.addEventListener("facial-rig:voice-cue", (event) => {
        const detail = (event as CustomEvent<FacialRigSemanticAudioDetail>).detail;
        target.semanticEvents.push(detail);
        if (String(detail.identity) === "cancelled") event.preventDefault();
      });
      const makeReaction = (
        identity: string,
        state: FacialReaction["state"],
        intensity: 1 | 2 | 3 = 3,
      ): FacialReaction => ({
        identity,
        state,
        kind: "AdmissionTest",
        intensity,
        motion: "pop",
        durationMs: 30,
        confidence: 1,
      } as FacialReaction);
      const deliver = (
        rigId: string,
        next: FacialReaction,
      ) => {
        const rig = document.querySelector<HTMLElement>(`#avatar-rig-${rigId}`)!;
        rig.setAttribute("data-reaction", JSON.stringify(next));
        api.sync();
        return rig;
      };
      const release = (rigId: string) => {
        document.querySelector<HTMLElement>(`#avatar-rig-${rigId}`)!
          .setAttribute("data-reaction", "null");
        api.sync();
      };
      const counts = () => ({
        events: target.semanticEvents.length,
        audio: target.testAudio.length,
      });
      const sameCounts = (before: ReturnType<typeof counts>) =>
        before.events === target.semanticEvents.length && before.audio === target.testAudio.length;
      const advance = () => target.audioNow += 3_000;

      target.audioEnabled = false;
      const muted = makeReaction("muted", "smile");
      const mutedRig = deliver("primary", muted);
      const muteVisualApplied = mutedRig.classList.contains("is-reacting");
      const muteCounts = counts();
      target.audioEnabled = true;
      advance();
      deliver("primary", muted);
      const muteConsumed = sameCounts(muteCounts);

      release("primary");
      advance();
      const cancelled = makeReaction("cancelled", "sad");
      deliver("primary", cancelled);
      const cancelCounts = counts();
      advance();
      deliver("primary", cancelled);
      const cancelConsumed = cancelCounts.events === 1 && cancelCounts.audio === 0 &&
        sameCounts(cancelCounts);

      release("primary");
      advance();
      target.audioRandom = 0.999;
      const probability = makeReaction("probability", "worry", 1);
      deliver("primary", probability);
      const probabilityCounts = counts();
      target.audioRandom = 0;
      advance();
      deliver("primary", probability);
      const probabilityConsumed = sameCounts(probabilityCounts);

      release("primary");
      advance();
      target.audioMode = "reject";
      const autoplay = makeReaction("autoplay", "mad");
      deliver("primary", autoplay);
      await Promise.resolve();
      await Promise.resolve();
      const autoplayCounts = counts();
      advance();
      target.audioMode = "resolve";
      deliver("primary", autoplay);
      const autoplayConsumed = autoplayCounts.events === 2 && autoplayCounts.audio === 1 &&
        sameCounts(autoplayCounts);

      advance();
      const familyFirst = makeReaction("family-first", "smile", 1);
      deliver("cooldown", familyFirst);
      await Promise.resolve();
      target.testAudio.at(-1)?.finish();
      release("cooldown");
      const familyBlocked = makeReaction("family-blocked", "smile", 1);
      const beforeFamilyBlocked = counts();
      deliver("cooldown", familyBlocked);
      const familyCooldownRejected = sameCounts(beforeFamilyBlocked);
      release("cooldown");
      const seatBlocked = makeReaction("seat-blocked", "sad", 1);
      const beforeSeatBlocked = counts();
      deliver("cooldown", seatBlocked);
      const seatCooldownRejected = sameCounts(beforeSeatBlocked);
      advance();
      deliver("cooldown", familyBlocked);
      deliver("cooldown", seatBlocked);
      const cooldownsConsumed = sameCounts(beforeSeatBlocked);

      release("primary");
      advance();
      target.audioMode = "pending";
      const active = makeReaction("active", "surprised");
      deliver("primary", active);
      const activeAudio = target.testAudio.at(-1);
      release("primary");
      const activeBlocked = makeReaction("active-blocked", "worry");
      const beforeActiveBlocked = counts();
      deliver("primary", activeBlocked);
      const activeSeatRejected = sameCounts(beforeActiveBlocked);
      activeAudio?.finish();
      advance();
      deliver("primary", activeBlocked);
      const activeSeatConsumed = sameCounts(beforeActiveBlocked);

      advance();
      const capA = makeReaction("cap-a", "smile");
      const capB = makeReaction("cap-b", "sad");
      const capC = makeReaction("cap-c", "worry");
      deliver("cap-a", capA);
      const capAudioA = target.testAudio.at(-1);
      deliver("cap-b", capB);
      const capAudioB = target.testAudio.at(-1);
      const beforeCapBlocked = counts();
      deliver("cap-c", capC);
      const channelCapRejected = sameCounts(beforeCapBlocked);
      capAudioA?.finish();
      capAudioB?.finish();
      advance();
      deliver("cap-c", capC);
      const channelCapConsumed = sameCounts(beforeCapBlocked);

      advance();
      const photoReaction = makeReaction("photo-kind", "smile");
      const photoRig = deliver("photo-admission", photoReaction);
      const beforePhotoRetry = counts();
      const photoVisualApplied = photoRig.classList.contains("is-reacting");
      photoRig.dataset.rigKind = "bot";
      deliver("photo-admission", photoReaction);
      const rigKindConsumed = sameCounts(beforePhotoRetry);

      return {
        muteVisualApplied,
        muteConsumed,
        cancelConsumed,
        probabilityConsumed,
        autoplayConsumed,
        familyCooldownRejected,
        seatCooldownRejected,
        cooldownsConsumed,
        activeSeatRejected,
        activeSeatConsumed,
        channelCapRejected,
        channelCapConsumed,
        photoVisualApplied,
        rigKindConsumed,
      };
    });

    assertEquals(result, {
      muteVisualApplied: true,
      muteConsumed: true,
      cancelConsumed: true,
      probabilityConsumed: true,
      autoplayConsumed: true,
      familyCooldownRejected: true,
      seatCooldownRejected: true,
      cooldownsConsumed: true,
      activeSeatRejected: true,
      activeSeatConsumed: true,
      channelCapRejected: true,
      channelCapConsumed: true,
      photoVisualApplied: true,
      rigKindConsumed: true,
    });
  } finally {
    await browser.close();
  }
});

Deno.test("all browser audio and teardown failures stay nonfatal and release capacity", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setContent(renderBotRig({ id: "fault" }));
    await page.evaluate(() => {
      type Listener = () => void;
      type FaultTarget = Window & typeof globalThis & {
        faultAudio: FaultAudio[];
        faultMode: string;
        faultNow: number;
      };
      const target = window as FaultTarget;
      class FaultAudio {
        ended = false;
        private srcValue: string;
        private volumeValue = 1;
        readonly listeners = new Map<string, Listener[]>();
        pauseCalls = 0;

        constructor(src = "") {
          if (target.faultMode === "constructor") throw new Error("constructor failure");
          this.srcValue = src;
          target.faultAudio.push(this);
        }

        get src(): string {
          return this.srcValue;
        }
        get volume(): number {
          return this.volumeValue;
        }
        set volume(value: number) {
          if (target.faultMode === "volume") throw new Error("volume failure");
          this.volumeValue = value;
        }

        addEventListener(type: string, listener: Listener): void {
          if (
            target.faultMode === "listener-ended" && type === "ended" ||
            target.faultMode === "listener-error" && type === "error"
          ) throw new Error("listener registration failure");
          this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
        }

        removeEventListener(type: string, listener: Listener): void {
          this.listeners.set(
            type,
            (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
          );
          if (target.faultMode === "teardown") throw new Error("listener removal failure");
        }

        pause(): void {
          this.pauseCalls += 1;
          if (target.faultMode === "teardown") throw new Error("pause failure");
        }

        play(): Promise<void> {
          if (target.faultMode === "play-throw") throw new Error("play failure");
          if (target.faultMode === "play-reject") {
            return Promise.reject(new Error("autoplay failure"));
          }
          if (target.faultMode === "timeout" || target.faultMode === "node-removal") {
            return new Promise(() => undefined);
          }
          return Promise.resolve();
        }

        fail(): void {
          for (const listener of [...(this.listeners.get("error") ?? [])]) listener();
        }

        finish(): void {
          this.ended = true;
          for (const listener of [...(this.listeners.get("ended") ?? [])]) listener();
        }

        listenerCount(): number {
          return [...this.listeners.values()].reduce((total, listeners) => {
            return total + listeners.length;
          }, 0);
        }
      }

      class FaultAudioContext {
        readonly destination = {};
        state = "running";

        createMediaElementSource(): {
          connect(): void;
          disconnect(): void;
        } {
          if (target.faultMode === "analyser-source") throw new Error("source failure");
          return {
            connect() {
              if (target.faultMode === "analyser-connect") throw new Error("connect failure");
            },
            disconnect() {
              if (target.faultMode === "teardown") throw new Error("disconnect failure");
            },
          };
        }

        createAnalyser(): {
          connect(): void;
          disconnect(): void;
          fftSize: number;
          frequencyBinCount: number;
          getByteTimeDomainData(buffer: Uint8Array): void;
          smoothingTimeConstant: number;
        } {
          if (target.faultMode === "analyser-create") throw new Error("analyser failure");
          return {
            connect() {
              if (target.faultMode === "analyser-connect") throw new Error("connect failure");
            },
            disconnect() {
              if (target.faultMode === "teardown") throw new Error("disconnect failure");
            },
            fftSize: 0,
            frequencyBinCount: 8,
            getByteTimeDomainData(buffer: Uint8Array) {
              if (target.faultMode === "analyser-sample") throw new Error("sample failure");
              buffer.fill(128);
            },
            smoothingTimeConstant: 0,
          };
        }

        resume(): Promise<void> {
          return Promise.resolve();
        }
      }

      target.faultAudio = [];
      target.faultMode = "ready";
      target.faultNow = 1_000;
      target.Audio = FaultAudio as unknown as typeof Audio;
      target.AudioContext = FaultAudioContext as unknown as typeof AudioContext;
      Date.now = () => target.faultNow;
      Math.random = () => 0;
      const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
      globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        const boundedDelay = delay === 2_000 || delay === 2_400 || delay === 3_200 ? 25 : delay;
        return nativeSetTimeout(handler, boundedDelay, ...args);
      }) as typeof globalThis.setTimeout;
    });
    await loadFacialRig(page);

    const result = await page.evaluate(async (replacementMarkup) => {
      type FaultAudio = Readonly<{
        fail(): void;
        finish(): void;
        listenerCount(): number;
        pauseCalls: number;
      }>;
      const target = window as unknown as {
        FacialRig: FacialRigApi;
        faultAudio: FaultAudio[];
        faultMode: string;
        faultNow: number;
        semanticEvents: FacialRigSemanticAudioDetail[];
      };
      const api = target.FacialRig;
      target.semanticEvents = [];
      document.addEventListener("facial-rig:voice-cue", (event) => {
        target.semanticEvents.push(
          (event as CustomEvent<FacialRigSemanticAudioDetail>).detail,
        );
      });
      const states = ["smile", "sad", "worry", "mad", "surprised"] as const;
      let nextState = 0;
      const visualSettled: boolean[] = [];
      const deliver = async (identity: string, mode: string) => {
        const rig = document.querySelector<HTMLElement>("#avatar-rig-fault")!;
        rig.setAttribute("data-reaction", "null");
        api.sync();
        target.faultNow += 3_000;
        target.faultMode = mode;
        const next: FacialReaction = {
          identity,
          state: states[nextState++ % states.length]!,
          kind: "FailureTest",
          intensity: 3,
          motion: "pop",
          durationMs: 20,
          confidence: 1,
        } as FacialReaction;
        rig.setAttribute("data-reaction", JSON.stringify(next));
        api.sync();
        await Promise.resolve();
        await Promise.resolve();
        return rig;
      };
      const finishAndObserve = async (rig: HTMLElement) => {
        await new Promise((resolve) => setTimeout(resolve, 35));
        visualSettled.push(!rig.classList.contains("is-reacting"));
      };

      for (
        const mode of [
          "constructor",
          "volume",
          "listener-ended",
          "listener-error",
          "play-throw",
          "play-reject",
        ]
      ) {
        const rig = await deliver(`failure:${mode}`, mode);
        await finishAndObserve(rig);
      }

      let rig = await deliver("failure:media-error", "media-error");
      target.faultAudio.at(-1)?.fail();
      await finishAndObserve(rig);

      rig = await deliver("failure:timeout", "timeout");
      await new Promise((resolve) => setTimeout(resolve, 40));
      await finishAndObserve(rig);

      for (
        const mode of [
          "analyser-source",
          "analyser-create",
          "analyser-connect",
          "analyser-sample",
        ]
      ) {
        rig = await deliver(`failure:${mode}`, mode);
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        target.faultAudio.at(-1)?.finish();
        await finishAndObserve(rig);
      }

      rig = await deliver("failure:teardown", "teardown");
      await new Promise(requestAnimationFrame);
      target.faultAudio.at(-1)?.fail();
      await finishAndObserve(rig);

      rig = await deliver("failure:node-removal", "node-removal");
      const nodeAudio = target.faultAudio.at(-1);
      rig.remove();
      api.sync();
      const template = document.createElement("template");
      template.innerHTML = replacementMarkup;
      document.body.append(template.content);
      api.sync();
      target.faultMode = "ready";
      const recovered = await deliver("failure:recovered", "ready");
      target.faultAudio.at(-1)?.finish();
      await finishAndObserve(recovered);

      return {
        eventCount: target.semanticEvents.length,
        allVisualsSettled: visualSettled.every(Boolean),
        allListenersRemoved: target.faultAudio.every((audio) => audio.listenerCount() === 0),
        nodeRemovalPaused: (nodeAudio?.pauseCalls ?? 0) > 0,
        recovered: target.semanticEvents.at(-1)?.identity === "failure:recovered",
      };
    }, renderBotRig({ id: "fault" }));

    assertEquals(pageErrors, []);
    assertEquals(result, {
      eventCount: 15,
      allVisualsSettled: true,
      allListenersRemoved: true,
      nodeRemovalPaused: true,
      recovered: true,
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

Deno.test("runtime installation schedules no autonomous work before init", async () => {
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
      scheduledAtStart: { frames: 0, timers: 0 },
      timersAfterDetach: 0,
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
    await page.evaluate(async () => {
      const api = (window as unknown as { FacialRig: { init(): void; sync(): void } }).FacialRig;
      api.init();
      api.sync();

      (api as unknown as FacialRigApi).control({
        tag: "set",
        rigId: "avatar-rig-ios",
        sourceId: "game-state",
        sequence: 1,
        preset: "smile",
      });
      await new Promise(requestAnimationFrame);

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

Deno.test("controlled preset contact sheet stays visually deterministic at DPR 2", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 360, height: 180 },
      deviceScaleFactor: 2,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const avatar = createAvatarGenerator().forBot("mason-steady");
    assertEquals(avatar.kind, "bot");
    if (avatar.kind !== "bot") return;
    const bank = createRigControlBank(avatar);
    const rigs = RIG_CONTROL_PRESETS.map((preset) =>
      renderFacialRig({
        id: `visual-${preset}`,
        label: preset,
        matchScope: "contact-sheet",
        audioProfileId: "bot-test",
        reaction: null,
        precedingReaction: null,
        microReaction: null,
        personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 0 },
        rigKind: "bot",
        baseSvg: avatar.src,
        expressionSvg: avatar.emotions.focused,
        microSvg: avatar.emotions.focused,
        controlBank: bank,
      })
    ).join("");
    await page.setContent(
      `<style>` +
        `html,body{margin:0;background:#0f1413}` +
        `#sheet{display:grid;grid-template-columns:repeat(7,40px);gap:8px;padding:12px;` +
        `width:max-content;background:#0f1413}` +
        `.avatar-rig,.avatar{width:40px;height:40px}` +
        `.avatar-rig,.avatar-rig *{animation:none!important;transition:none!important}` +
        `</style><div id="sheet">${rigs}</div>`,
    );
    await loadFacialRig(page);
    await page.evaluate((presets) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      presets.forEach((preset, index) =>
        api.control({
          tag: "set",
          rigId: `avatar-rig-visual-${preset}`,
          sourceId: "contact-sheet",
          sequence: index + 1,
          preset,
          transitionMs: 0,
        })
      );
    }, RIG_CONTROL_PRESETS);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const screenshot = await page.locator("#sheet").screenshot({ animations: "disabled" });
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(screenshot)),
    );
    const hash = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const expectedHash = Deno.build.os === "darwin"
      ? "d301010bb4593e53ba2c1c9120d685dff795a96968a7842df334489e3ad95eec"
      : Deno.build.os === "linux"
      ? "8739c7ab9418c05b7841581f253d59afd13ee89727b5bd4f80f32b3e60f602e6"
      : undefined;
    if (expectedHash === undefined) {
      throw new Error(`missing controlled preset visual baseline for ${Deno.build.os}`);
    }
    assertEquals(hash, expectedHash, `controlled preset visual baseline on ${Deno.build.os}`);
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
