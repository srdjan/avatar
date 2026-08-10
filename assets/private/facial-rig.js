// Facial rig client runtime. Self-contained IIFE that exposes window.FacialRig.
// Server renders base, macro-expression, and micro-expression layers inside an
// .avatar-rig wrapper carrying data-reaction-*, data-preceding-*, and
// data-micro-* attributes. This script:
//   - reads those attributes and drives macro/micro reactions
//   - runs an autonomous idle pass (drift, blink, cross-seat gaze)
//   - plays voice cues with cooldown and channel cap (audioRig)
//   - drives speaking-mouth from an audio analyser
//
// Apps configure asset URLs and the audio-enabled callback via init(), then
// call sync() from their HTMX hooks. The package emits a
// "facial-rig:voice-cue" CustomEvent on the rig element before playing each
// cue; apps can call preventDefault() to suppress or reroute audio.
(function () {
  // -- Config (set via init) -------------------------------------------------
  var config = {
    audioAssets: null,
    silenceSrc: null,
    isAudioEnabled: function () {
      return true;
    },
    voiceProbabilityByKind: {
      "bot": [0.4, 0.7, 0.95],
      "human-generated": [0.08, 0.2, 0.4],
      "human-photo": [0, 0, 0],
    },
  };
  var initialized = false;

  // -- Audio -----------------------------------------------------------------
  // Per-seat channels with a small global cap. Three throttles:
  //   - cooldownByCue gates the same cue from re-firing too soon (a `gasp`
  //     does not block a `laugh` from a different seat).
  //   - lastPlayBySeat enforces a 600ms minimum gap between any two cues
  //     from the same seat, including climactic (intensity 3) preemption.
  //   - GLOBAL_AUDIO_CAP limits total concurrent voices.
  // Climactic intensity bypasses the per-cue cooldown but never the per-seat
  // guard. Nothing interrupts an already-playing voice clip on the same seat.
  var CUE_DURATION_MS = {
    gasp: 1800,
    laugh: 945,
    sigh: 1800,
    groan: 1800,
    challenge: 1800,
    laughClimactic: 1800,
  };
  var COOLDOWN_MS = [900, 1400, 2200];
  var INTRA_SEAT_MS = 600;
  var GLOBAL_AUDIO_CAP = 2;
  var MAX_AUDIO_MS = [2000, 2400, 3200];
  var SPEAKING_CLASSES = [
    "is-speaking",
    "speaking-gasp",
    "speaking-laugh",
    "speaking-sigh",
    "speaking-groan",
    "speaking-challenge",
  ];
  var MOUTH_SELECTOR = ".avatar-base .face-mouth, .avatar-expression .face-mouth";
  // Idle face features derive from breathTyTarget (px) via these factors.
  // Brow and mouth Y stay in px (factor is dimensionless); mouth scale
  // converts px to a 1.0-centred scale ratio (factor is per-px). Tune by eye.
  var BROW_FROM_BREATH = 0.6;
  var MOUTH_Y_FROM_BREATH = 0.3;
  var MOUTH_SCALE_FROM_BREATH = 0.022;
  var NOSE_SX_FROM_BREATH = 0.006;
  // Pseudo Z-axis: breath modulates whole-rig scale by a sub-percent so the
  // head reads as bobbing toward/away from the camera, not just up/down.
  // Peak at 0.85px breath × 0.0055 ~= 0.5% scale; any larger reads as a
  // zoom, not a chest rise.
  var BREATH_SCALE_FROM_BREATH = 0.0055;
  var LIGHT_X_FROM_HEAD = 0.85;
  var LIGHT_Y_FROM_HEAD = 0.65;

  var currentBySeat = {};
  var cooldownByCue = {};
  var lastPlayBySeat = {};

  // Climactic laugh (intensity 3) has its own audio asset and duration entry.
  // assetKeyForCue centralises that branch so duration lookup can reuse it.
  function assetKeyForCue(cue, intensity) {
    if (cue === "laugh" && intensity >= 3) return "laughClimactic";
    return cue;
  }

  function activeChannelCount() {
    var n = 0;
    for (var k in currentBySeat) {
      if (Object.prototype.hasOwnProperty.call(currentBySeat, k)) n += 1;
    }
    return n;
  }

  function intensityIndex(intensity) {
    return intensity >= 1 && intensity <= 3 ? intensity - 1 : 0;
  }

  function decideAudio(input) {
    if (input.audioOn !== true) return null;
    if (!input.cue) return null;
    if (input.seatBusy) return null;
    if (input.globalBusy) return null;

    var idx = intensityIndex(input.intensity);
    // Unknown rig kinds default to silence; future kinds opt in explicitly.
    var probs = config.voiceProbabilityByKind[input.rigKind];
    if (!probs || probs[idx] <= 0) return null;

    var assetKey = assetKeyForCue(input.cue, input.intensity);
    var voiceSrc = config.audioAssets ? config.audioAssets[assetKey] || null : null;
    if (!voiceSrc) return null;

    var now = input.now;
    var cueReady = !cooldownByCue[input.cue] || now >= cooldownByCue[input.cue];
    if (!cueReady && input.intensity < 3) return null;
    if (
      input.seatId &&
      lastPlayBySeat[input.seatId] &&
      now - lastPlayBySeat[input.seatId] < INTRA_SEAT_MS
    ) {
      return null;
    }

    var seatProb = input.seatAudioProbability != null ? input.seatAudioProbability : 1;
    if (Math.random() >= probs[idx] * seatProb) return null;
    // Tick throttles only when a clip actually plays - missed rolls
    // shouldn't gate the next opportunity, since no sound was emitted.
    cooldownByCue[input.cue] = now + COOLDOWN_MS[idx];
    if (input.seatId) lastPlayBySeat[input.seatId] = now;

    return {
      cue: input.cue,
      src: voiceSrc,
      durationMs: CUE_DURATION_MS[assetKey] || MAX_AUDIO_MS[idx],
    };
  }

  function clearSpeakingClasses(rigId) {
    var rig = rigId && document.getElementById(rigId);
    if (!rig) return;
    rig.classList.remove.apply(rig.classList, SPEAKING_CLASSES);
  }

  function markSpeakingClasses(rigId, cue) {
    var rig = rigId && document.getElementById(rigId);
    if (!rig) return;
    clearSpeakingClasses(rigId);
    rig.classList.add("is-speaking", "speaking-" + cue);
  }

  // Lazy AudioContext so the page doesn't open one before any audio is
  // actually requested. Single context is shared across all clips because
  // browsers cap simultaneous contexts and creating one per clip leaks.
  var sharedAudioCtx = null;
  function getAudioCtx() {
    if (sharedAudioCtx) return sharedAudioCtx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      sharedAudioCtx = new Ctor();
    } catch {
      sharedAudioCtx = null;
    }
    return sharedAudioCtx;
  }

  // Wires an HTMLAudioElement through MediaElementSource + AnalyserNode so the
  // avatar mouth can read live RMS amplitude. Returns the analyser, or null.
  function wireAnalyser(audioEl) {
    var ctx = getAudioCtx();
    if (!ctx || ctx.state !== "running") return null;
    try {
      var src = ctx.createMediaElementSource(audioEl);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      return analyser;
    } catch {
      return null;
    }
  }

  function startAudio(decision, ctx) {
    var a = new Audio(decision.src);
    var slotKey = ctx.seatId || "_global";
    currentBySeat[slotKey] = a;
    function clear() {
      if (currentBySeat[slotKey] !== a) return;
      delete currentBySeat[slotKey];
      stopSpeaking(ctx.rigId);
      clearSpeakingClasses(ctx.rigId);
    }
    a.addEventListener("ended", clear);
    a.addEventListener("error", clear);
    setTimeout(function () {
      if (currentBySeat[slotKey] !== a) return;
      a.pause();
      clear();
    }, MAX_AUDIO_MS[intensityIndex(ctx.intensity)]);
    var p = a.play();
    function onStarted() {
      if (currentBySeat[slotKey] !== a) return;
      markSpeakingClasses(ctx.rigId, decision.cue);
      var analyser = wireAnalyser(a);
      startSpeaking(ctx.rigId, decision.cue, decision.durationMs, analyser);
    }
    if (p && typeof p.then === "function") p.then(onStarted).catch(clear);
    else onStarted();
  }

  // req: { cue, intensity, rigKind, seatId, rigId, seatAudioProbability }
  function audioPlay(req) {
    var slotKey = req.seatId || "_global";
    var seatBusy = !!(currentBySeat[slotKey] && !currentBySeat[slotKey].ended);
    var decision = decideAudio({
      audioOn: !!config.isAudioEnabled(),
      cue: req.cue,
      seatBusy: seatBusy,
      globalBusy: activeChannelCount() >= GLOBAL_AUDIO_CAP,
      intensity: req.intensity,
      now: Date.now(),
      rigKind: req.rigKind,
      seatId: req.seatId,
      seatAudioProbability: req.seatAudioProbability,
    });
    if (!decision) return;
    // Voice-cue extension seam: apps can preventDefault to suppress or reroute
    // (e.g. through their own mixer). The package plays the clip itself only
    // when no listener cancels.
    var rigEl = req.rigId && document.getElementById(req.rigId);
    if (rigEl && typeof CustomEvent === "function") {
      var ev = new CustomEvent("facial-rig:voice-cue", {
        bubbles: true,
        cancelable: true,
        detail: {
          cue: decision.cue,
          src: decision.src,
          durationMs: decision.durationMs,
          intensity: req.intensity,
          rigKind: req.rigKind,
          rigId: req.rigId,
          seatId: req.seatId,
          seatAudioProbability: req.seatAudioProbability,
        },
      });
      var notCancelled = rigEl.dispatchEvent(ev);
      if (!notCancelled) return;
    }
    startAudio(decision, {
      intensity: req.intensity,
      seatId: req.seatId,
      rigId: req.rigId,
    });
  }

  // First user click warms the browser autoplay context (muted, mutex-free)
  // so the next real reaction can play without needing its own gesture.
  // While we're here, preload every voice cue so the first reaction's
  // lip-sync doesn't lag on a cold-cache fetch.
  function installAudioWarmup() {
    document.addEventListener("click", function () {
      var ac = getAudioCtx();
      if (ac && ac.state === "suspended" && typeof ac.resume === "function") {
        ac.resume().catch(function () {});
      }
      if (config.silenceSrc) {
        var a = new Audio(config.silenceSrc);
        a.volume = 0;
        var p = a.play();
        if (p && typeof p.catch === "function") p.catch(function () {});
      }
      var seen = {};
      function preloadSrc(src) {
        if (!src || seen[src]) return;
        seen[src] = true;
        var preload = new Audio();
        preload.preload = "auto";
        preload.src = src;
        preload.load();
      }
      var assets = config.audioAssets || {};
      for (var key in assets) {
        if (Object.prototype.hasOwnProperty.call(assets, key)) {
          preloadSrc(assets[key]);
        }
      }
    }, { once: true, capture: true });
  }

  // -- Avatar rig -----------------------------------------------------------
  // Macro reactions toggle is-reacting + motion-{motion}; micro reactions
  // toggle is-micro-reacting without resetting the macro timer. When a
  // preceding reaction is present, it plays first and the main reaction
  // fires after preceding's durationMs. State is keyed by rig id so OOB
  // swaps that replace the DOM nodes don't lose the debounce.
  var DEFAULT_REACTION_MS = 2000;
  var reduce = matchMedia("(prefers-reduced-motion: reduce)");
  var state = {};

  function isIOSCompositorGuard() {
    var ua = navigator.userAgent || "";
    var platform = navigator.platform || "";
    var maxTouchPoints = navigator.maxTouchPoints || 0;
    return /iPad|iPhone|iPod/.test(ua) ||
      /iPad|iPhone|iPod/.test(platform) ||
      (platform === "MacIntel" && maxTouchPoints > 1);
  }

  // -- Face-feature tween engine. Drives .face-eyes, .face-mouth, .face-brows,
  // and idle .face-nose transforms inside .avatar-expression (macro) and
  // .avatar-micro-expression (micro) layers. CSS still owns body motion,
  // feature-plane parallax, layer crossfade, and outline tint; this engine
  // owns per-feature transforms for macro/micro reactions, cue-specific
  // speaking mouths, and autonomous idle drift.
  var liveTweens = [];
  var liveMouthEnvelopes = [];
  var rafId = 0;
  var BASELINE = { tx: 0, ty: 0, sx: 1, sy: 1 };

  function ensureLoop() {
    if (rafId) return;
    rafId = requestAnimationFrame(tickRigFrame);
  }

  function tickRigFrame(now) {
    rafId = 0;
    tickTweens(now);
    tickMouthEnvelopes(now);
    tickAutonomousIdle(now);
    if (liveTweens.length || liveMouthEnvelopes.length || idleRunning) {
      ensureLoop();
    }
  }

  function tickTweens(now) {
    var keep = [];
    for (var i = 0; i < liveTweens.length; i++) {
      var t = liveTweens[i];
      if (t.cancelled) continue;
      if (!t.element.isConnected) continue;
      if (!t.startTime) t.startTime = now;
      var elapsed = now - t.startTime - t.delayMs;
      if (elapsed < 0) {
        var holdPose = t.stops[0].pose;
        t.lastPose = holdPose;
        applyPose(t.element, t.featureKind, holdPose);
        keep.push(t);
        continue;
      }
      var effDur = t.durationMs - t.delayMs;
      var p = effDur > 0 ? elapsed / effDur : 1;
      if (p >= 1) {
        var endPose = samplePiecewise(t.stops, 1);
        t.lastPose = endPose;
        applyPose(t.element, t.featureKind, endPose);
        t.element.style.transform = "";
        continue;
      }
      if (p < 0) p = 0;
      var pose = samplePiecewise(t.stops, p);
      t.lastPose = pose;
      applyPose(t.element, t.featureKind, pose);
      keep.push(t);
    }
    liveTweens = keep;
  }

  // Per-stop easing: stops[i].easing (when present) shapes the segment that
  // ENDS at stops[i].
  function samplePiecewise(stops, p) {
    for (var i = 1; i < stops.length; i++) {
      if (p <= stops[i].p) {
        var span = stops[i].p - stops[i - 1].p;
        var seg = span > 0 ? (p - stops[i - 1].p) / span : 0;
        var ease = stops[i].easing;
        var eased = ease ? ease(seg) : seg;
        return lerpPose(stops[i - 1].pose, stops[i].pose, eased);
      }
    }
    return stops[stops.length - 1].pose;
  }

  function easeOutCubic(t) {
    var u = 1 - t;
    return 1 - u * u * u;
  }
  function easeInCubic(t) {
    return t * t * t;
  }
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function lerpPose(a, b, t) {
    return {
      tx: lerp(a.tx, b.tx, t),
      ty: lerp(a.ty, b.ty, t),
      sx: lerp(a.sx, b.sx, t),
      sy: lerp(a.sy, b.sy, t),
    };
  }

  function applyPose(el, kind, pose) {
    // Mouth writes through unconditionally; the speaking envelope tick runs
    // after tickTweens and overwrites with a crossfade between this macro
    // pose and the envelope's pose, weighted by the rig's speakingProgress.
    if (kind === "eyes") {
      el.style.transform = "translateX(" + pose.tx + "px) scaleY(" + pose.sy +
        ")";
    } else if (kind === "mouth") {
      el.style.transform = "translateY(" + pose.ty + "px) scale(" + pose.sx +
        ")";
    } else {
      el.style.transform = "translateY(" + pose.ty + "px)";
    }
  }

  function getCurrentPose(rig, tag, featureKind) {
    for (var i = 0; i < liveTweens.length; i++) {
      var t = liveTweens[i];
      if (
        !t.cancelled && t.rig === rig && t.tag === tag &&
        t.featureKind === featureKind && t.lastPose
      ) {
        return t.lastPose;
      }
    }
    return null;
  }

  function cancelTweensFor(rig, tag, options) {
    var clear = options && options.clearTransform;
    for (var i = 0; i < liveTweens.length; i++) {
      var t = liveTweens[i];
      if (t.rig === rig && t.tag === tag) {
        t.cancelled = true;
        if (clear && t.element && t.element.isConnected) {
          t.element.style.transform = "";
        }
      }
    }
  }

  function pushTween(rig, tag, kind, el, stops, timing) {
    liveTweens.push({
      rig: rig,
      tag: tag,
      featureKind: kind,
      element: el,
      stops: stops,
      durationMs: timing.dur,
      delayMs: timing.delayMs || 0,
      startTime: 0,
      cancelled: false,
      lastPose: null,
    });
    ensureLoop();
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
  function mapRange(v, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMin;
    var p = clamp((v - inMin) / (inMax - inMin), 0, 1);
    return outMin + (outMax - outMin) * p;
  }
  function approach(current, target, amount) {
    return current + (target - current) * clamp(amount, 0, 1);
  }
  function smoothStep(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }
  // Speaking <-> macro crossfade: ramp progress linearly over these windows,
  // then run the linear progress through smoothStep to get the blend weight.
  var SPEAKING_FADE_IN_MS = 120;
  var SPEAKING_FADE_OUT_MS = 180;

  // -- Speaking-mouth envelope ----------------------------------------------
  function mouthEnvelopePose(cue, p) {
    p = clamp(p, 0, 1);
    if (cue === "gasp") {
      if (p < 0.16) {
        return {
          sx: mapRange(p, 0, 0.16, 1, 1.42),
          ty: mapRange(p, 0, 0.16, 0, 1.2),
        };
      }
      if (p < 0.62) return { sx: 1.34, ty: 1.1 };
      return {
        sx: mapRange(p, 0.62, 1, 1.34, 1),
        ty: mapRange(p, 0.62, 1, 1.1, 0),
      };
    }
    if (cue === "sigh" || cue === "groan") {
      var sag = Math.sin(Math.PI * p);
      var pulse = Math.max(0, Math.sin(Math.PI * p * 3));
      return {
        sx: 1 + sag * 0.18 + pulse * 0.08,
        ty: sag * (cue === "groan" ? 1.8 : 1.3),
      };
    }
    var beats = cue === "challenge" ? 5 : 4;
    var open = Math.max(0, Math.sin(Math.PI * p * beats));
    var taper = 1 - Math.max(0, p - 0.72) / 0.28;
    return {
      sx: 1 + open * taper * (cue === "challenge" ? 0.34 : 0.3),
      ty: open * taper * 0.8,
    };
  }

  function applyMouthEnvelope(el, pose) {
    el.style.transform = "translateY(" + pose.ty.toFixed(2) + "px) scale(" +
      pose.sx.toFixed(3) + ")";
  }

  function stopSpeaking(rigId) {
    // Mark envelopes for fade-out; tickMouthEnvelopes ramps speakingProgress
    // to 0 over SPEAKING_FADE_OUT_MS and drops the envelope when it lands,
    // leaving the macro mouth pose in place rather than snapping to baseline.
    for (var i = 0; i < liveMouthEnvelopes.length; i++) {
      if (liveMouthEnvelopes[i].rigId === rigId) {
        liveMouthEnvelopes[i].fadingOut = true;
      }
    }
  }

  function startSpeaking(rigId, cue, durationMs, analyser) {
    var rig = rigId && document.getElementById(rigId);
    if (!rig) return;
    if (reduce.matches) return;
    if (rig.getAttribute("data-rig-kind") === "human-photo") return;
    stopSpeaking(rigId);
    var mouths = rig.querySelectorAll(MOUTH_SELECTOR);
    if (!mouths.length) return;
    liveMouthEnvelopes.push({
      rigId: rigId,
      cue: cue,
      durationMs: Math.max(240, durationMs || 900),
      startTime: 0,
      analyser: analyser || null,
      timeBuf: analyser ? new Uint8Array(analyser.frequencyBinCount) : null,
      rms: 0,
    });
    ensureLoop();
  }

  function rmsBlendFor(cue) {
    if (cue === "gasp") return 0.15;
    if (cue === "sigh" || cue === "groan") return 0.55;
    return 0.7;
  }

  function sampleRms(env) {
    if (!env.analyser || !env.timeBuf) return null;
    env.analyser.getByteTimeDomainData(env.timeBuf);
    var sum = 0;
    for (var i = 0; i < env.timeBuf.length; i++) {
      var v = (env.timeBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / env.timeBuf.length);
  }

  function tickMouthEnvelopes(now) {
    var keep = [];
    for (var i = 0; i < liveMouthEnvelopes.length; i++) {
      var env = liveMouthEnvelopes[i];
      var rig = document.getElementById(env.rigId);
      if (!rig) continue;

      if (!env.startTime) env.startTime = now;
      if (env.lastTick == null) env.lastTick = now;
      // Clamp dt so a long RAF gap (tab backgrounded, breakpoint paused)
      // does not snap progress across the whole crossfade in one frame.
      var dt = Math.max(0, Math.min(64, now - env.lastTick));
      env.lastTick = now;
      if (env.progress == null) env.progress = 0;

      var p = (now - env.startTime) / env.durationMs;
      var owns = !env.fadingOut && p < 1 &&
        rig.classList.contains("is-speaking");

      if (owns) {
        env.progress = Math.min(1, env.progress + dt / SPEAKING_FADE_IN_MS);
      } else {
        env.progress = Math.max(0, env.progress - dt / SPEAKING_FADE_OUT_MS);
        if (env.progress === 0) {
          // Hand off cleanly: if no macro tween is writing the mouth, clear
          // the inline transform so the CSS idle rule (gated on
          // :not(.is-speaking)) can take over. If a macro tween is alive, it
          // will overwrite next frame so leaving the last blended pose in
          // place is invisible at 60Hz.
          if (!getCurrentPose(rig, "macro", "mouth")) {
            var dropMouths = rig.querySelectorAll(MOUTH_SELECTOR);
            for (var k = 0; k < dropMouths.length; k++) {
              dropMouths[k].style.transform = "";
            }
          }
          continue;
        }
      }

      var pose = mouthEnvelopePose(env.cue, clamp(p, 0, 1));
      var rmsRaw = sampleRms(env);
      if (rmsRaw != null) {
        var target = mapRange(rmsRaw, 0, 0.35, 0, 1);
        var alpha = target > env.rms ? 0.55 : 0.18;
        env.rms = approach(env.rms, target, alpha);
        var blend = rmsBlendFor(env.cue);
        var rmsBoostSx = 1 + env.rms * 0.6;
        var rmsBoostTy = env.rms * 1.4;
        pose = {
          sx: pose.sx * (1 - blend) + pose.sx * rmsBoostSx * blend,
          ty: pose.ty * (1 - blend) + (pose.ty + rmsBoostTy) * blend,
        };
      }

      // Per-emotion clamp on the envelope: avataaars `tongue` (laughing) and
      // `grimace` (dizzy) mouths are intrinsically large open shapes; without
      // this cap the speaking envelope multiplies them up past readable size.
      var envScale = readVar(rig, "--mouth-envelope-scale", 1);
      if (envScale !== 1) pose = { sx: pose.sx * envScale, ty: pose.ty };

      // Crossfade with the current macro mouth pose so endpoints are smooth.
      // applyMouthEnvelope reads only ty and sx, matching the macro mouth's
      // applyPose, so the lerp is one-to-one even though macro carries tx/sy.
      var weight = smoothStep(env.progress);
      var macro = getCurrentPose(rig, "macro", "mouth") || BASELINE;
      var blendedPose = {
        sx: lerp(macro.sx, pose.sx, weight),
        ty: lerp(macro.ty, pose.ty, weight),
      };

      var mouths = rig.querySelectorAll(MOUTH_SELECTOR);
      for (var j = 0; j < mouths.length; j++) {
        applyMouthEnvelope(mouths[j], blendedPose);
      }
      keep.push(env);
    }
    liveMouthEnvelopes = keep;
  }

  // -- Macro / micro pose builders ------------------------------------------
  function scaleFromBaseline(pose, factor) {
    return {
      tx: pose.tx * factor,
      ty: pose.ty * factor,
      sx: 1 + (pose.sx - 1) * factor,
      sy: 1 + (pose.sy - 1) * factor,
    };
  }
  function readVar(rig, name, fallback) {
    var v = getComputedStyle(rig).getPropertyValue(name).trim();
    if (!v) return fallback;
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }
  function readAmplitude(rig) {
    var v = parseFloat(
      rig.style.getPropertyValue("--seat-amplitude-scale") || "1",
    );
    return isNaN(v) ? 1 : v;
  }
  function readConfidence(rig, prefix) {
    var v = parseFloat(
      rig.getAttribute("data-" + prefix + "-confidence") || "1",
    );
    return isNaN(v) ? 1 : clamp(v, 0, 1);
  }
  function readReactionAmplitude(rig, prefix) {
    return readAmplitude(rig) * readConfidence(rig, prefix);
  }
  function scalePeak(peak, amp) {
    return 1 + (peak - 1) * amp;
  }
  function scaleOffset(offset, amp) {
    return offset * amp;
  }

  function buildMacroPose(rig, expression, prefix) {
    var amp = readReactionAmplitude(rig, prefix || "reaction");
    var eyeXPeak = readVar(rig, "--face-eye-x-peak", 0);
    var eyeScaleY = readVar(rig, "--face-eye-scale-y-peak", 0.45);
    var eyeWide = readVar(rig, "--face-eye-wide-scale-y-peak", 1.7);
    var mouthYPeak = readVar(rig, "--face-mouth-y-peak", 0);
    var mouthScale = readVar(rig, "--face-mouth-scale-peak", 1.5);
    var mouthGape = readVar(rig, "--face-mouth-gape-scale-peak", 2);
    var browYPeak = readVar(rig, "--face-brow-y-peak", -8);
    var browHigh = readVar(rig, "--face-brow-high-y-peak", -12);
    var browFurrow = readVar(rig, "--face-brow-furrow-y-peak", 6);

    var eyes = {
      tx: scaleOffset(eyeXPeak, amp),
      ty: 0,
      sx: 1,
      sy: scalePeak(eyeScaleY, amp),
    };
    var mouth = {
      tx: 0,
      ty: scaleOffset(mouthYPeak, amp),
      sx: scalePeak(mouthScale, amp),
      sy: 1,
    };
    var brows = { tx: 0, ty: scaleOffset(browYPeak, amp), sx: 1, sy: 1 };

    if (expression === "surprise" || expression === "fear") {
      eyes.sy = scalePeak(eyeWide, amp);
      brows.ty = scaleOffset(browHigh, amp);
    }
    if (expression === "anger") {
      eyes.sy = scalePeak(0.35, amp);
      brows.ty = scaleOffset(browFurrow, amp);
      mouth.sx = scalePeak(0.8, amp);
    }
    if (expression === "sadness") {
      brows.ty = scaleOffset(browFurrow, amp);
      mouth.sx = scalePeak(0.55, amp);
    }
    if (expression === "surprise") {
      mouth.sx = scalePeak(mouthGape, amp);
    }
    return { eyes: eyes, mouth: mouth, brows: brows };
  }

  function buildMicroPoses(rig, microKind) {
    var amp = readReactionAmplitude(rig, "micro");
    var eyeXPeak = readVar(rig, "--face-micro-eye-x-peak", 2);
    var eyeXReturn = readVar(rig, "--face-micro-eye-x-return", -1);
    var mouthScalePeak = readVar(rig, "--face-micro-mouth-scale-peak", 1.25);
    var browYPeak = readVar(rig, "--face-micro-brow-y-peak", -5);
    var alert = microKind === "CardPlayedHigh" ||
      microKind === "DecisionMadeMogu";

    var eyesPeak;
    var eyesReturn;
    if (alert) {
      eyesPeak = {
        tx: scaleOffset(eyeXPeak, amp),
        ty: 0,
        sx: 1,
        sy: scalePeak(1.22, amp),
      };
      eyesReturn = { tx: 0, ty: 0, sx: 1, sy: scalePeak(0.9, amp) };
    } else {
      eyesPeak = {
        tx: scaleOffset(eyeXPeak, amp),
        ty: 0,
        sx: 1,
        sy: scalePeak(0.88, amp),
      };
      eyesReturn = { tx: scaleOffset(eyeXReturn, amp), ty: 0, sx: 1, sy: 1 };
    }
    var mouthPeak = { tx: 0, ty: 0, sx: scalePeak(mouthScalePeak, amp), sy: 1 };
    var mouthReturn = { tx: 0, ty: 0, sx: scalePeak(0.96, amp), sy: 1 };
    var browsPeak = { tx: 0, ty: scaleOffset(browYPeak, amp), sx: 1, sy: 1 };
    var browsReturn = { tx: 0, ty: scaleOffset(1, amp), sx: 1, sy: 1 };

    return {
      alert: alert,
      eyes: { peak: eyesPeak, ret: eyesReturn },
      mouth: { peak: mouthPeak, ret: mouthReturn },
      brows: { peak: browsPeak, ret: browsReturn },
    };
  }

  function startMacroFaceTweens(rig, payload) {
    var rigKind = rig.getAttribute("data-rig-kind") || "bot";
    if (rigKind === "human-photo") return;
    if (reduce.matches) return;
    var layer = rig.querySelector(".avatar-expression");
    if (!layer) return;
    var eyesEl = layer.querySelector(".face-eyes");
    var mouthEl = layer.querySelector(".face-mouth");
    var browsEl = layer.querySelector(".face-brows");
    if (!eyesEl && !mouthEl && !browsEl) return;

    var expression = payload.expression ||
      rig.getAttribute("data-reaction-expression") || "";
    var pose = buildMacroPose(rig, expression, payload.prefix);
    var dur = payload.durationMs;
    var intensity = payload.intensity ||
      Number(rig.getAttribute("data-reaction-intensity") || 0);
    var stagger = Math.min(60, dur * 0.04);
    var browsDelay = 0;
    var eyesDelay = stagger * 0.5;
    var mouthDelay = stagger;

    var eyesFrom = (eyesEl && getCurrentPose(rig, "macro", "eyes")) || BASELINE;
    var mouthFrom = (mouthEl && getCurrentPose(rig, "macro", "mouth")) ||
      BASELINE;
    var browsFrom = (browsEl && getCurrentPose(rig, "macro", "brows")) ||
      BASELINE;
    cancelTweensFor(rig, "macro");

    if (eyesEl) {
      pushTween(
        rig,
        "macro",
        "eyes",
        eyesEl,
        buildMacroStops(eyesFrom, pose.eyes, intensity),
        {
          dur: dur,
          delayMs: eyesDelay,
        },
      );
    }
    if (mouthEl) {
      pushTween(
        rig,
        "macro",
        "mouth",
        mouthEl,
        buildMacroStops(mouthFrom, pose.mouth, intensity),
        {
          dur: dur,
          delayMs: mouthDelay,
        },
      );
    }
    if (browsEl) {
      pushTween(
        rig,
        "macro",
        "brows",
        browsEl,
        buildMacroStops(browsFrom, pose.brows, intensity),
        {
          dur: dur,
          delayMs: browsDelay,
        },
      );
    }
  }

  // Intensity 3 reactions earn anticipation + overshoot stops; lower
  // intensities use the simpler 4-stop shape that matches the prior CSS
  // keyframes 1:1.
  function buildMacroStops(from, peak, intensity) {
    if (intensity >= 3) {
      var anticipation = scaleFromBaseline(peak, -0.08);
      var overshoot = scaleFromBaseline(peak, 1.08);
      return [
        { p: 0, pose: from },
        { p: 0.03, pose: anticipation, easing: easeOutCubic },
        { p: 0.08, pose: peak, easing: easeOutCubic },
        { p: 0.12, pose: overshoot, easing: easeOutCubic },
        { p: 0.92, pose: peak, easing: easeInOutCubic },
        { p: 1, pose: BASELINE, easing: easeInCubic },
      ];
    }
    return [
      { p: 0, pose: from },
      { p: 0.08, pose: peak, easing: easeOutCubic },
      { p: 0.92, pose: peak },
      { p: 1, pose: BASELINE, easing: easeInCubic },
    ];
  }

  function startMicroFaceTweens(rig, microDurationMs) {
    var rigKind = rig.getAttribute("data-rig-kind") || "bot";
    if (rigKind === "human-photo") return;
    if (reduce.matches) return;
    var layer = rig.querySelector(".avatar-micro-expression");
    if (!layer) return;
    var eyesEl = layer.querySelector(".face-eyes");
    var mouthEl = layer.querySelector(".face-mouth");
    var browsEl = layer.querySelector(".face-brows");
    if (!eyesEl && !mouthEl && !browsEl) return;

    var microKind = rig.getAttribute("data-micro-kind") || "";
    var poses = buildMicroPoses(rig, microKind);
    var dur = microDurationMs;

    var eyesPeakStart = poses.alert ? 0.22 : 0.24;
    var eyesPeakEnd = poses.alert ? 0.78 : 0.76;
    var eyesReturnAt = poses.alert ? 0.88 : 0.86;

    var eyesFrom = (eyesEl && getCurrentPose(rig, "micro", "eyes")) || BASELINE;
    var mouthFrom = (mouthEl && getCurrentPose(rig, "micro", "mouth")) ||
      BASELINE;
    var browsFrom = (browsEl && getCurrentPose(rig, "micro", "brows")) ||
      BASELINE;
    cancelTweensFor(rig, "micro");

    if (eyesEl) {
      pushTween(rig, "micro", "eyes", eyesEl, [
        { p: 0, pose: eyesFrom },
        { p: eyesPeakStart, pose: poses.eyes.peak, easing: easeInOutCubic },
        { p: eyesPeakEnd, pose: poses.eyes.peak },
        { p: eyesReturnAt, pose: poses.eyes.ret, easing: easeInOutCubic },
        { p: 1, pose: BASELINE, easing: easeInOutCubic },
      ], { dur: dur });
    }
    if (mouthEl) {
      pushTween(rig, "micro", "mouth", mouthEl, [
        { p: 0, pose: mouthFrom },
        { p: 0.24, pose: poses.mouth.peak, easing: easeInOutCubic },
        { p: 0.78, pose: poses.mouth.peak },
        { p: 0.88, pose: poses.mouth.ret, easing: easeInOutCubic },
        { p: 1, pose: BASELINE, easing: easeInOutCubic },
      ], { dur: dur });
    }
    if (browsEl) {
      pushTween(rig, "micro", "brows", browsEl, [
        { p: 0, pose: browsFrom },
        { p: 0.22, pose: poses.brows.peak, easing: easeInOutCubic },
        { p: 0.78, pose: poses.brows.peak },
        { p: 0.88, pose: poses.brows.ret, easing: easeInOutCubic },
        { p: 1, pose: BASELINE, easing: easeInOutCubic },
      ], { dur: dur });
    }
  }

  function clearReactionState(rig) {
    rig.classList.remove(
      "is-reacting",
      "motion-pop",
      "motion-shake",
      "motion-sink",
    );
    cancelTweensFor(rig, "macro", { clearTransform: true });
  }

  function clearMicroState(rig) {
    rig.classList.remove("is-micro-reacting");
    cancelTweensFor(rig, "micro", { clearTransform: true });
  }

  // -- Idle pass: autonomous drift, blink, and cross-seat gaze. -------------
  var idleRunning = false;

  function startAutonomousIdleLoop() {
    if (reduce.matches) return;
    if (isIOSCompositorGuard()) return;
    if (idleRunning) return;
    idleRunning = true;
    ensureLoop();
  }

  function clearIdleDrift(rig) {
    rig.style.removeProperty("--idle-drift-tx");
    rig.style.removeProperty("--idle-brow-ty");
    rig.style.removeProperty("--idle-mouth-sx");
    rig.style.removeProperty("--idle-mouth-ty");
    rig.style.removeProperty("--idle-nose-sx");
    rig.style.removeProperty("--rig-light-x");
    rig.style.removeProperty("--rig-light-y");
    rig.style.removeProperty("--rig-breath-tx");
    rig.style.removeProperty("--rig-breath-ty");
    rig.style.removeProperty("--rig-breath-rot");
    rig.style.removeProperty("--rig-breath-scale");
    rig.style.removeProperty("--face-sad-amount");
  }

  function moodBias(expression, strength) {
    var s = clamp(strength, 0, 1);
    switch (expression) {
      case "happiness":
        return { brow: -1.3 * s, mouthScale: 0.05 * s, mouthY: -0.4 * s, sad: 0 };
      case "sadness":
        return { brow: 1.3 * s, mouthScale: -0.04 * s, mouthY: 0.8 * s, sad: s };
      case "anger":
        return { brow: 1.8 * s, mouthScale: -0.03 * s, mouthY: 0.2 * s, sad: 0 };
      case "fear":
      case "surprise":
        return { brow: -2.2 * s, mouthScale: 0.08 * s, mouthY: 0.6 * s, sad: 0 };
      default:
        return { brow: 0, mouthScale: 0, mouthY: 0, sad: 0 };
    }
  }

  function tickAutonomousIdle(now) {
    if (!idleRunning) return;
    if (reduce.matches) {
      idleRunning = false;
      return;
    }
    var rigs = document.querySelectorAll(".avatar-rig");
    if (!rigs.length) {
      idleRunning = false;
      return;
    }
    for (var i = 0; i < rigs.length; i++) {
      var rig = rigs[i];
      if (
        rig.getAttribute("data-rig-kind") === "human-photo" ||
        shouldSkipIdle(rig)
      ) {
        clearIdleDrift(rig);
        continue;
      }
      var rigId = rig.id || "";
      var phase = hashRigPhase(rigId) * Math.PI * 2;
      var amp = readAmplitude(rig);
      var speed = 0.0012 + hashRigPhase(rigId + "-speed") * 0.00055;
      var t = now * speed + phase;
      var s = state[rigId] || {};
      var mood = s.mood;
      var moodStrength = mood && mood.until > now ? (mood.until - now) / mood.durationMs : 0;
      var bias = moodBias(mood ? mood.expression : "", moodStrength);
      var driftTarget = Math.sin(t * 0.61) * 0.9 * amp;
      var breathTxTarget = Math.sin(t * 0.41 + 1.3) * 0.55 * amp;
      var breathTyTarget = Math.sin(t * 0.53 + 2.1) * 0.85 * amp;
      var breathRotTarget = Math.sin(t * 0.37 + 0.7) * 0.6 * amp;
      var axisX = readVar(rig, "--rig-axis-x", 0);
      var axisY = readVar(rig, "--rig-axis-y", 0);
      // Face features ride the breath: brows, mouth Y, and mouth scale all
      // derive from breathTyTarget so the face moves as one coherent
      // rhythm rather than three independent oscillators drifting in and
      // out of phase. Sub-pixel coupling factors keep this as ambient
      // breath, not lipsync without sound. Mood biases are preserved as
      // steady offsets so reactions still steer the resting expression.
      var browTarget = breathTyTarget * BROW_FROM_BREATH + bias.brow;
      var mouthYTarget = breathTyTarget * MOUTH_Y_FROM_BREATH + bias.mouthY;
      var mouthTarget = 1 - breathTyTarget * MOUTH_SCALE_FROM_BREATH +
        bias.mouthScale;
      // Nose breath flare: a quieter scale-x oscillator on the same breath
      // phase. Coupling is intentionally an order of magnitude smaller than
      // the mouth so the nose pulses subtly, suggesting nostril dilation
      // rather than a cartoon honk.
      var noseSxTarget = 1 - breathTyTarget * NOSE_SX_FROM_BREATH;
      var breathScaleTarget = 1 + breathTyTarget * BREATH_SCALE_FROM_BREATH;
      var lightXTarget = (axisX + breathTxTarget) * LIGHT_X_FROM_HEAD;
      var lightYTarget = (axisY + breathTyTarget) * LIGHT_Y_FROM_HEAD;
      var prev = s.idlePose || {
        brow: 0,
        mouthScale: 1,
        mouthY: 0,
        noseSx: 1,
        breathScale: 1,
        lightX: 0,
        lightY: 0,
        drift: 0,
        breathTx: 0,
        breathTy: 0,
        breathRot: 0,
      };
      var next = {
        brow: approach(prev.brow, browTarget, 0.08),
        mouthScale: approach(prev.mouthScale, mouthTarget, 0.08),
        mouthY: approach(prev.mouthY, mouthYTarget, 0.08),
        noseSx: approach(prev.noseSx, noseSxTarget, 0.07),
        breathScale: approach(prev.breathScale || 1, breathScaleTarget, 0.06),
        lightX: approach(prev.lightX || 0, lightXTarget, 0.07),
        lightY: approach(prev.lightY || 0, lightYTarget, 0.07),
        drift: approach(prev.drift, driftTarget, 0.07),
        breathTx: approach(prev.breathTx || 0, breathTxTarget, 0.06),
        breathTy: approach(prev.breathTy || 0, breathTyTarget, 0.06),
        breathRot: approach(prev.breathRot || 0, breathRotTarget, 0.06),
      };
      s.idlePose = next;
      state[rigId] = s;
      rig.style.setProperty("--idle-drift-tx", next.drift.toFixed(2) + "px");
      rig.style.setProperty("--idle-brow-ty", next.brow.toFixed(2) + "px");
      rig.style.setProperty("--idle-mouth-sx", next.mouthScale.toFixed(3));
      rig.style.setProperty("--idle-mouth-ty", next.mouthY.toFixed(2) + "px");
      rig.style.setProperty("--idle-nose-sx", next.noseSx.toFixed(3));
      rig.style.setProperty("--rig-light-x", next.lightX.toFixed(2) + "px");
      rig.style.setProperty("--rig-light-y", next.lightY.toFixed(2) + "px");
      rig.style.setProperty("--rig-breath-tx", next.breathTx.toFixed(2) + "px");
      rig.style.setProperty("--rig-breath-ty", next.breathTy.toFixed(2) + "px");
      rig.style.setProperty(
        "--rig-breath-rot",
        next.breathRot.toFixed(2) + "deg",
      );
      rig.style.setProperty("--rig-breath-scale", next.breathScale.toFixed(4));
      rig.style.setProperty("--face-sad-amount", bias.sad.toFixed(3));
    }
  }

  function shouldSkipIdle(rig) {
    if (rig.classList.contains("is-reacting")) return true;
    if (rig.classList.contains("is-micro-reacting")) return true;
    if (rig.classList.contains("is-speaking")) return true;
    return false;
  }

  function hashRigPhase(rigId) {
    var h = 0;
    for (var i = 0; i < rigId.length; i++) {
      h = ((h << 5) - h + rigId.charCodeAt(i)) | 0;
    }
    return Math.abs((h % 1000) / 1000);
  }

  function fireBlink(rig) {
    var startMs = performance.now();
    var dur = 130;
    function step() {
      var live = document.getElementById(rig.id);
      if (!live) return;
      if (shouldSkipIdle(live)) {
        live.style.removeProperty("--idle-blink-sy");
        live.style.removeProperty("--idle-catchlight-ty");
        return;
      }
      var elapsed = performance.now() - startMs;
      var p = elapsed / dur;
      if (p >= 1) {
        live.style.removeProperty("--idle-blink-sy");
        live.style.removeProperty("--idle-catchlight-ty");
        return;
      }
      var sy;
      if (p < 0.5) sy = lerp(1, 0.05, easeInOutCubic(p / 0.5));
      else sy = lerp(0.05, 1, easeInOutCubic((p - 0.5) / 0.5));
      live.style.setProperty("--idle-blink-sy", String(sy));
      // Specular reset: catchlight dips ~1px during the lid-close phase
      // and snaps back as the eye reopens. Sells the wet-eye illusion by
      // implying the highlight is reflecting off a moving fluid surface.
      live.style.setProperty(
        "--idle-catchlight-ty",
        ((1 - sy) * 1).toFixed(2) + "px",
      );
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function blinkDelayFor(rig) {
    var base = 3500 + Math.random() * 2500;
    // Attentive-gaze stretch: data-gaze-depth="near" signals the rig is
    // looking at something close (e.g. a card on the table). Humans blink
    // ~30% less often while focused on a near object; honour the same
    // signal so the rig reads as engaged rather than absent.
    if (rig.getAttribute("data-gaze-depth") === "near") base *= 1.3;
    if (!rig.classList.contains("is-reacting")) return base;
    var expr = rig.getAttribute("data-reaction-expression") || "";
    if (expr === "anger" || expr === "focused") return base * 1.6;
    if (expr === "sadness") return base * 1.3;
    if (expr === "surprise" || expr === "fear") return 8000;
    return base;
  }

  function startBlinkLoop(rig) {
    if (reduce.matches) return;
    if (isIOSCompositorGuard()) return;
    if (rig.getAttribute("data-rig-kind") === "human-photo") return;
    var rigId = rig.id;
    var s = state[rigId];
    if (!s || s.blinkRunning) return;
    s.blinkRunning = true;
    var initialDelay = 800 + hashRigPhase(rigId) * 4000;
    setTimeout(function step() {
      var live = document.getElementById(rigId);
      if (!live || !live.classList.contains("avatar-rig")) {
        s.blinkRunning = false;
        return;
      }
      if (!shouldSkipIdle(live)) fireBlink(live);
      setTimeout(step, blinkDelayFor(live));
    }, initialDelay);
  }

  // -- Cross-seat gaze ------------------------------------------------------
  var GAZE_FLICK_MS = 220;
  var GAZE_HOLD_MS = 480;
  var GAZE_RELEASE_MS = 360;
  var GAZE_TOTAL_MS = GAZE_FLICK_MS + GAZE_HOLD_MS + GAZE_RELEASE_MS;
  var GAZE_TX_CLAMP = 3;

  function fireGaze(observerRig, targetTx) {
    if (reduce.matches) return;
    if (isIOSCompositorGuard()) return;
    if (observerRig.getAttribute("data-rig-kind") === "human-photo") return;
    var startMs = performance.now();
    var rigId = observerRig.id;
    function step() {
      var live = document.getElementById(rigId);
      if (!live) return;
      var elapsed = performance.now() - startMs;
      var tx;
      if (elapsed < GAZE_FLICK_MS) {
        tx = lerp(0, targetTx, easeOutCubic(elapsed / GAZE_FLICK_MS));
      } else if (elapsed < GAZE_FLICK_MS + GAZE_HOLD_MS) {
        tx = targetTx;
      } else if (elapsed < GAZE_TOTAL_MS) {
        var rp = (elapsed - GAZE_FLICK_MS - GAZE_HOLD_MS) / GAZE_RELEASE_MS;
        tx = lerp(targetTx, 0, easeInOutCubic(rp));
      } else {
        live.style.removeProperty("--idle-gaze-tx");
        live.style.removeProperty("--idle-catchlight-conv");
        return;
      }
      live.style.setProperty("--idle-gaze-tx", tx.toFixed(2) + "px");
      // Catchlight convergence: both catchlights nudge inward proportional
      // to gaze magnitude, selling a "focused on something close" reading
      // via the wet-eye highlights since the underlying iris geometry is
      // monolithic and can't be shifted per-eye.
      live.style.setProperty(
        "--idle-catchlight-conv",
        (Math.abs(tx) * 0.18).toFixed(2) + "px",
      );
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function broadcastGaze(actorRig) {
    if (reduce.matches) return;
    if (actorRig.getAttribute("data-rig-kind") === "human-photo") return;
    var actorRect = actorRig.getBoundingClientRect();
    if (!actorRect.width) return;
    var actorCx = actorRect.left + actorRect.width / 2;
    var rigs = document.querySelectorAll(".avatar-rig");
    for (var i = 0; i < rigs.length; i++) {
      var observer = rigs[i];
      if (observer === actorRig) continue;
      if (observer.getAttribute("data-rig-kind") === "human-photo") continue;
      var oRect = observer.getBoundingClientRect();
      if (!oRect.width) continue;
      var oCx = oRect.left + oRect.width / 2;
      var dx = actorCx - oCx;
      var sign = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
      var targetTx = sign * GAZE_TX_CLAMP;
      if (targetTx !== 0) fireGaze(observer, targetTx);
    }
  }

  // -- Reaction sync --------------------------------------------------------
  var RIG_ID_PREFIX = "avatar-rig-";

  function readMacroPayload(rig, prefix) {
    var dur = Number(rig.getAttribute("data-" + prefix + "-duration-ms") || 0) ||
      DEFAULT_REACTION_MS;
    return {
      kind: rig.getAttribute("data-" + prefix + "-kind") || "",
      expression: rig.getAttribute("data-" + prefix + "-expression") || "",
      motion: rig.getAttribute("data-" + prefix + "-motion") || "",
      intensity: Number(rig.getAttribute("data-" + prefix + "-intensity") || 0),
      cue: rig.getAttribute("data-" + prefix + "-voice-cue") || "",
      durationMs: dur,
      confidence: readConfidence(rig, prefix),
      prefix: prefix,
    };
  }

  function fireMacro(rig, payload) {
    var rigId = rig.id;
    var s = state[rigId];
    if (!s) return;
    var seatId = rigId.startsWith(RIG_ID_PREFIX) ? rigId.slice(RIG_ID_PREFIX.length) : "";
    var rigKind = rig.getAttribute("data-rig-kind") || "bot";
    var seatProbAttr = parseFloat(rig.getAttribute("data-seat-audio-probability"));
    var seatAudioProb = (isFinite(seatProbAttr) ? seatProbAttr : 1) * payload.confidence;
    audioPlay({
      cue: payload.cue,
      intensity: payload.intensity,
      rigKind: rigKind,
      seatId: seatId,
      rigId: rigId,
      seatAudioProbability: seatAudioProb,
    });
    clearReactionState(rig);
    rig.style.setProperty("--reaction-duration-ms", payload.durationMs + "ms");
    void rig.offsetWidth;

    rig.classList.add("is-reacting");
    var isPhoto = rigKind === "human-photo";
    if (!isPhoto && !reduce.matches && payload.motion) {
      rig.classList.add("motion-" + payload.motion);
    }
    s.mood = {
      expression: payload.expression ||
        rig.getAttribute("data-reaction-expression") || "",
      until: performance.now() + Math.min(4200, payload.durationMs * 1.6),
      durationMs: Math.min(4200, payload.durationMs * 1.6),
    };
    startMacroFaceTweens(rig, payload);
    broadcastGaze(rig);
    s.timer = setTimeout(function () {
      var currentRig = document.getElementById(rigId);
      if (!currentRig) return;
      clearReactionState(currentRig);
    }, payload.durationMs);
  }

  function syncMacroReaction(rig, rigId, s, id, precedingId) {
    var precedingAdvanced = precedingId > (s.lastPrecedingId || 0);
    var mainAdvanced = id > s.lastMacroId;
    if (!precedingAdvanced && !mainAdvanced) return;

    var preceding = precedingAdvanced ? readMacroPayload(rig, "preceding") : null;
    var main = mainAdvanced ? readMacroPayload(rig, "reaction") : null;
    if (preceding && !preceding.kind) preceding = null;
    if (main && !main.kind) main = null;
    if (preceding) s.lastPrecedingId = precedingId;
    if (main) s.lastMacroId = id;
    if (!preceding && !main) return;

    clearTimeout(s.timer);
    if (preceding && main) {
      fireMacro(rig, preceding);
      s.timer = setTimeout(function () {
        var currentRig = document.getElementById(rigId);
        if (!currentRig) return;
        fireMacro(currentRig, main);
      }, preceding.durationMs);
    } else {
      fireMacro(rig, preceding || main);
    }
  }

  function syncMicroReaction(rig, rigId, s, microId) {
    if (microId <= s.lastMicroId) return;
    var microKind = rig.getAttribute("data-micro-kind") || "";
    if (!microKind) return;
    var microDurationMs = Number(rig.getAttribute("data-micro-duration-ms") || 0) || 2000;
    s.lastMicroId = microId;
    clearTimeout(s.microTimer);
    clearMicroState(rig);
    rig.style.setProperty("--micro-duration-ms", microDurationMs + "ms");
    void rig.offsetWidth;
    rig.classList.add("is-micro-reacting");
    s.mood = {
      expression: rig.getAttribute("data-micro-expression") || "",
      until: performance.now() + Math.min(2600, microDurationMs * 1.2),
      durationMs: Math.min(2600, microDurationMs * 1.2),
    };
    startMicroFaceTweens(rig, microDurationMs);
    broadcastGaze(rig);
    s.microTimer = setTimeout(function () {
      var currentRig = document.getElementById(rigId);
      if (!currentRig) return;
      clearMicroState(currentRig);
    }, microDurationMs);
  }

  function syncRig(rig) {
    var rigId = rig.id;
    if (!rigId) return;
    var id = Number(rig.getAttribute("data-reaction-id") || 0);
    var precedingId = Number(rig.getAttribute("data-preceding-id") || 0);
    var microId = Number(rig.getAttribute("data-micro-id") || 0);
    var s = state[rigId] || (state[rigId] = {
      lastMacroId: null,
      lastPrecedingId: null,
      lastMicroId: null,
      timer: 0,
      microTimer: 0,
      blinkRunning: false,
    });
    startBlinkLoop(rig);
    startAutonomousIdleLoop();
    if (s.lastMacroId === null || s.lastMicroId === null) {
      s.lastMacroId = id;
      s.lastPrecedingId = precedingId;
      s.lastMicroId = microId;
      return;
    }
    syncMacroReaction(rig, rigId, s, id, precedingId);
    syncMicroReaction(rig, rigId, s, microId);
  }

  function sync() {
    var rigs = document.querySelectorAll(".avatar-rig");
    for (var i = 0; i < rigs.length; i++) syncRig(rigs[i]);
  }

  // Called during the HTMX before-swap event for a #rig-slot-* outerMorph.
  // The server emits fresh rig markup inside the partial, but active animations
  // live on the existing rig nodes. Copy the new reaction attributes onto the
  // live node and conditionally replace the SVG layers. morphSkip on .avatar-rig
  // (htmx-config) then leaves the wrapper alone, so its CSS @keyframes never
  // restart. If the rig substrate changed, swap the wrapper outright; that
  // restart is acceptable for the rare substrate change.
  function prepareSwap(fragment) {
    if (!fragment || !fragment.querySelectorAll) return;
    var incomingRigs = fragment.querySelectorAll(".avatar-rig");
    for (var i = 0; i < incomingRigs.length; i++) {
      prepareIncomingRig(incomingRigs[i]);
    }
  }

  function prepareIncomingRig(incoming) {
    if (!incoming.id) return;
    var live = document.getElementById(incoming.id);
    if (!live || !live.classList || !live.classList.contains("avatar-rig")) return;
    if (!sameRigSignature(live, incoming)) {
      live.replaceWith(incoming.cloneNode(true));
      return;
    }
    updatePreservedRig(live, incoming);
  }

  function sameRigSignature(a, b) {
    return (a.getAttribute("data-rig-signature") || "") ===
      (b.getAttribute("data-rig-signature") || "");
  }

  function updatePreservedRig(live, incoming) {
    var s = state[live.id] || null;
    var oldMacroId = s && s.lastMacroId !== null
      ? s.lastMacroId
      : Number(live.getAttribute("data-reaction-id") || 0);
    var oldPrecedingId = s && s.lastPrecedingId !== null
      ? s.lastPrecedingId
      : Number(live.getAttribute("data-preceding-id") || 0);
    var oldMicroId = s && s.lastMicroId !== null
      ? s.lastMicroId
      : Number(live.getAttribute("data-micro-id") || 0);
    var nextMacroId = Number(incoming.getAttribute("data-reaction-id") || 0);
    var nextPrecedingId = Number(incoming.getAttribute("data-preceding-id") || 0);
    var nextMicroId = Number(incoming.getAttribute("data-micro-id") || 0);

    copyRigAttributes(live, incoming);

    if (
      nextMacroId > oldMacroId || nextPrecedingId > oldPrecedingId ||
      !live.classList.contains("is-reacting")
    ) {
      replaceLayer(live, incoming, ".avatar-expression");
    }
    if (nextMicroId > oldMicroId || !live.classList.contains("is-micro-reacting")) {
      replaceLayer(live, incoming, ".avatar-micro-expression");
    }
  }

  function copyRigAttributes(live, incoming) {
    var copyPrefixes = [
      "data-rig-",
      "data-seat-audio-probability",
      "data-reaction-",
      "data-preceding-",
      "data-micro-",
    ];
    for (var i = live.attributes.length - 1; i >= 0; i--) {
      var name = live.attributes[i].name;
      if (shouldCopyRigAttr(name, copyPrefixes)) live.removeAttribute(name);
    }
    for (var j = 0; j < incoming.attributes.length; j++) {
      var attr = incoming.attributes[j];
      if (shouldCopyRigAttr(attr.name, copyPrefixes)) {
        live.setAttribute(attr.name, attr.value);
      }
    }

    var nextAmp = incoming.style.getPropertyValue("--seat-amplitude-scale");
    if (nextAmp) live.style.setProperty("--seat-amplitude-scale", nextAmp.trim());
    else live.style.removeProperty("--seat-amplitude-scale");
  }

  function shouldCopyRigAttr(name, prefixes) {
    for (var i = 0; i < prefixes.length; i++) {
      var p = prefixes[i];
      if (name === p || name.indexOf(p) === 0) return true;
    }
    return false;
  }

  function replaceLayer(live, incoming, selector) {
    var next = incoming.querySelector(selector);
    var current = live.querySelector(selector);
    if (!next || !current) return;
    current.replaceWith(next.cloneNode(true));
  }

  // Recovery on tab-hide.
  function installVisibilityRecovery() {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "hidden") return;
      for (var i = 0; i < liveTweens.length; i++) {
        var t = liveTweens[i];
        t.cancelled = true;
        if (t.element && t.element.isConnected) t.element.style.transform = "";
      }
      liveTweens = [];
      var rigs = document.querySelectorAll(".avatar-rig");
      for (var j = 0; j < rigs.length; j++) {
        rigs[j].style.removeProperty("--idle-blink-sy");
        rigs[j].style.removeProperty("--idle-gaze-tx");
        rigs[j].style.removeProperty("--idle-catchlight-conv");
        rigs[j].style.removeProperty("--idle-nose-sx");
        rigs[j].style.removeProperty("--rig-light-x");
        rigs[j].style.removeProperty("--rig-light-y");
        rigs[j].style.removeProperty("--rig-breath-tx");
        rigs[j].style.removeProperty("--rig-breath-ty");
        rigs[j].style.removeProperty("--rig-breath-rot");
        rigs[j].style.removeProperty("--rig-breath-scale");
        rigs[j].style.removeProperty("--face-sad-amount");
      }
    });
  }

  function tweenCountFor(rigId) {
    var n = 0;
    for (var i = 0; i < liveTweens.length; i++) {
      if (liveTweens[i].rig.id === rigId && !liveTweens[i].cancelled) n++;
    }
    return n;
  }

  // -- Dev-only rig inspector, gated by ?rigDebug=1 -------------------------
  function installDebugOverlay() {
    if (!new URLSearchParams(location.search).has("rigDebug")) return;
    var panel = document.createElement("div");
    panel.id = "rig-debug-panel";
    panel.style.cssText = "position:fixed;bottom:8px;right:8px;z-index:9999;" +
      "background:rgba(0,0,0,0.78);color:#fff;font:11px/1.35 ui-monospace,monospace;" +
      "padding:8px 10px;border-radius:6px;pointer-events:none;white-space:pre;" +
      "max-width:360px;";
    document.body.appendChild(panel);

    function rowFor(rig) {
      var amp = rig.style.getPropertyValue("--seat-amplitude-scale") || "1";
      var audio = rig.getAttribute("data-seat-audio-probability") || "1";
      var kind = rig.getAttribute("data-rig-kind") || "?";
      var rxKind = rig.getAttribute("data-reaction-kind") || "-";
      var rxIntensity = rig.getAttribute("data-reaction-intensity") || "0";
      var rxDuration = rig.getAttribute("data-reaction-duration-ms") || "0";
      var microKind = rig.getAttribute("data-micro-kind") || "-";
      var flags = [];
      if (rig.classList.contains("is-reacting")) flags.push("REACT");
      if (rig.classList.contains("is-micro-reacting")) flags.push("MICRO");
      if (rig.classList.contains("is-speaking")) flags.push("SPEAK");
      var name = (rig.id || "").replace("avatar-rig-", "") || "?";
      var blinkSy = rig.style.getPropertyValue("--idle-blink-sy");
      var gazeTx = rig.style.getPropertyValue("--idle-gaze-tx");
      var idle = "";
      if (blinkSy) idle += " blink=" + Number(blinkSy).toFixed(2);
      if (gazeTx) idle += " gaze=" + gazeTx.trim();
      return name.padEnd(6) + " " + kind.padEnd(15) +
        "amp=" + amp.padEnd(5) + " aud=" + audio.padEnd(4) +
        " rx=" + rxKind + "(i" + rxIntensity + "/" + rxDuration + "ms)" +
        " micro=" + microKind +
        " tw=" + tweenCountFor(rig.id) +
        idle +
        (flags.length ? " [" + flags.join(",") + "]" : "");
    }

    function render() {
      var rigs = document.querySelectorAll(".avatar-rig");
      var lines = ["rigDebug - " + new Date().toLocaleTimeString()];
      for (var i = 0; i < rigs.length; i++) lines.push(rowFor(rigs[i]));
      panel.textContent = lines.join("\n");
    }

    setInterval(render, 100);
    render();
  }

  // -- Public API -----------------------------------------------------------
  function init(userConfig) {
    if (initialized) return;
    initialized = true;
    if (userConfig) {
      if (userConfig.audioAssets) config.audioAssets = userConfig.audioAssets;
      if (userConfig.silenceSrc) config.silenceSrc = userConfig.silenceSrc;
      if (typeof userConfig.isAudioEnabled === "function") {
        config.isAudioEnabled = userConfig.isAudioEnabled;
      }
      if (userConfig.voiceProbabilityByKind) {
        config.voiceProbabilityByKind = userConfig.voiceProbabilityByKind;
      }
    }
    installAudioWarmup();
    installVisibilityRecovery();
    installDebugOverlay();
  }

  window.FacialRig = {
    init: init,
    prepareSwap: prepareSwap,
    sync: sync,
    play: audioPlay,
    startSpeaking: startSpeaking,
    stopSpeaking: stopSpeaking,
  };
})();
