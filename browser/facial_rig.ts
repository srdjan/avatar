import {
  audioEnded,
  type AudioRequest,
  audioStarted,
  decideAudio,
  finiteClamp,
  initialAudioPolicy,
  initialRigState,
  type ReactionPayload,
  reduceRigSync,
  type RigEffect,
  type RigKind,
  type RigProtocol,
  type RigState,
  seedRigState,
} from "./runtime_core.ts";

type FrameSchedule =
  | Readonly<{ tag: "stopped" }>
  | Readonly<{ tag: "scheduled"; frameId: number }>;

type AudioLike = {
  ended: boolean;
  preload: string;
  src: string;
  volume: number;
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
  load(): void;
  pause(): void;
  play(): Promise<void> | undefined;
};

type AnalyserLike = {
  fftSize: number;
  frequencyBinCount: number;
  smoothingTimeConstant: number;
  connect(destination: unknown): void;
  getByteTimeDomainData(buffer: Uint8Array): void;
};

type AudioContextLike = {
  destination: unknown;
  state: string;
  createAnalyser(): AnalyserLike;
  createMediaElementSource(audio: AudioLike): Readonly<{ connect(destination: unknown): void }>;
  resume(): Promise<void>;
};

type BrowserCapabilities = Readonly<{
  document: Document;
  navigator: Navigator;
  matchMedia(query: string): MediaQueryList;
  now(): number;
  random(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(frameId: number): void;
  setTimer(callback: () => void, delayMs: number): number;
  clearTimer(timerId: number): void;
  createAudio(src: string): AudioLike;
  createAudioContext(): AudioContextLike | null;
}>;

type FacialRigConfig = Readonly<{
  audioAssets: Readonly<Record<string, string>>;
  silenceSrc: string;
  isAudioEnabled: () => boolean;
}>;

export type FacialRigApi = Readonly<{
  init(config?: Readonly<Record<string, unknown>>): void;
  prepareSwap(fragment: ParentNode): void;
  sync(): void;
  play(request: Readonly<Record<string, unknown>>): void;
  startSpeaking(rigId: string, cue: string, durationMs: number): void;
  stopSpeaking(rigId: string): void;
}>;

type RigTimers = {
  macroStart?: number;
  macroEnd?: number;
  microEnd?: number;
  speechFrame?: number;
  speechEnd?: number;
  speechClear?: number;
};

const MOTION_CLASSES = ["motion-pop", "motion-shake", "motion-sink"] as const;
const SPEAKING_CLASSES = [
  "speaking-gasp",
  "speaking-laugh",
  "speaking-sigh",
  "speaking-groan",
  "speaking-challenge",
] as const;
const AUDIO_TIMEOUT_MS = [2_000, 2_400, 3_200] as const;
const IDLE_PROPERTIES = [
  "--idle-blink-sy",
  "--idle-gaze-tx",
  "--idle-drift-tx",
  "--idle-brow-ty",
  "--idle-mouth-ty",
  "--idle-mouth-sx",
  "--idle-nose-sx",
  "--idle-nose-sy",
  "--idle-catchlight-ty",
  "--idle-catchlight-conv",
  "--rig-breath-tx",
  "--rig-breath-ty",
  "--rig-breath-rot",
  "--rig-breath-scale",
  "--rig-light-x",
  "--rig-light-y",
] as const;

const MACRO_POSES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  happiness: {
    ".face-eyes": "scaleY(0.72)",
    ".face-mouth": "translateY(-1px) scale(1.15)",
    ".face-brows": "translateY(-8px)",
  },
  sadness: {
    ".face-eyes": "scaleY(0.76)",
    ".face-mouth": "translateY(2px) scaleX(0.92)",
    ".face-brows": "translateY(5px)",
  },
  anger: {
    ".face-eyes": "translateX(-1px) scaleY(0.7)",
    ".face-mouth": "scaleX(0.9)",
    ".face-brows": "translateY(6px)",
  },
  fear: {
    ".face-eyes": "scaleY(1.5)",
    ".face-mouth": "scaleY(1.8)",
    ".face-brows": "translateY(-10px)",
  },
  surprise: {
    ".face-eyes": "scaleY(1.7)",
    ".face-mouth": "translateY(1px) scaleY(2)",
    ".face-brows": "translateY(-12px)",
  },
  focused: {
    ".face-eyes": "translateX(2px) scaleY(0.8)",
    ".face-mouth": "scaleX(0.95)",
    ".face-brows": "translateY(-4px)",
  },
};

