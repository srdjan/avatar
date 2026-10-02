import {
  audioEnded,
  type AudioRequest,
  audioStarted,
  compileRigControlPose,
  decideAudio,
  finiteClamp,
  initialAudioPolicy,
  initialRigControlState,
  type ParsedRigControlCommand,
  parseRigControlCommand,
  parseSerializedRigProtocol,
  reduceRigControl,
  reduceRigSync,
  type ResolvedSemanticAudioCandidate,
  type RigControlEffect,
  type RigControlState,
  type RigEffect,
  type RigKind,
  type RigState,
  seedRigState,
  setRigRenderedBaseline,
  validateCharacterAudioProfiles,
} from "./runtime_core.ts";
import type {
  CharacterAudioProfileCatalog,
  FacialReaction,
  FacialReactionState,
  FacialRigApi,
  FacialRigInitConfig,
  FacialRigInitReceipt,
  FacialRigSemanticAudioDetail,
  RigControlArtwork,
  RigControlCapabilities,
  RigControlCapability,
  RigControlCommand,
  RigControlFeature,
  RigControlFeatureValues,
  RigControlPreset,
  RigControlReceipt,
  RigControlRejectionReason,
} from "../types.ts";

export type { FacialRigApi } from "../types.ts";

type FrameSchedule =
  | Readonly<{ tag: "stopped" }>
  | Readonly<{ tag: "scheduled"; frameId: number }>;

type AudioLike = {
  ended: boolean;
  volume: number;
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: () => void): void;
  pause(): void;
  play(): Promise<void> | undefined;
};

type AnalyserLike = {
  fftSize: number;
  frequencyBinCount: number;
  smoothingTimeConstant: number;
  connect(destination: unknown): void;
  disconnect?(): void;
  getByteTimeDomainData(buffer: Uint8Array): void;
};

type AudioContextLike = {
  destination: unknown;
  state: string;
  createAnalyser(): AnalyserLike;
  createMediaElementSource(audio: AudioLike): Readonly<{
    connect(destination: unknown): void;
    disconnect?(): void;
  }>;
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
  audioProfiles: CharacterAudioProfileCatalog;
  silenceSrc: string;
  isAudioEnabled: () => boolean;
}>;

type SpeechActivity = "silent" | "speaking" | "fading";

