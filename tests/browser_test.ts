import { assertEquals } from "jsr:@std/assert@1.0.14";
import type { ReactionSpec } from "@srdjan/avatar";
import { AVATAR_ASSETS } from "@srdjan/avatar/assets";
import { renderFacialRig } from "@srdjan/avatar/server";
import { chromium, type Page } from "npm:playwright@1.60.0";

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
    personality: PERSONALITY,
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
  const browser = await chromium.launch({ headless: true });
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

Deno.test("browser runtime animates an AI turn rig without consumer coupling", async () => {
  const browser = await chromium.launch({ headless: true });
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
    await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });
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

Deno.test("SSR output drives reactions and preserves only matching rig substrates", async () => {
  const browser = await chromium.launch({ headless: true });
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
    await page.setContent(renderBotRig() + generated + photo);
    await loadFacialRig(page);

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

    const layerIdentity = await page.evaluate((html) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const rig = document.querySelector<HTMLElement>("#avatar-rig-east")!;
      rig.classList.add("is-reacting", "is-micro-reacting");
      const expression = rig.querySelector<SVGElement>(".avatar-expression")!;
      const micro = rig.querySelector<SVGElement>(".avatar-micro-expression")!;
      expression.dataset.layerMarker = "expression";
      micro.dataset.layerMarker = "micro";
      const prepare = (incomingHtml: string, removeExpression = false) => {
        const template = document.createElement("template");
        template.innerHTML = incomingHtml;
        if (removeExpression) template.content.querySelector(".avatar-expression")?.remove();
        api.prepareSwap(template.content);
      };
      prepare(html);
      const active = {
        expression: rig.querySelector<SVGElement>(".avatar-expression")?.dataset.layerMarker,
        micro: rig.querySelector<SVGElement>(".avatar-micro-expression")?.dataset.layerMarker,
      };
      rig.classList.remove("is-reacting", "is-micro-reacting");
      prepare(html);
      const inactive = {
        expression: rig.querySelector<SVGElement>(".avatar-expression")?.dataset.layerMarker ??
          null,
        micro: rig.querySelector<SVGElement>(".avatar-micro-expression")?.dataset.layerMarker ??
          null,
      };
      rig.querySelector<SVGElement>(".avatar-expression")!.dataset.missingMarker = "preserved";
      prepare(html, true);
      const missingExpression = rig.querySelector<SVGElement>(".avatar-expression")?.dataset
        .missingMarker;
      return { active, inactive, missingExpression };
    }, incoming);
    assertEquals(layerIdentity, {
      active: { expression: "expression", micro: "micro" },
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
  const browser = await chromium.launch({ headless: true });
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
  const browser = await chromium.launch({ headless: true });
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
      preloaded: 6,
      silencePlayed: true,
      speaking: true,
      speakingAfterFinish: false,
      analyserSampled: true,
      contextResumed: true,
      decisionMatrixInstances: 5,
      voiceInstances: 3,
    });
  } finally {
    await browser.close();
  }
});

Deno.test("speaking fades cleanly and reduced motion suppresses runtime feature writes", async () => {
  const browser = await chromium.launch({ headless: true });
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
    const reducedState = await page.evaluate((html) => {
      const api = (window as unknown as { FacialRig: FacialRigApi }).FacialRig;
      const template = document.createElement("template");
      template.innerHTML = html;
      api.prepareSwap(template.content);
      api.sync();
      const rig = document.querySelector<HTMLElement>("#avatar-rig-east")!;
      rig.classList.add("is-speaking");
      api.startSpeaking("avatar-rig-east", "challenge", 240);
      return {
        reacting: rig.classList.contains("is-reacting"),
        motion: rig.classList.contains("motion-shake"),
        featureTransforms: [...rig.querySelectorAll<SVGElement>(".face-mouth")]
          .map((mouth) => mouth.style.transform),
      };
    }, reducedIncoming);
    assertEquals(reducedState, {
      reacting: true,
      motion: false,
      featureTransforms: ["", "", ""],
    });
  } finally {
    await browser.close();
  }
});

Deno.test("standalone CSS preserves consumer tokens and supplies defaults", async () => {
  const browser = await chromium.launch({ headless: true });
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
  const browser = await chromium.launch({ headless: true });
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
  const browser = await chromium.launch({ headless: true });
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