const MICRO_POSES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  happiness: { ".face-mouth": "scale(1.1)", ".face-brows": "translateY(-5px)" },
  focused: { ".face-eyes": "translateX(2px)", ".face-brows": "translateY(-3px)" },
  neutral: { ".face-eyes": "translateX(-1px)" },
  sadness: { ".face-mouth": "translateY(1px) scaleX(0.96)" },
  anger: { ".face-brows": "translateY(4px)" },
  fear: { ".face-eyes": "scaleY(1.25)" },
  surprise: { ".face-eyes": "scaleY(1.35)", ".face-mouth": "scaleY(1.35)" },
};

export function createFacialRigRuntime(capabilities: BrowserCapabilities): FacialRigApi {
  const rigStatesById = new Map<string, RigState>();
  const rigTimers = new WeakMap<HTMLElement, RigTimers>();
  const blinkTimers = new WeakMap<HTMLElement, number>();
  let frame: FrameSchedule = { tag: "stopped" };
  let audioPolicy = initialAudioPolicy();
  let audioContext: AudioContextLike | null = null;
  let initialized = false;
  let gestureInstalled = false;
  let config: FacialRigConfig = {
    audioAssets: {},
    silenceSrc: "",
    isAudioEnabled: () => true,
  };

  function isIOSCompositorGuard(): boolean {
    return /iPad|iPhone|iPod/.test(capabilities.navigator.userAgent) ||
      capabilities.navigator.platform === "MacIntel" && capabilities.navigator.maxTouchPoints > 1;
  }

  function isReducedMotion(): boolean {
    return capabilities.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function canAnimate(): boolean {
    return !isIOSCompositorGuard() && !isReducedMotion() &&
      capabilities.document.visibilityState !== "hidden";
  }

  function timersFor(rig: HTMLElement): RigTimers {
    const current = rigTimers.get(rig);
    if (current !== undefined) return current;
    const created: RigTimers = {};
    rigTimers.set(rig, created);
    return created;
  }

  function clearTimer(timers: RigTimers, key: keyof RigTimers): void {
    const timerId = timers[key];
    if (timerId === undefined) return;
    if (key === "speechFrame") capabilities.cancelFrame(timerId);
    else capabilities.clearTimer(timerId);
    delete timers[key];
  }

  function readReaction(rig: HTMLElement, prefix: "reaction" | "preceding" | "micro") {
    const id = readFiniteNumber(rig.dataset[`${prefix}Id`], 0);
    const kind = rig.dataset[`${prefix}Kind`] ?? "";
    if (kind === "") return { tag: "none", id } as const;
    return {
      tag: "active",
      id,
      kind,
      expression: rig.dataset[`${prefix}Expression`] ?? "",
      intensity: finiteClamp(readFiniteNumber(rig.dataset[`${prefix}Intensity`], 1), 1, 3, 1),
      motion: rig.dataset[`${prefix}Motion`] ?? "",
      durationMs: Math.max(0, readFiniteNumber(rig.dataset[`${prefix}DurationMs`], 2_000)),
      confidence: finiteClamp(
        readFiniteNumber(rig.dataset[`${prefix}Confidence`], 1),
        0,
        1,
        1,
      ),
      voiceCue: rig.dataset[`${prefix}VoiceCue`] ?? "",
    } as const;
  }

  function readProtocol(rig: HTMLElement): RigProtocol {
    return {
      main: readReaction(rig, "reaction"),
      preceding: readReaction(rig, "preceding"),
      micro: readReaction(rig, "micro"),
    };
  }

  function rigKind(rig: HTMLElement): RigKind {
    return parseRigKind(rig.dataset.rigKind);
  }

  function startMacro(
    rig: HTMLElement,
    reaction: Extract<ReactionPayload, { tag: "active" }>,
  ): void {
    const timers = timersFor(rig);
    clearTimer(timers, "macroStart");
    clearTimer(timers, "macroEnd");
    rig.classList.remove(...MOTION_CLASSES);
    rig.classList.add("is-reacting");
    rig.style.setProperty("--reaction-duration-ms", `${reaction.durationMs}ms`);
    if (rigKind(rig) !== "human-photo" && canAnimate()) {
      const motionClass = `motion-${reaction.motion}`;
      if ((MOTION_CLASSES as ReadonlyArray<string>).includes(motionClass)) {
        rig.classList.add(motionClass);
      }
      applyPose(
        rig,
        ".avatar-expression",
        MACRO_POSES[reaction.expression] ?? {},
        reactionAmplitude(rig, reaction.confidence),
      );
    }
    if (reaction.voiceCue !== "") {
      play({
        cue: reaction.voiceCue,
        intensity: reaction.intensity,
        rigKind: rigKind(rig),
        rigId: rig.id,
        seatId: rig.id.replace(/^avatar-rig-/, ""),
        seatAudioProbability: readFiniteNumber(rig.dataset.seatAudioProbability, 1) *
          reaction.confidence,
      });
    }
    timers.macroEnd = capabilities.setTimer(() => {
      rig.classList.remove("is-reacting", ...MOTION_CLASSES);
      clearPose(rig, ".avatar-expression");
      delete timers.macroEnd;
    }, reaction.durationMs);
  }

  function startMicro(
    rig: HTMLElement,
    reaction: Extract<ReactionPayload, { tag: "active" }>,
  ): void {
    const timers = timersFor(rig);
    clearTimer(timers, "microEnd");
    rig.classList.add("is-micro-reacting");
    rig.style.setProperty("--micro-duration-ms", `${reaction.durationMs}ms`);
    if (rigKind(rig) !== "human-photo" && canAnimate()) {
      applyPose(
        rig,
        ".avatar-micro-expression",
        MICRO_POSES[reaction.expression] ?? {},
        reactionAmplitude(rig, reaction.confidence),
      );
    }
    timers.microEnd = capabilities.setTimer(() => {
      rig.classList.remove("is-micro-reacting");
      clearPose(rig, ".avatar-micro-expression");
      delete timers.microEnd;
    }, reaction.durationMs);
  }

  function interpret(rig: HTMLElement, effect: RigEffect): void {
    switch (effect.tag) {
      case "start-macro":
        startMacro(rig, effect.reaction);
        return;
      case "schedule-macro": {
        const timers = timersFor(rig);
        clearTimer(timers, "macroStart");
        timers.macroStart = capabilities.setTimer(
          () => startMacro(rig, effect.reaction),
          effect.delayMs,
        );
        return;
      }
      case "start-micro":
        startMicro(rig, effect.reaction);
        return;
    }
  }

  function syncRig(rig: HTMLElement): void {
    if (rig.id === "") return;
    const protocol = readProtocol(rig);
    const current = rigStatesById.get(rig.id);
    if (current === undefined) {
      rigStatesById.set(rig.id, seedRigState(protocol));
      if (canAnimate() && rigKind(rig) !== "human-photo") applyIdlePose(rig, capabilities.now());
      startBlinkLoop(rig);
      return;
    }
    const transition = reduceRigSync(current, protocol);
    rigStatesById.set(rig.id, transition.state);
    for (const effect of transition.effects) interpret(rig, effect);
    if (canAnimate() && rigKind(rig) !== "human-photo") applyIdlePose(rig, capabilities.now());
    startBlinkLoop(rig);
  }

  function sync(): void {
    const rigs = [...capabilities.document.querySelectorAll<HTMLElement>(".avatar-rig")];
    for (const rig of rigs) syncRig(rig);
    startAutonomousIdleLoop(rigs.some(isAnimatedRig));
  }

  function prepareSwap(fragment: ParentNode): void {
    if (fragment === null || typeof fragment.querySelectorAll !== "function") return;
    for (const incoming of fragment.querySelectorAll<HTMLElement>(".avatar-rig[id]")) {
      const live = capabilities.document.getElementById(incoming.id);
      if (!(live instanceof HTMLElement) || !live.classList.contains("avatar-rig")) continue;
      if (!sameRigSignature(live, incoming)) {
        clearRigTimers(live);
        live.replaceWith(incoming.cloneNode(true));
        continue;
      }
      const state = rigStatesById.get(live.id);
      const protocol = readProtocol(incoming);
      const preserveMacro = state !== undefined && live.classList.contains("is-reacting") &&
        protocol.main.id === state.seen.main &&
        protocol.preceding.id === state.seen.preceding;
      const preserveMicro = state !== undefined && live.classList.contains("is-micro-reacting") &&
        protocol.micro.id === state.seen.micro;
      copyRigProtocol(live, incoming);
      replaceLayer(live, incoming, ".avatar-expression", preserveMacro);
      replaceLayer(
        live,
        incoming,
        ".avatar-micro-expression",
        preserveMicro,
      );
    }
  }

  function startSpeaking(rigId: string, cue: string, durationMs: number): void {
    const rig = capabilities.document.getElementById(rigId);
    if (!(rig instanceof HTMLElement) || rigKind(rig) === "human-photo") return;
    if (speakingMouths(rig).length === 0) return;
    const timers = timersFor(rig);
    clearTimer(timers, "speechFrame");
    clearTimer(timers, "speechEnd");
    clearTimer(timers, "speechClear");
    clearSpeakingClasses(rig);
    const speakingClass = speakingClassFor(cue);
    rig.classList.add("is-speaking");
    if (speakingClass !== null) rig.classList.add(speakingClass);
    rigStatesById.set(rigId, {
      ...(rigStatesById.get(rigId) ?? initialRigState()),
      speech: { tag: "speaking" },
    });
    timers.speechEnd = capabilities.setTimer(() => stopSpeaking(rigId), durationMs);
    if (!canAnimate()) return;
    const now = capabilities.now();
    const tick = () => {
      const currentRig = capabilities.document.getElementById(rigId);
      if (!(currentRig instanceof HTMLElement)) return;
      const state = rigStatesById.get(rigId)?.speech;
      if (state?.tag !== "speaking") return;
      const elapsed = capabilities.now() - now;
      const transform = mouthEnvelope(cue, elapsed);
      for (const mouth of speakingMouths(currentRig)) mouth.style.transform = transform;
      timers.speechFrame = capabilities.requestFrame(tick);
    };
    tick();
  }

  function stopSpeaking(rigId: string): void {
    const rig = capabilities.document.getElementById(rigId);
    if (!(rig instanceof HTMLElement)) return;
    const timers = timersFor(rig);
    clearTimer(timers, "speechFrame");
    clearTimer(timers, "speechEnd");
    clearTimer(timers, "speechClear");
    clearSpeakingClasses(rig);
    rigStatesById.set(rigId, {
      ...(rigStatesById.get(rigId) ?? initialRigState()),
      speech: { tag: "fading" },
    });
    timers.speechClear = capabilities.setTimer(() => {
      for (const mouth of speakingMouths(rig)) mouth.style.removeProperty("transform");
      const state = rigStatesById.get(rigId) ?? initialRigState();
      rigStatesById.set(rigId, { ...state, speech: { tag: "silent" } });
      delete timers.speechClear;
    }, 180);
  }

  function play(input: Readonly<Record<string, unknown>>): void {
    const request = parseAudioRequest(input);
    const decision = decideAudio(audioPolicy, request, {
      audioEnabled: audioEnabled(config.isAudioEnabled),
      availableCues: new Set(Object.keys(config.audioAssets)),
      now: capabilities.now(),
      randomSample: capabilities.random(),
    });
    if (decision.tag === "rejected") return;
    audioPolicy = decision.nextState;
    const src = config.audioAssets[decision.cueKey];
    if (src === undefined) return;
    const rig = capabilities.document.getElementById(request.rigId);
    const detail = {
      cue: request.cue,
      src,
      durationMs: decision.durationMs,
      intensity: request.intensity,
      rigKind: request.rigKind,
      rigId: request.rigId,
      seatId: request.seatId,
      seatAudioProbability: request.seatAudioProbability,
    };
    if (rig !== null) {
      const event = new CustomEvent("facial-rig:voice-cue", {
        bubbles: true,
        cancelable: true,
        detail,
      });
      if (!rig.dispatchEvent(event)) return;
    }
    startAudio(request, src, decision.channelKey, decision.durationMs);
  }

  function startAudio(
    request: AudioRequest,
    src: string,
    channelKey: string,
    durationMs: number,
  ): void {
    const audio = capabilities.createAudio(src);
    audio.preload = "auto";
    audio.volume = finiteClamp(0.45 + request.intensity * 0.12, 0, 1, 0.6);
    audio.load();
    audioPolicy = audioStarted(audioPolicy, channelKey);
    let active = true;
    let timeoutId: number | undefined;
    let stopAnalyser: () => void = () => undefined;
    const clear = () => {
      if (!active) return;
      active = false;
      if (timeoutId !== undefined) capabilities.clearTimer(timeoutId);
      timeoutId = undefined;
      stopAnalyser();
      audioPolicy = audioEnded(audioPolicy, channelKey);
      stopSpeaking(request.rigId);
    };
    audio.addEventListener("ended", clear, { once: true });
    audio.addEventListener("error", clear, { once: true });
    timeoutId = capabilities.setTimer(() => {
      timeoutId = undefined;
      audio.pause();
      clear();
    }, audioTimeoutMs(request.intensity));
    const onStarted = () => {
      if (!active) return;
      startSpeaking(request.rigId, request.cue, durationMs);
      stopAnalyser = wireAnalyser(audio, request.rigId);
    };
    try {
      const playing = audio.play();
      if (playing === undefined) onStarted();
      else playing.then(onStarted).catch(clear);
    } catch {
      clear();
    }
  }

  function getAudioContext(): AudioContextLike | null {
    if (audioContext === null) audioContext = capabilities.createAudioContext();
    return audioContext;
  }

  function wireAnalyser(audio: AudioLike, rigId: string): () => void {
    const context = getAudioContext();
    if (context === null) return () => undefined;
    try {
      const source = context.createMediaElementSource(audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 32;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      analyser.connect(context.destination);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      let active = true;
      let frameId: number | null = null;
      const sample = () => {
        if (!active || audio.ended) return;
        analyser.getByteTimeDomainData(samples);
        const level = rmsLevel(samples);
        const rig = capabilities.document.getElementById(rigId);
        if (rig instanceof HTMLElement && canAnimate()) {
          for (const mouth of speakingMouths(rig)) {
            mouth.style.transform = `translateY(${(level * 1.5).toFixed(2)}px) scaleY(${
              (
                1 + level * 2
              ).toFixed(3)
            })`;
          }
        }
        frameId = capabilities.requestFrame(sample);
      };
      frameId = capabilities.requestFrame(sample);
      return () => {
        active = false;
        if (frameId !== null) capabilities.cancelFrame(frameId);
      };
    } catch {
      return () => undefined;
    }
  }

  function installGestureUnlock(): void {
    if (gestureInstalled) return;
    gestureInstalled = true;
    capabilities.document.addEventListener("click", () => {
      const context = getAudioContext();
      if (context?.state === "suspended") void context.resume();
      if (config.silenceSrc === "") return;
      const silence = capabilities.createAudio(config.silenceSrc);
      silence.preload = "auto";
      silence.load();
      const playing = silence.play();
      if (playing !== undefined) void playing.catch(() => undefined);
    }, { once: true });
  }

  function clearIdleStyles(): void {
    for (const rig of capabilities.document.querySelectorAll<HTMLElement>(".avatar-rig")) {
      for (const property of IDLE_PROPERTIES) rig.style.removeProperty(property);
    }
  }

  function clearRigTimers(rig: HTMLElement): void {
    const timers = rigTimers.get(rig);
    if (timers === undefined) return;
    for (const key of Object.keys(timers) as Array<keyof RigTimers>) clearTimer(timers, key);
    rigTimers.delete(rig);
  }

  function tickAutonomousIdle(time: number): void {
    if (!canAnimate()) {
      clearIdleStyles();
      frame = { tag: "stopped" };
      return;
    }
    const rigs = [...capabilities.document.querySelectorAll<HTMLElement>(".avatar-rig")]
      .filter(isAnimatedRig);
    if (rigs.length === 0) {
      frame = { tag: "stopped" };
      return;
    }
    for (const rig of rigs) applyIdlePose(rig, time);
    frame = { tag: "scheduled", frameId: capabilities.requestFrame(tickAutonomousIdle) };
  }

  function startAutonomousIdleLoop(hasAnimatedRig: boolean) {
    if (isIOSCompositorGuard()) return;
    if (frame.tag === "scheduled" || isReducedMotion() || !hasAnimatedRig) return;
    frame = { tag: "scheduled", frameId: capabilities.requestFrame(tickAutonomousIdle) };
  }

  function startBlinkLoop(rig: HTMLElement) {
    if (isIOSCompositorGuard()) return;
    if (isReducedMotion() || capabilities.document.visibilityState === "hidden") return;
    if (!isAnimatedRig(rig)) return;
    if (blinkTimers.has(rig)) return;
    const delay = 1_800 + capabilities.random() * 2_600;
    const timerId = capabilities.setTimer(() => {
      blinkTimers.delete(rig);
      if (!canAnimate() || !isAnimatedRig(rig)) return;
      if (!rig.classList.contains("is-reacting")) {
        rig.style.setProperty("--idle-blink-sy", "0.08");
        capabilities.setTimer(() => rig.style.setProperty("--idle-blink-sy", "1"), 130);
      }
      startBlinkLoop(rig);
    }, delay);
    blinkTimers.set(rig, timerId);
  }

  function init(input: Readonly<Record<string, unknown>> = {}): void {
    config = parseConfig(input, config);
    installGestureUnlock();
    if (initialized) return;
    initialized = true;
    capabilities.document.addEventListener("visibilitychange", () => {
      if (capabilities.document.visibilityState === "hidden") {
        if (frame.tag === "scheduled") capabilities.cancelFrame(frame.frameId);
        frame = { tag: "stopped" };
        clearIdleStyles();
      } else {
        sync();
      }
    });
    capabilities.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => {
      if (isReducedMotion()) clearIdleStyles();
      else sync();
    });
  }

  return { init, prepareSwap, sync, play, startSpeaking, stopSpeaking };
}

function parseConfig(input: Readonly<Record<string, unknown>>, current: FacialRigConfig) {
  const rawAssets = input.audioAssets;
  const audioAssets = rawAssets !== null && typeof rawAssets === "object"
    ? Object.fromEntries(
      Object.entries(rawAssets).filter((entry): entry is [string, string] =>
        typeof entry[1] === "string"
      ),
    )
    : current.audioAssets;
  return {
    audioAssets,
    silenceSrc: typeof input.silenceSrc === "string" ? input.silenceSrc : current.silenceSrc,
    isAudioEnabled: typeof input.isAudioEnabled === "function"
      ? input.isAudioEnabled as () => boolean
      : current.isAudioEnabled,
  };
}

function parseAudioRequest(input: Readonly<Record<string, unknown>>): AudioRequest {
  return {
    cue: typeof input.cue === "string" ? input.cue : "",
    intensity: readUnknownNumber(input.intensity, 1),
    rigKind: parseRigKind(input.rigKind),
    rigId: typeof input.rigId === "string" ? input.rigId : "",
    seatId: typeof input.seatId === "string" ? input.seatId : "",
    seatAudioProbability: readUnknownNumber(input.seatAudioProbability, 1),
  };
}

function parseRigKind(value: unknown): RigKind {
  return value === "bot" || value === "human-generated" || value === "human-photo"
    ? value
    : "unknown";
}

function isAnimatedRig(rig: HTMLElement): boolean {
  return rig.isConnected && parseRigKind(rig.dataset.rigKind) !== "human-photo";
}

function sameRigSignature(live: HTMLElement, incoming: HTMLElement): boolean {
  const liveSignature = live.dataset.rigSignature;
  return liveSignature !== undefined && liveSignature === incoming.dataset.rigSignature;
}

function copyRigProtocol(live: HTMLElement, incoming: HTMLElement): void {
  const protocolPrefixes = [
    "data-rig-",
    "data-seat-",
    "data-reaction-",
    "data-preceding-",
    "data-micro-",
  ];
  for (const attribute of [...live.attributes]) {
    if (
      protocolPrefixes.some((prefix) => attribute.name.startsWith(prefix)) &&
      !incoming.hasAttribute(attribute.name)
    ) {
      live.removeAttribute(attribute.name);
    }
  }
  for (const attribute of [...incoming.attributes]) {
    if (protocolPrefixes.some((prefix) => attribute.name.startsWith(prefix))) {
      live.setAttribute(attribute.name, attribute.value);
    }
  }
  const amplitude = incoming.style.getPropertyValue("--seat-amplitude-scale");
  if (amplitude === "") live.style.removeProperty("--seat-amplitude-scale");
  else live.style.setProperty("--seat-amplitude-scale", amplitude);
}

function replaceLayer(
  live: HTMLElement,
  incoming: HTMLElement,
  selector: string,
  preserve: boolean,
): void {
  if (preserve) return;
  const currentLayer = live.querySelector(selector);
  const incomingLayer = incoming.querySelector(selector);
  if (currentLayer !== null && incomingLayer !== null) {
    currentLayer.replaceWith(incomingLayer.cloneNode(true));
  }
}

function applyPose(
  rig: HTMLElement,
  layerSelector: string,
  pose: Readonly<Record<string, string>>,
  amplitude: number,
): void {
  const layer = rig.querySelector(layerSelector);
  if (layer === null) return;
  for (const [selector, transform] of Object.entries(pose)) {
    for (const feature of layer.querySelectorAll<SVGElement>(selector)) {
      feature.style.transform = scaleTransformFromNeutral(transform, amplitude);
    }
  }
}

function reactionAmplitude(rig: HTMLElement, confidence: number): number {
  const rawAmplitude = Number.parseFloat(
    rig.style.getPropertyValue("--seat-amplitude-scale") || "1",
  );
  const amplitude = Number.isFinite(rawAmplitude) ? rawAmplitude : 1;
  return amplitude * confidence;
}

function scaleTransformFromNeutral(transform: string, amplitude: number): string {
  const translated = transform.replace(
    /translate([XY])\((-?(?:\d+(?:\.\d+)?|\.\d+))px\)/g,
    (_match, axis: string, value: string) =>
      `translate${axis}(${formatTransformNumber(Number(value) * amplitude)}px)`,
  );
  return translated.replace(
    /scale([XY]?)\((-?(?:\d+(?:\.\d+)?|\.\d+))\)/g,
    (_match, axis: string, value: string) => {
      const scaled = 1 + (Number(value) - 1) * amplitude;
      return `scale${axis}(${formatTransformNumber(scaled)})`;
    },
  );
}

function formatTransformNumber(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function clearPose(rig: HTMLElement, layerSelector: string): void {
  for (
    const feature of rig.querySelectorAll<SVGElement>(
      `${layerSelector} .face-eyes, ${layerSelector} .face-mouth, ${layerSelector} .face-brows`,
    )
  ) {
    feature.style.removeProperty("transform");
  }
}

function applyIdlePose(rig: HTMLElement, now: number): void {
  const phase = now / 1_400;
  rig.style.setProperty("--idle-gaze-tx", `${(Math.sin(phase * 0.43) * 0.8).toFixed(2)}px`);
  rig.style.setProperty("--idle-drift-tx", `${(Math.sin(phase * 0.31) * 0.45).toFixed(2)}px`);
  rig.style.setProperty("--idle-brow-ty", `${(Math.sin(phase * 0.23) * 0.35).toFixed(2)}px`);
  rig.style.setProperty("--idle-mouth-ty", `${(Math.sin(phase * 0.37) * 0.25).toFixed(2)}px`);
  rig.style.setProperty("--idle-mouth-sx", (1 + Math.sin(phase * 0.29) * 0.01).toFixed(4));
  rig.style.setProperty("--idle-nose-sx", (1 + Math.sin(phase * 0.41) * 0.008).toFixed(4));
  rig.style.setProperty("--idle-nose-sy", (1 + Math.cos(phase * 0.41) * 0.01).toFixed(4));
  rig.style.setProperty("--rig-breath-ty", `${(Math.sin(phase) * 0.6).toFixed(2)}px`);
  rig.style.setProperty("--rig-breath-rot", `${(Math.sin(phase * 0.57) * 0.18).toFixed(2)}deg`);
  rig.style.setProperty("--rig-breath-scale", (1 + Math.sin(phase) * 0.004).toFixed(4));
  rig.style.setProperty("--rig-light-x", `${(Math.cos(phase * 0.19) * 0.5).toFixed(2)}px`);
  rig.style.setProperty("--rig-light-y", `${(Math.sin(phase * 0.19) * 0.35).toFixed(2)}px`);
}

function speakingMouths(rig: HTMLElement): SVGElement[] {
  return [...rig.querySelectorAll<SVGElement>(
    ".avatar-base .face-mouth, .avatar-expression .face-mouth",
  )];
}

function speakingClassFor(cue: string): string | null {
  const candidate = `speaking-${cue}`;
  return (SPEAKING_CLASSES as ReadonlyArray<string>).includes(candidate) ? candidate : null;
}

function clearSpeakingClasses(rig: HTMLElement): void {
  rig.classList.remove("is-speaking", ...SPEAKING_CLASSES);
}

function mouthEnvelope(cue: string, elapsed: number): string {
  const amplitude = cue === "laugh" || cue === "challenge" ? 0.28 : cue === "gasp" ? 0.36 : 0.18;
  const wave = Math.abs(Math.sin(elapsed / 42));
  return `translateY(${(wave * amplitude * 2).toFixed(2)}px) scaleY(${
    (
      1 + wave * amplitude
    ).toFixed(3)
  })`;
}

function rmsLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / samples.length);
}