type RigTimers = {
  macroStart?: number;
  macroEnd?: number;
  microEnd?: number;
  speechFrame?: number;
  speechEnd?: number;
  speechClear?: number;
  controlCleanup?: number;
  gestureFrame?: number;
  gestureEnd?: number;
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
const RIG_KINDS = ["bot", "human-generated", "human-photo"] as const;
const SPEECH_CUE_BY_FAMILY = {
  Happiness: "laugh",
  Laughter: "laugh",
  Sadness: "sigh",
  Worry: "gasp",
  Surprise: "gasp",
  Anger: "groan",
} as const satisfies Readonly<Record<AudioRequest["family"], string>>;
const SPEECH_AMPLITUDE_BY_CUE: Readonly<Record<string, number>> = {
  laugh: 0.28,
  challenge: 0.28,
  gasp: 0.36,
};
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

const EXPRESSION_BY_REACTION_STATE = {
  neutral: "neutral",
  focused: "focused",
  smile: "happiness",
  sad: "sadness",
  worry: "fear",
  mad: "anger",
  surprised: "surprise",
} as const satisfies Readonly<Record<FacialReactionState, string>>;

export function createFacialRigRuntime(capabilities: BrowserCapabilities): FacialRigApi {
  const rigStatesById = new Map<string, RigState>();
  const rigElementsById = new Map<string, HTMLElement>();
  const controlStatesById = new Map<string, RigControlState>();
  const pendingControlById = new Map<
    string,
    Extract<ParsedRigControlCommand, { tag: "set" }>
  >();
  const rigTimers = new WeakMap<HTMLElement, RigTimers>();
  const blinkTimers = new WeakMap<HTMLElement, number>();
  const speechByRigId = new Map<string, SpeechActivity>();
  const activeAudioByRigId = new Map<string, () => void>();
  const activeGestureByRigId = new Map<
    string,
    Extract<FacialReaction, { gesture: "laugh" }>
  >();
  let frame: FrameSchedule = { tag: "stopped" };
  let controlFrame: FrameSchedule = { tag: "stopped" };
  let audioPolicy = initialAudioPolicy();
  let audioContext: AudioContextLike | null = null;
  let initialized = false;
  let gestureInstalled = false;
  let config: FacialRigConfig | null = null;

  function isIOSCompositorGuard(): boolean {
    return /iPad|iPhone|iPod/.test(capabilities.navigator.userAgent) ||
      (capabilities.navigator.platform === "MacIntel" &&
        capabilities.navigator.maxTouchPoints > 1);
  }

  function isReducedMotion(): boolean {
    return capabilities.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function canAnimate(): boolean {
    return !isIOSCompositorGuard() &&
      !isReducedMotion() &&
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
    if (key === "speechFrame" || key === "gestureFrame") capabilities.cancelFrame(timerId);
    else capabilities.clearTimer(timerId);
    delete timers[key];
  }

  function readProtocol(rig: HTMLElement) {
    return parseSerializedRigProtocol({
      matchScope: rig.getAttribute("data-match-scope"),
      audioProfileId: rig.getAttribute("data-audio-profile-id"),
      reaction: rig.getAttribute("data-reaction"),
      precedingReaction: rig.getAttribute("data-preceding-reaction"),
      microReaction: rig.getAttribute("data-micro-reaction"),
    });
  }

  function rigKind(rig: HTMLElement): RigKind {
    return parseRigKind(rig.dataset.rigKind);
  }

  function startMacro(
    rig: HTMLElement,
    reaction: FacialReaction,
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
        MACRO_POSES[EXPRESSION_BY_REACTION_STATE[reaction.state]] ?? {},
        reactionAmplitude(rig, reaction.confidence),
      );
    }
    if (reaction.gesture === "laugh") startReactionGesture(rig, reaction);
    timers.macroEnd = capabilities.setTimer(() => {
      rig.classList.remove("is-reacting", ...MOTION_CLASSES);
      clearPose(rig, ".avatar-expression");
      delete timers.macroEnd;
    }, reaction.durationMs);
  }

  function startMicro(
    rig: HTMLElement,
    reaction: FacialReaction,
  ): void {
    const timers = timersFor(rig);
    clearTimer(timers, "microEnd");
    rig.classList.add("is-micro-reacting");
    rig.style.setProperty("--micro-duration-ms", `${reaction.durationMs}ms`);
    if (rigKind(rig) !== "human-photo" && canAnimate()) {
      applyPose(
        rig,
        ".avatar-micro-expression",
        MICRO_POSES[EXPRESSION_BY_REACTION_STATE[reaction.state]] ?? {},
        reactionAmplitude(rig, reaction.confidence),
      );
    }
    if (reaction.gesture === "laugh") startReactionGesture(rig, reaction);
    timers.microEnd = capabilities.setTimer(() => {
      rig.classList.remove("is-micro-reacting");
      clearPose(rig, ".avatar-micro-expression");
      delete timers.microEnd;
    }, reaction.durationMs);
  }

  function presentReaction(
    rig: HTMLElement,
    reaction: FacialReaction,
    audio: ResolvedSemanticAudioCandidate | null,
    visual: (rig: HTMLElement, reaction: FacialReaction) => void,
  ): void {
    visual(rig, reaction);
    const audioActions = [
      () => undefined,
      () => admitSemanticAudio(rig, reaction, audio as ResolvedSemanticAudioCandidate),
    ] as const;
    audioActions[Number(audio !== null)]!();
  }

  const effectHandlers: Readonly<
    Record<RigEffect["tag"], (rig: HTMLElement, effect: RigEffect) => void>
  > = {
    "start-macro": (rig, effect) => {
      presentReaction(rig, effect.reaction, effect.audio, startMacro);
    },
    "schedule-macro": (rig, effect) => {
      const scheduled = effect as Extract<RigEffect, { tag: "schedule-macro" }>;
      const timers = timersFor(rig);
      clearTimer(timers, "macroStart");
      timers.macroStart = capabilities.setTimer(
        () => presentReaction(rig, scheduled.reaction, scheduled.audio, startMacro),
        scheduled.delayMs,
      );
    },
    "start-micro": (rig, effect) => {
      presentReaction(rig, effect.reaction, effect.audio, startMicro);
    },
  };

  function interpret(rig: HTMLElement, effect: RigEffect): void {
    effectHandlers[effect.tag](rig, effect);
  }

  function restingStateFor(rigId: string): FacialReactionState {
    const affect = (controlStatesById.get(rigId) ?? initialRigControlState()).affect;
    return Object.assign({ preset: "neutral" as FacialReactionState }, affect).preset;
  }

  function syncRig(rig: HTMLElement): void {
    const activeConfig = config;
    try {
      ensureRuntime(rig.id !== "" && activeConfig !== null);
      const validConfig = activeConfig as FacialRigConfig;
      const parsed = readProtocol(rig);
      ensureRuntime(parsed.tag === "accepted");
      const protocol = parsed.protocol;
      const current = rigStatesById.get(rig.id);
      const restingState = restingStateFor(rig.id);
      const transitioners = [
        () => reduceRigSync(current as RigState, protocol, validConfig.audioProfiles, restingState),
        () => seedRigState(protocol, validConfig.audioProfiles, restingState),
      ] as const;
      const transition = transitioners[Number(current === undefined)]!();
      ensureRuntime(transition.tag === "accepted");
      rigStatesById.set(rig.id, transition.state);
      rigElementsById.set(rig.id, rig);
      transition.effects.forEach((effect) => interpret(rig, effect));
      const idleActions = [
        () => undefined,
        () => applyIdlePose(rig, capabilities.now()),
      ] as const;
      idleActions[Number(canAnimate() && rigKind(rig) !== "human-photo")]!();
      startBlinkLoop(rig);
    } catch (reason) {
      // Invalid rendered protocol is ignored without mutating the live rig.
      ignoreBrowserFailure(reason);
    }
  }

  function sync(): void {
    if (config === null) return;
    const rigs = [...capabilities.document.querySelectorAll<HTMLElement>(".avatar-rig")];
    pruneRigState(rigs);
    rigs.forEach(syncRig);
    startAutonomousIdleLoop(rigs.some(isAnimatedRig));
  }

  function prepareIncomingSwap(
    incoming: HTMLElement,
    activeConfig: FacialRigConfig,
  ): void {
    try {
      const live = capabilities.document.getElementById(incoming.id);
      ensureRuntime(live instanceof HTMLElement && live.classList.contains("avatar-rig"));
      const activeRig = live as HTMLElement;
      const parsed = readProtocol(incoming);
      ensureRuntime(parsed.tag === "accepted");
      const protocol = parsed.protocol;
      const state = rigStatesById.get(activeRig.id);
      const restingState = restingStateFor(activeRig.id);
      const matchingSignature = () => {
        const previews = [
          () =>
            reduceRigSync(
              state as RigState,
              protocol,
              activeConfig.audioProfiles,
              restingState,
            ),
          () => seedRigState(protocol, activeConfig.audioProfiles, restingState),
        ] as const;
        ensureRuntime(previews[Number(state === undefined)]!().tag === "accepted");
        const ledger = Object.assign(
          { ledger: new Map<string, FacialReaction>() as ReadonlyMap<string, FacialReaction> },
          state,
        ).ledger;
        const macroIdentityPresent = [protocol.preceding, protocol.main]
          .filter((reaction): reaction is FacialReaction => reaction !== null)
          .some((reaction) => ledger.has(reaction.identity));
        const microIdentityPresent = [protocol.micro]
          .filter((reaction): reaction is FacialReaction => reaction !== null)
          .some((reaction) => ledger.has(reaction.identity));
        const preserveMacro = state !== undefined &&
          activeRig.classList.contains("is-reacting") &&
          macroIdentityPresent;
        const preserveMicro = state !== undefined &&
          activeRig.classList.contains("is-micro-reacting") &&
          microIdentityPresent;
        copyRigProtocol(activeRig, incoming);
        replaceLayer(activeRig, incoming, ".avatar-expression", preserveMacro);
        replaceLayer(activeRig, incoming, ".avatar-micro-expression", preserveMicro);
      };
      const changedSignature = () => {
        ensureRuntime(
          seedRigState(protocol, activeConfig.audioProfiles, restingState).tag === "accepted",
        );
        clearRigResources(activeRig);
        activeRig.replaceWith(incoming.cloneNode(true));
      };
      [changedSignature, matchingSignature][Number(sameRigSignature(activeRig, incoming))]!();
    } catch (reason) {
      // Invalid or stale incoming rigs are left for the normal swap path.
      ignoreBrowserFailure(reason);
    }
  }

  function prepareSwap(fragment: unknown): void {
    const activeConfig = config;
    try {
      const queryRoot = fragment as ParentNode | null;
      ensureRuntime(
        activeConfig !== null &&
          queryRoot !== null &&
          typeof queryRoot.querySelectorAll === "function",
      );
      const validConfig = activeConfig as FacialRigConfig;
      (queryRoot as ParentNode).querySelectorAll<HTMLElement>(".avatar-rig[id]")
        .forEach((incoming) => prepareIncomingSwap(incoming, validConfig));
    } catch (reason) {
      // Non-fragment inputs and calls before initialization are ignored.
      ignoreBrowserFailure(reason);
    }
  }

  function control(input: RigControlCommand): RigControlReceipt {
    const parsed = parseRigControlCommand(input);
    if (parsed.tag === "rejected") return rejectedControlReceipt(parsed.reason, input);
    const command = parsed.command;
    const rig = capabilities.document.getElementById(command.rigId);
    if (
      !(rig instanceof HTMLElement) || !rig.classList.contains("avatar-rig") ||
      rigKind(rig) === "unknown"
    ) {
      return rejectedControlReceipt("rig-not-found", command);
    }
    rigElementsById.set(rig.id, rig);
    const transition = reduceRigControl(
      controlStatesById.get(rig.id) ?? initialRigControlState(),
      command,
    );
    if (transition.decision.tag === "rejected") {
      return rejectedControlReceipt(transition.decision.reason, command);
    }
    controlStatesById.set(rig.id, transition.state);
    const reactionState = rigStatesById.get(rig.id);
    if (reactionState !== undefined) {
      rigStatesById.set(
        rig.id,
        setRigRenderedBaseline(
          reactionState,
          command.tag === "set" ? command.preset : "neutral",
        ),
      );
    }
    transition.effects.forEach((effect) => interpretControl(rig, effect));
    return acceptedControlReceipt(rig, command);
  }

  function interpretControl(rig: HTMLElement, effect: RigControlEffect): void {
    switch (effect.tag) {
      case "set-affect":
        pendingControlById.set(rig.id, effect.command);
        scheduleControlFrame();
        return;
      case "release-affect":
        pendingControlById.delete(rig.id);
        if (activeGestureByRigId.has(rig.id)) return;
        clearControlVisual(rig, scaledControlDuration(rig, effect.transitionMs));
        return;
    }
  }

  function scheduleControlFrame(): void {
    if (capabilities.document.visibilityState === "hidden" || controlFrame.tag === "scheduled") {
      return;
    }
    controlFrame = {
      tag: "scheduled",
      frameId: capabilities.requestFrame(flushControlFrame),
    };
  }

  function flushControlFrame(): void {
    controlFrame = { tag: "stopped" };
    const pending = [...pendingControlById.entries()];
    pendingControlById.clear();
    for (const [rigId, command] of pending) {
      const rig = capabilities.document.getElementById(rigId);
      if (!(rig instanceof HTMLElement) || !rig.classList.contains("avatar-rig")) continue;
      if (rig.classList.contains("is-control-gesturing")) continue;
      applyControlSet(rig, command);
    }
  }

  function applyControlSet(
    rig: HTMLElement,
    command: Extract<ParsedRigControlCommand, { tag: "set" }>,
  ): void {
    applyControlVisual(
      rig,
      command.preset,
      command.preset,
      command.features,
      scaledControlDuration(rig, command.transitionMs),
    );
  }

  function applyControlVisual(
    rig: HTMLElement,
    artwork: RigControlArtwork,
    recipe: RigControlPreset,
    features: RigControlFeatureValues,
    transitionMs: number,
  ): void {
    clearTimer(timersFor(rig), "controlCleanup");
    rig.classList.remove("is-control-releasing");
    rig.dataset.controlPreset = artwork;
    rig.style.setProperty("--control-transition-ms", `${transitionMs}ms`);
    const pose = compileRigControlPose(recipe, features, reactionAmplitude(rig, 1));
    rig.style.setProperty(
      "--control-eyes-transform",
      `translateY(${formatTransformNumber(pose.eyes.translateY)}px) scaleY(${
        formatTransformNumber(pose.eyes.scaleY)
      })`,
    );
    rig.style.setProperty(
      "--control-brows-transform",
      `translateY(${formatTransformNumber(pose.brows.translateY)}px) scaleY(${
        formatTransformNumber(pose.brows.scaleY)
      })`,
    );
    rig.style.setProperty(
      "--control-mouth-transform",
      `translateY(${formatTransformNumber(pose.mouth.translateY)}px) scaleX(${
        formatTransformNumber(pose.mouth.scaleX)
      }) scaleY(${formatTransformNumber(pose.mouth.scaleY)})`,
    );
    rig.style.setProperty("--control-layer-x", `${formatTransformNumber(pose.layer.translateX)}px`);
    rig.style.setProperty("--control-layer-y", `${formatTransformNumber(pose.layer.translateY)}px`);
    rig.style.setProperty("--control-layer-roll", `${formatTransformNumber(pose.layer.rotate)}deg`);
    rig.style.setProperty("--control-layer-scale", formatTransformNumber(pose.layer.scale));
    rig.classList.add("is-control-active");
    activateControlArtwork(rig, artwork, transitionMs);
  }

  function activateControlArtwork(
    rig: HTMLElement,
    artwork: RigControlArtwork,
    transitionMs: number,
  ): void {
    const template = rig.querySelector<HTMLTemplateElement>(
      `:scope > template.avatar-control-layer[data-control-layer~="${artwork}"]`,
    );
    if (template === null) {
      rig.classList.remove("has-control-artwork");
      removeControlLayers(rig);
      return;
    }
    rig.classList.add("has-control-artwork");
    const current = rig.querySelector<HTMLElement | SVGElement>(
      ":scope > .avatar-control-expression.is-control-current",
    );
    if (current?.dataset.controlPreset === artwork) return;
    rig.querySelectorAll(":scope > .avatar-control-expression.is-control-outgoing")
      .forEach((outgoing) => outgoing.remove());
    if (current !== null) {
      current.classList.remove("is-control-current");
      current.classList.add("is-control-outgoing");
    }
    const clone = template.content.firstElementChild?.cloneNode(true);
    if (!(clone instanceof HTMLElement) && !(clone instanceof SVGElement)) return;
    clone.dataset.controlPreset = artwork;
    const macro = rig.querySelector(":scope > .avatar-expression");
    rig.insertBefore(clone, macro);
    void clone.getBoundingClientRect();
    clone.classList.add("is-control-current");
    const timers = timersFor(rig);
    clearTimer(timers, "controlCleanup");
    if (current === null) return;
    if (transitionMs === 0) {
      current.remove();
      return;
    }
    timers.controlCleanup = capabilities.setTimer(() => {
      current.remove();
      delete timers.controlCleanup;
    }, transitionMs);
  }

  function startReactionGesture(
    rig: HTMLElement,
    reaction: Extract<FacialReaction, { gesture: "laugh" }>,
  ): void {
    const timers = timersFor(rig);
    clearTimer(timers, "gestureFrame");
    clearTimer(timers, "gestureEnd");
    activeGestureByRigId.set(rig.id, reaction);
    rig.classList.add("is-control-gesturing");
    const transitionMs = scaledControlDuration(rig, 100);
    applyControlVisual(rig, "laugh", "smile", {
      eyeSquint: 0.75,
      cheekRaise: 0.85,
      mouthCornerLift: 1,
      jawOpen: 0.8,
    }, transitionMs);
    const durationMs = scaledControlHoldDuration(rig, reaction.durationMs);
    const startedAt = capabilities.now();
    const tick = () => {
      if (activeGestureByRigId.get(rig.id)?.identity !== reaction.identity || !rig.isConnected) {
        return;
      }
      const progress = finiteClamp((capabilities.now() - startedAt) / durationMs, 0, 1, 1);
      const envelope = Math.sin(progress * Math.PI);
      const beat = Math.abs(Math.sin(progress * Math.PI * 4)) * envelope *
        (reaction.intensity / 3);
      rig.style.setProperty("--control-gesture-y", `${(-beat * 2).toFixed(3)}px`);
      rig.style.setProperty("--control-gesture-scale", (1 + beat * 0.035).toFixed(4));
      if (progress < 1) timers.gestureFrame = capabilities.requestFrame(tick);
    };
    if (canAnimate()) tick();
    timers.gestureEnd = capabilities.setTimer(
      () => finishReactionGesture(rig, reaction.identity),
      durationMs,
    );
  }

  function finishReactionGesture(rig: HTMLElement, identity: string): void {
    if (activeGestureByRigId.get(rig.id)?.identity !== identity) return;
    activeGestureByRigId.delete(rig.id);
    const timers = timersFor(rig);
    clearTimer(timers, "gestureFrame");
    clearTimer(timers, "gestureEnd");
    rig.classList.remove("is-control-gesturing");
    rig.style.removeProperty("--control-gesture-y");
    rig.style.removeProperty("--control-gesture-scale");
    const affect = controlStatesById.get(rig.id)?.affect ?? null;
    if (affect === null) clearControlVisual(rig, scaledControlDuration(rig, 100));
    else applyControlSet(rig, affect);
  }

  function clearControlVisual(rig: HTMLElement, transitionMs: number): void {
    const timers = timersFor(rig);
    clearTimer(timers, "gestureFrame");
    clearTimer(timers, "gestureEnd");
    rig.style.setProperty("--control-transition-ms", `${transitionMs}ms`);
    rig.classList.remove("is-control-active", "is-control-gesturing");
    rig.classList.add("is-control-releasing");
    rig.classList.remove("has-control-artwork");
    delete rig.dataset.controlPreset;
    rig.querySelectorAll<HTMLElement | SVGElement>(":scope > .avatar-control-expression")
      .forEach((layer) => {
        layer.classList.remove("is-control-current");
        layer.classList.add("is-control-outgoing");
      });
    clearTimer(timers, "controlCleanup");
    const cleanup = () => {
      removeControlLayers(rig);
      clearControlProperties(rig);
      rig.classList.remove("is-control-releasing");
      delete timers.controlCleanup;
    };
    if (transitionMs === 0) cleanup();
    else timers.controlCleanup = capabilities.setTimer(cleanup, transitionMs);
  }

  function removeControlLayers(rig: HTMLElement): void {
    rig.querySelectorAll(":scope > .avatar-control-expression")
      .forEach((layer) => layer.remove());
  }

  function clearControlProperties(rig: HTMLElement): void {
    [
      "--control-transition-ms",
      "--control-eyes-transform",
      "--control-brows-transform",
      "--control-mouth-transform",
      "--control-layer-x",
      "--control-layer-y",
      "--control-layer-roll",
      "--control-layer-scale",
      "--control-gesture-y",
      "--control-gesture-scale",
    ].forEach((property) => rig.style.removeProperty(property));
  }

  function scaledControlDuration(rig: HTMLElement, durationMs: number): number {
    if (isIOSCompositorGuard() || isReducedMotion()) return 0;
    return Math.round(durationMs * controlDurationScale(rig));
  }

  function scaledControlHoldDuration(rig: HTMLElement, durationMs: number): number {
    return Math.max(1, Math.round(durationMs * controlDurationScale(rig)));
  }

  function controlDurationScale(rig: HTMLElement): number {
    const scale = finiteClamp(
      readFiniteNumber(rig.dataset.seatDurationScale, 1),
      0,
      4,
      1,
    );
    return scale;
  }

  function acceptedControlReceipt(
    rig: HTMLElement,
    command: ParsedRigControlCommand,
  ): RigControlReceipt {
    const rigCapabilities = controlCapabilities(rig);
    const ignoredFeatures = command.tag === "set" && !rigCapabilities.featurePose
      ? Object.keys(command.features) as RigControlFeature[]
      : [];
    const applied = appliedControlCapabilities(command, rigCapabilities);
    const degraded = [
      rigKind(rig) === "human-photo",
      ignoredFeatures.length > 0,
      ![rigCapabilities.artwork, rigCapabilities.featurePose].includes(true),
    ].includes(true);
    const fidelity = degraded ? "degraded" : "full";
    return {
      tag: "accepted",
      fidelity,
      rigId: command.rigId,
      sourceId: command.sourceId,
      sequence: command.sequence,
      capabilities: rigCapabilities,
      applied,
      ignoredFeatures,
    };
  }

  function controlCapabilities(rig: HTMLElement): RigControlCapabilities {
    const kind = rigKind(rig);
    return {
      artwork: rig.querySelector(":scope > template.avatar-control-layer") !== null,
      featurePose: kind === "bot",
      wrapperMotion: kind !== "human-photo" && kind !== "unknown" && canAnimate(),
      tint: kind !== "unknown",
      speech: kind === "bot" || kind === "human-generated",
    };
  }

  function appliedControlCapabilities(
    command: ParsedRigControlCommand,
    rigCapabilities: RigControlCapabilities,
  ): RigControlCapability[] {
    if (command.tag === "release") return [];
    return (["artwork", "featurePose", "wrapperMotion", "tint"] as const).filter((capability) =>
      rigCapabilities[capability]
    );
  }

  function rejectedControlReceipt(
    reason: RigControlRejectionReason,
    input: unknown,
  ): RigControlReceipt {
    const record = input !== null && typeof input === "object"
      ? input as Readonly<Record<string, unknown>>
      : {};
    return {
      tag: "rejected",
      reason,
      rigId: typeof record.rigId === "string" ? record.rigId : null,
      sourceId: typeof record.sourceId === "string" ? record.sourceId : null,
      sequence: typeof record.sequence === "number" && Number.isSafeInteger(record.sequence)
        ? record.sequence
        : null,
    };
  }

  function startSpeaking(rigId: string, cue: string, durationMs: number): void {
    const rig = capabilities.document.getElementById(rigId);
    if (!(rig instanceof HTMLElement) || rigKind(rig) === "human-photo") return;
    if (speakingMouths(rig).length + speakingImages(rig).length === 0) return;
    const timers = timersFor(rig);
    clearTimer(timers, "speechFrame");
    clearTimer(timers, "speechEnd");
    clearTimer(timers, "speechClear");
    clearSpeakingClasses(rig);
    const speakingClass = speakingClassFor(cue);
    rig.classList.add("is-speaking");
    if (speakingClass !== null) rig.classList.add(speakingClass);
    speechByRigId.set(rigId, "speaking");
    timers.speechEnd = capabilities.setTimer(() => stopSpeaking(rigId), durationMs);
    if (!canAnimate()) return;
    const now = capabilities.now();
    const tick = () => {
      const currentRig = capabilities.document.getElementById(rigId);
      if (!(currentRig instanceof HTMLElement)) return;
      if (speechByRigId.get(rigId) !== "speaking") return;
      const elapsed = capabilities.now() - now;
      const envelope = speechEnvelope(cue, elapsed);
      speakingMouths(currentRig).forEach((mouth) => {
        mouth.style.transform = envelope.mouthTransform;
      });
      speakingImages(currentRig).forEach((image) => {
        image.style.scale = envelope.imageScale;
      });
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
    speakingImages(rig).forEach((image) => image.style.scale = "1");
    clearSpeakingClasses(rig);
    speechByRigId.set(rigId, "fading");
    timers.speechClear = capabilities.setTimer(() => {
      speakingMouths(rig).forEach((mouth) => mouth.style.removeProperty("transform"));
      speakingImages(rig).forEach((image) => image.style.removeProperty("scale"));
      speechByRigId.set(rigId, "silent");
      delete timers.speechClear;
    }, 180);
  }

  function admitSemanticAudio(
    rig: HTMLElement,
    reaction: FacialReaction,
    candidate: ResolvedSemanticAudioCandidate,
  ): void {
    if (config === null) return;
    const kind = rigKind(rig);
    const requestMetadata = {
      intensity: reaction.intensity,
      rigKind: kind,
      rigId: rig.id,
      seatId: rig.id.replace(/^avatar-rig-/, ""),
      seatAudioProbability: readFiniteNumber(rig.dataset.seatAudioProbability, 1) *
        reaction.confidence,
    } as const;
    const request: AudioRequest = candidate.family === "Laughter"
      ? { ...requestMetadata, family: "Laughter", qualifier: candidate.qualifier ?? "standard" }
      : { ...requestMetadata, family: candidate.family, qualifier: null };
    const decision = decideAudio(audioPolicy, request, {
      audioEnabled: audioEnabled(config.isAudioEnabled),
      now: capabilities.now(),
      randomSample: capabilities.random(),
    });
    if (decision.tag === "rejected") return;
    audioPolicy = decision.nextState;
    if (kind !== "bot" && kind !== "human-generated") return;
    const detail: FacialRigSemanticAudioDetail = {
      family: candidate.family,
      qualifier: candidate.qualifier,
      profileId: candidate.profileId,
      identity: reaction.identity,
      src: candidate.slot.src,
      gain: candidate.slot.gain,
      state: reaction.state,
      gesture: reaction.gesture ?? null,
      kind: reaction.kind,
      durationMs: decision.durationMs,
      intensity: reaction.intensity,
      confidence: reaction.confidence,
      rigKind: kind,
      rigId: rig.id,
      seatId: requestMetadata.seatId,
      seatAudioProbability: request.seatAudioProbability,
    };
    const event = new CustomEvent<FacialRigSemanticAudioDetail>("facial-rig:voice-cue", {
      bubbles: true,
      cancelable: true,
      detail,
    });
    if (!rig.dispatchEvent(event)) return;
    startAudio(
      request,
      candidate.slot.src,
      candidate.slot.gain,
      decision.channelKey,
      decision.durationMs,
    );
  }

  function startAudio(
    request: AudioRequest,
    src: string,
    gain: number,
    channelKey: string,
    durationMs: number,
  ): void {
    audioPolicy = audioStarted(audioPolicy, channelKey);
    let audio: AudioLike | null = null;
    let active = true;
    let timeoutId: number | undefined;
    let stopAnalyser: () => void = () => undefined;
    let endedListenerInstalled = false;
    let errorListenerInstalled = false;
    const onEnded = () => clear(false);
    const onError = () => clear(true);
    const clear = (stopPlayback: boolean) => {
      if (!active) return;
      active = false;
      if (activeAudioByRigId.get(request.rigId) === stopCurrentAudio) {
        activeAudioByRigId.delete(request.rigId);
      }
      if (timeoutId !== undefined) safely(() => capabilities.clearTimer(timeoutId!));
      timeoutId = undefined;
      if (audio !== null && endedListenerInstalled) {
        safely(() => audio!.removeEventListener("ended", onEnded));
      }
      if (audio !== null && errorListenerInstalled) {
        safely(() => audio!.removeEventListener("error", onError));
      }
      safely(stopAnalyser);
      if (stopPlayback && audio !== null) safely(() => audio!.pause());
      audioPolicy = audioEnded(audioPolicy, channelKey);
      safely(() => stopSpeaking(request.rigId));
    };
    const stopCurrentAudio = () => clear(true);
    activeAudioByRigId.set(request.rigId, stopCurrentAudio);
    const onStarted = () => {
      if (!active) return;
      safely(() => startSpeaking(request.rigId, speechCueForSemantic(request.family), durationMs));
      stopAnalyser = wireAnalyser(audio, request.rigId);
    };
    try {
      audio = capabilities.createAudio(src);
      audio.volume = finiteClamp((0.45 + request.intensity * 0.12) * gain, 0, 1, 0.6);
      audio.addEventListener("ended", onEnded, { once: true });
      endedListenerInstalled = true;
      audio.addEventListener("error", onError, { once: true });
      errorListenerInstalled = true;
      timeoutId = capabilities.setTimer(() => {
        timeoutId = undefined;
        clear(true);
      }, audioTimeoutMs(request.intensity));
      const playing = audio.play();
      if (playing === undefined) onStarted();
      else void Promise.resolve(playing).then(onStarted, () => clear(true));
    } catch {
      clear(true);
    }
  }

  function getAudioContext(): AudioContextLike | null {
    if (audioContext !== null) return audioContext;
    try {
      audioContext = capabilities.createAudioContext();
    } catch {
      audioContext = null;
    }
    return audioContext;
  }

  function wireAnalyser(audio: AudioLike | null, rigId: string): () => void {
    if (audio === null) return () => undefined;
    const context = getAudioContext();
    if (context === null) return () => undefined;
    let source: ReturnType<AudioContextLike["createMediaElementSource"]> | null = null;
    let analyser: AnalyserLike | null = null;
    let frameId: number | null = null;
    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      if (frameId !== null) safely(() => capabilities.cancelFrame(frameId!));
      frameId = null;
      safely(() => source?.disconnect?.());
      safely(() => analyser?.disconnect?.());
    };
    try {
      source = context.createMediaElementSource(audio);
      analyser = context.createAnalyser();
      const activeSource = source;
      const activeAnalyser = analyser;
      activeAnalyser.fftSize = 32;
      activeAnalyser.smoothingTimeConstant = 0.55;
      activeSource.connect(activeAnalyser);
      activeAnalyser.connect(context.destination);
      const samples = new Uint8Array(activeAnalyser.frequencyBinCount);
      const sample = () => {
        if (!active || audio.ended) return;
        try {
          activeAnalyser.getByteTimeDomainData(samples);
          const level = rmsLevel(samples);
          const rig = capabilities.document.getElementById(rigId);
          if (rig instanceof HTMLElement && canAnimate()) {
            speakingMouths(rig).forEach((mouth) => {
              mouth.style.transform = `translateY(${(level * 1.5).toFixed(2)}px) scaleY(${
                (
                  1 + level * 2
                ).toFixed(3)
              })`;
            });
            speakingImages(rig).forEach((image) => {
              image.style.scale = `1 ${(1 + level * 0.08).toFixed(4)}`;
            });
          }
          frameId = capabilities.requestFrame(sample);
        } catch {
          cleanup();
        }
      };
      frameId = capabilities.requestFrame(sample);
      return cleanup;
    } catch {
      cleanup();
      return () => undefined;
    }
  }

  function installGestureUnlock(): void {
    if (gestureInstalled) return;
    try {
      capabilities.document.addEventListener("click", () => {
        const context = getAudioContext();
        if (context?.state === "suspended") {
          try {
            void Promise.resolve(context.resume()).catch(() => undefined);
          } catch (reason) {
            // Browser unlock failures are device policy, not application failures.
            ignoreBrowserFailure(reason);
          }
        }
        const silenceSrc = config?.silenceSrc ?? "";
        if (silenceSrc === "") return;
        try {
          const silence = capabilities.createAudio(silenceSrc);
          const playing = silence.play();
          if (playing !== undefined) {
            void Promise.resolve(playing).catch(() => safely(() => silence.pause()));
          }
        } catch (reason) {
          // Silence priming is best effort and never gates reactions.
          ignoreBrowserFailure(reason);
        }
      }, { once: true });
      gestureInstalled = true;
    } catch {
      gestureInstalled = false;
    }
  }

  function clearIdleStyles(): void {
    capabilities.document.querySelectorAll<HTMLElement>(".avatar-rig").forEach((rig) => {
      IDLE_PROPERTIES.forEach((property) => rig.style.removeProperty(property));
    });
  }

  function clearRigTimers(rig: HTMLElement): void {
    const timers = rigTimers.get(rig);
    if (timers === undefined) return;
    for (const key of Object.keys(timers) as Array<keyof RigTimers>) clearTimer(timers, key);
    rigTimers.delete(rig);
  }

  function clearRigResources(rig: HTMLElement): void {
    clearRigTimers(rig);
    const blinkTimer = blinkTimers.get(rig);
    if (blinkTimer !== undefined) capabilities.clearTimer(blinkTimer);
    blinkTimers.delete(rig);
    if (rig.id !== "") {
      activeAudioByRigId.get(rig.id)?.();
      activeAudioByRigId.delete(rig.id);
      activeGestureByRigId.delete(rig.id);
      speechByRigId.delete(rig.id);
      rigStatesById.delete(rig.id);
      rigElementsById.delete(rig.id);
      controlStatesById.delete(rig.id);
      pendingControlById.delete(rig.id);
    }
  }

  function pruneRigState(rigs: ReadonlyArray<HTMLElement>): void {
    const currentById = new Map(rigs.filter((rig) => rig.id !== "").map((rig) => [rig.id, rig]));
    for (const [rigId, previous] of rigElementsById) {
      const current = currentById.get(rigId);
      if (current === previous) continue;
      if (current !== undefined && sameRigSignature(previous, current)) {
        clearRigTimers(previous);
        const blinkTimer = blinkTimers.get(previous);
        if (blinkTimer !== undefined) capabilities.clearTimer(blinkTimer);
        blinkTimers.delete(previous);
        rigElementsById.set(rigId, current);
        const controlState = controlStatesById.get(rigId);
        if (controlState !== undefined) {
          if (controlState.affect !== null) {
            pendingControlById.set(rigId, controlState.affect);
            scheduleControlFrame();
          }
        }
        const gesture = activeGestureByRigId.get(rigId);
        if (gesture !== undefined) startReactionGesture(current, gesture);
      } else {
        clearRigResources(previous);
      }
    }
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
    rigs.forEach((rig) => applyIdlePose(rig, time));
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

  function init(input: FacialRigInitConfig): FacialRigInitReceipt {
    const parsed = parseConfig(input);
    if (parsed.tag === "rejected") return parsed;
    config = parsed.config;
    installGestureUnlock();
    if (initialized) return { tag: "accepted" };
    initialized = true;
    capabilities.document.addEventListener("visibilitychange", () => {
      if (capabilities.document.visibilityState === "hidden") {
        if (frame.tag === "scheduled") capabilities.cancelFrame(frame.frameId);
        frame = { tag: "stopped" };
        if (controlFrame.tag === "scheduled") capabilities.cancelFrame(controlFrame.frameId);
        controlFrame = { tag: "stopped" };
        pendingControlById.clear();
        clearIdleStyles();
      } else {
        for (const [rigId, state] of controlStatesById) {
          if (state.affect !== null) pendingControlById.set(rigId, state.affect);
        }
        scheduleControlFrame();
        sync();
      }
    });
    capabilities.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => {
      if (isReducedMotion()) {
        clearIdleStyles();
        for (const [rigId, state] of controlStatesById) {
          const rig = capabilities.document.getElementById(rigId);
          if (!(rig instanceof HTMLElement)) continue;
          if (activeGestureByRigId.has(rigId)) {
            clearTimer(timersFor(rig), "gestureFrame");
            rig.style.removeProperty("--control-gesture-y");
            rig.style.removeProperty("--control-gesture-scale");
            continue;
          }
          if (state.affect !== null) applyControlSet(rig, state.affect);
        }
      } else sync();
    });
    return { tag: "accepted" };
  }

  return { init, prepareSwap, sync, startSpeaking, stopSpeaking, control };
}