function audioEnabled(configured: () => boolean): boolean {
  try {
    return configured();
  } catch {
    return false;
  }
}

function audioTimeoutMs(intensity: number): number {
  const index = Number.isInteger(intensity) && intensity >= 1 && intensity <= 3 ? intensity - 1 : 0;
  return AUDIO_TIMEOUT_MS[index] ?? AUDIO_TIMEOUT_MS[0];
}

function readFiniteNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  return readUnknownNumber(value, fallback);
}

function readUnknownNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Number(value)
    : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

type RuntimeWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

function defaultCapabilities(target: RuntimeWindow): BrowserCapabilities {
  const AudioContextConstructor = target.AudioContext ??
    target.webkitAudioContext;
  return {
    document: target.document,
    navigator: target.navigator,
    matchMedia: (query) => target.matchMedia(query),
    now: () => Date.now(),
    random: () => Math.random(),
    requestFrame: (callback) => target.requestAnimationFrame(callback),
    cancelFrame: (frameId) => target.cancelAnimationFrame(frameId),
    setTimer: (callback, delayMs) => target.setTimeout(callback, delayMs),
    clearTimer: (timerId) => target.clearTimeout(timerId),
    createAudio: (src) => new target.Audio(src) as unknown as AudioLike,
    createAudioContext: () =>
      AudioContextConstructor === undefined
        ? null
        : new AudioContextConstructor() as unknown as AudioContextLike,
  };
}

function install(target: RuntimeWindow): void {
  const api = createFacialRigRuntime(defaultCapabilities(target));
  (target as unknown as { FacialRig: FacialRigApi }).FacialRig = api;
  const start = () => {
    api.init();
    api.sync();
  };
  if (target.document.readyState === "loading") {
    target.document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") install(window);