type FacialRigConfigResult =
  | Readonly<{ tag: "accepted"; config: FacialRigConfig }>
  | Extract<FacialRigInitReceipt, { tag: "rejected" }>;

const INVALID_CONFIG = Symbol("invalid-config");
const INVALID_PROFILE_CATALOG = Symbol("invalid-profile-catalog");
const CONFIG_REJECTION_REASONS = new Map<unknown, "invalid-profile-catalog">([
  [INVALID_PROFILE_CATALOG, "invalid-profile-catalog"],
]);

function parseConfig(input: unknown): FacialRigConfigResult {
  try {
    ensureRuntime(isPlainRecord(input));
    const keys = Reflect.ownKeys(input);
    ensureRuntime(
      keys.length === 3 &&
        keys.every((key) =>
          typeof key === "string" &&
          ["audioProfiles", "silenceSrc", "isAudioEnabled"].includes(key)
        ),
    );
    const audioProfiles = input.audioProfiles;
    const silenceSrc = input.silenceSrc;
    const isAudioEnabled = input.isAudioEnabled;
    const profiles = validateCharacterAudioProfiles(audioProfiles);
    ensureRuntime(profiles.tag === "accepted", INVALID_PROFILE_CATALOG);
    ensureRuntime(typeof silenceSrc === "string");
    ensureRuntime(typeof isAudioEnabled === "function");
    return {
      tag: "accepted",
      config: Object.freeze({
        audioProfiles: profiles.profiles,
        silenceSrc,
        isAudioEnabled: isAudioEnabled as () => boolean,
      }),
    };
  } catch (reason) {
    return {
      tag: "rejected",
      reason: CONFIG_REJECTION_REASONS.get(reason) ?? "invalid-config",
    };
  }
}

function ensureRuntime(condition: boolean, reason: unknown = INVALID_CONFIG): asserts condition {
  if (!condition) throw reason;
}

function parseRigKind(value: unknown): RigKind {
  const index = RIG_KINDS.indexOf(value as (typeof RIG_KINDS)[number]);
  return (["unknown", ...RIG_KINDS] as const)[index + 1]!;
}

function isAnimatedRig(rig: HTMLElement): boolean {
  return rig.isConnected && parseRigKind(rig.dataset.rigKind) !== "human-photo";
}

function sameRigSignature(live: HTMLElement, incoming: HTMLElement): boolean {
  const liveSignature = live.dataset.rigSignature;
  return [liveSignature !== undefined, liveSignature === incoming.dataset.rigSignature].every(
    Boolean,
  );
}

function copyRigProtocol(live: HTMLElement, incoming: HTMLElement): void {
  const isProtocolAttribute = (name: string) =>
    [
      name.startsWith("data-rig-"),
      name.startsWith("data-seat-"),
      [
        "data-match-scope",
        "data-audio-profile-id",
        "data-reaction",
        "data-preceding-reaction",
        "data-micro-reaction",
      ].includes(name),
    ].some(Boolean);
  for (const attribute of [...live.attributes]) {
    if (isProtocolAttribute(attribute.name) && !incoming.hasAttribute(attribute.name)) {
      live.removeAttribute(attribute.name);
    }
  }
  for (const attribute of [...incoming.attributes]) {
    if (isProtocolAttribute(attribute.name)) {
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
    ".avatar-base .face-mouth, .avatar-expression .face-mouth, " +
      ".avatar-control-expression .face-mouth",
  )];
}

function speakingImages(rig: HTMLElement): HTMLImageElement[] {
  return [...rig.querySelectorAll<HTMLImageElement>(
    ':scope[data-rig-kind="human-generated"] > img.avatar-base, ' +
      ':scope[data-rig-kind="human-generated"] > img.avatar-expression, ' +
      ':scope[data-rig-kind="human-generated"] > img.avatar-micro-expression, ' +
      ':scope[data-rig-kind="human-generated"] > img.avatar-control-expression',
  )];
}

function speakingClassFor(cue: string): string | null {
  const candidate = `speaking-${cue}`;
  return (SPEAKING_CLASSES as ReadonlyArray<string>).includes(candidate) ? candidate : null;
}

function clearSpeakingClasses(rig: HTMLElement): void {
  rig.classList.remove("is-speaking", ...SPEAKING_CLASSES);
}

function speechEnvelope(cue: string, elapsed: number) {
  const amplitude = SPEECH_AMPLITUDE_BY_CUE[cue] ?? 0.18;
  const wave = Math.abs(Math.sin(elapsed / 42));
  return {
    mouthTransform: `translateY(${(wave * amplitude * 2).toFixed(2)}px) scaleY(${
      (1 + wave * amplitude).toFixed(3)
    })`,
    imageScale: `1 ${(1 + wave * amplitude * 0.08).toFixed(4)}`,
  };
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

function speechCueForSemantic(family: AudioRequest["family"]): string {
  return SPEECH_CUE_BY_FAMILY[family];
}

function safely(effect: () => void): void {
  try {
    effect();
  } catch (reason) {
    // Browser media teardown is best effort.
    ignoreBrowserFailure(reason);
  }
}

function ignoreBrowserFailure(_reason: unknown): void {
  return;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function audioTimeoutMs(intensity: number): number {
  const index = Math.trunc(finiteClamp(intensity, 1, 3, 1)) - 1;
  return AUDIO_TIMEOUT_MS[index]!;
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

type RuntimeWindow = Window & typeof globalThis;

function defaultCapabilities(target: RuntimeWindow): BrowserCapabilities {
  const AudioContextConstructor = target.AudioContext;
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
}

if (typeof window !== "undefined" && typeof document !== "undefined") install(window);
