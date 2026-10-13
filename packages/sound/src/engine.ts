/**
 * The UI sound engine. Framework-agnostic, Web Audio only, no assets.
 *
 * Hard rules, each enforced in play() or unlock():
 * - The AudioContext is created lazily, inside a user gesture (unlock), never at import or load.
 * - Nothing plays while the document is hidden, the engine is disabled, or the volume is zero.
 * - The engine never touches the narration audio element or its audio session. It only asks the
 *   app whether narration is playing, then skips or ducks per recipe.
 * - A suspended or interrupted context is resumed and the call is dropped, but the latest one is
 *   kept for 300 ms and played once the resume lands. Scheduling into a suspended context would
 *   replay every sound late, as a burst, when it resumes.
 * - At most four voices at once. The oldest voice is faded out in 12 ms to make room.
 * - On iOS, Web Audio follows the silent switch and is treated as ambient audio, so a silenced
 *   phone plays no UI sound. That is the intended behavior.
 */
import { generateNoise } from "./noise.js";
import {
  dbToGain,
  FLOOR,
  MASTER_LOWPASS,
  MAX_POLYPHONY,
  type NoiseLayer,
  type PlayOptions,
  RECIPES,
  recipeDurationMs,
  resolveFrequency,
  type SoundName,
  type ToneLayer,
  volumeToGain,
} from "./recipes.js";

export interface SoundEngineOptions {
  /** The Sounds switch in settings. Reduced motion should default this to false until the user opts in. */
  isEnabled: () => boolean;
  /** Master volume, 0 to 1. */
  getVolume: () => number;
  /** True while the narration audio element is playing. */
  isNarrationPlaying: () => boolean;
  /** Test seam. Defaults to document.hidden. */
  isHidden?: () => boolean;
  /** Test seam. Defaults to `new AudioContext()`. */
  createContext?: () => AudioContext;
  /** Test seam for rate limiting. Defaults to performance.now(). */
  now?: () => number;
}

export interface SoundEngine {
  /** Plays a sound. Returns true when a voice was scheduled. */
  play: (name: SoundName, options?: PlayOptions) => boolean;
  /** Creates and resumes the AudioContext. Call from inside a user gesture. Safe to call often. */
  unlock: () => void;
  /** Stops everything and closes the context. */
  dispose: () => void;
  /** Voices currently sounding, at most four. For the lab's polyphony meter and tests. */
  activeVoices: () => number;
}

interface Voice {
  endsAt: number;
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
  remaining: number;
}

interface Graph {
  input: GainNode;
  noise: AudioBuffer;
}

/** How long a cue dropped by a suspended context waits for the resume before it is stale. */
const QUEUED_CUE_MS = 300;

/** Layer start offsets into the shared noise buffer, so two noise layers never share samples. */
const noiseOffsetSeconds = (layerIndex: number): number => (layerIndex * 0.137) % 0.5;

/** Floor, then an exponential rise to the peak, then an exponential fall back to the floor. */
function scheduleEnvelope(
  param: AudioParam,
  start: number,
  attackMs: number,
  decayMs: number,
  peak: number,
): void {
  param.setValueAtTime(FLOOR, start);
  param.exponentialRampToValueAtTime(peak, start + attackMs / 1000);
  param.exponentialRampToValueAtTime(FLOOR, start + (attackMs + decayMs) / 1000);
}

export function createSoundEngine(options: SoundEngineOptions): SoundEngine {
  const {
    isEnabled,
    getVolume,
    isNarrationPlaying,
    isHidden = () => typeof document !== "undefined" && document.hidden,
    createContext = () => new AudioContext(),
    now = () => performance.now(),
  } = options;

  let context: AudioContext | null = null;
  let graph: Graph | null = null;
  let disposed = false;
  let voices: Voice[] = [];
  let queued: { name: SoundName; options: PlayOptions; at: number } | null = null;
  const lastPlayedAt = new Map<SoundName, number>();

  function buildGraph(ctx: AudioContext): Graph {
    const input = ctx.createGain();
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = MASTER_LOWPASS.frequencyHz;
    lowpass.Q.value = MASTER_LOWPASS.qDb;
    // A safety net, not a sound shaper: the threshold sits above every recipe's peak.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.08;
    input.connect(lowpass);
    lowpass.connect(limiter);
    limiter.connect(ctx.destination);

    const samples = generateNoise(ctx.sampleRate);
    const noise = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    noise.getChannelData(0).set(samples);
    return { input, noise };
  }

  function retire(voice: Voice): void {
    voices = voices.filter((candidate) => candidate !== voice);
    try {
      voice.gain.disconnect();
    } catch {
      // Already disconnected.
    }
  }

  function stealOldest(ctx: AudioContext): void {
    const oldest = voices[0];
    if (!oldest) return;
    const t = ctx.currentTime;
    oldest.gain.gain.cancelScheduledValues(t);
    oldest.gain.gain.setTargetAtTime(0, t, 0.004);
    for (const source of oldest.sources) {
      try {
        source.stop(t + 0.012);
      } catch {
        // Already stopped.
      }
    }
    retire(oldest);
  }

  function scheduleTone(
    ctx: AudioContext,
    layer: ToneLayer,
    playOptions: PlayOptions,
    t0: number,
    destination: AudioNode,
    voice: Voice,
  ): void {
    const start = t0 + layer.startMs / 1000;
    const frequency = resolveFrequency(layer, playOptions);
    let layerOut: AudioNode = destination;
    if (layer.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = layer.lowpass.frequencyHz;
      filter.Q.value = layer.lowpass.qDb;
      filter.connect(destination);
      layerOut = filter;
    }

    const parts = [
      { ratio: 1, gain: 1, decayScale: 1, wave: layer.wave },
      ...(layer.partials ?? []).map((partial) => ({ ...partial, wave: "sine" as const })),
    ];
    for (const part of parts) {
      const oscillator = ctx.createOscillator();
      oscillator.type = part.wave;
      const target = frequency * part.ratio;
      if (layer.glide) {
        oscillator.frequency.setValueAtTime(target * layer.glide.fromRatio, start);
        oscillator.frequency.exponentialRampToValueAtTime(target, start + layer.glide.ms / 1000);
      } else {
        oscillator.frequency.setValueAtTime(target, start);
      }
      if (layer.detuneCents) oscillator.detune.value = layer.detuneCents;

      const envelope = ctx.createGain();
      envelope.gain.value = 0;
      const decayMs = layer.decayMs * part.decayScale;
      scheduleEnvelope(envelope.gain, start, layer.attackMs, decayMs, layer.peak * part.gain);
      oscillator.connect(envelope);
      envelope.connect(layerOut);

      oscillator.start(start);
      oscillator.stop(start + (layer.attackMs + decayMs) / 1000 + 0.02);
      track(voice, oscillator, envelope);
    }
  }

  function scheduleNoise(
    ctx: AudioContext,
    layer: NoiseLayer,
    layerIndex: number,
    t0: number,
    destination: AudioNode,
    voice: Voice,
    noise: AudioBuffer,
  ): void {
    const start = t0 + layer.startMs / 1000;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = layer.filter.type;
    filter.frequency.value = layer.filter.frequencyHz;
    filter.Q.value = layer.filter.type === "lowpass" ? layer.filter.qDb : layer.filter.q;
    const envelope = ctx.createGain();
    envelope.gain.value = 0;
    scheduleEnvelope(envelope.gain, start, layer.attackMs, layer.decayMs, layer.peak);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(destination);
    source.start(start, noiseOffsetSeconds(layerIndex));
    source.stop(start + (layer.attackMs + layer.decayMs) / 1000 + 0.02);
    track(voice, source, envelope, filter);
  }

  /** Disconnects a layer's nodes once its source ends, so nothing lingers in the graph. */
  function track(voice: Voice, source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    voice.sources.push(source);
    voice.remaining += 1;
    source.onended = () => {
      for (const node of [source, ...nodes]) {
        try {
          node.disconnect();
        } catch {
          // Already disconnected.
        }
      }
      voice.remaining -= 1;
      if (voice.remaining <= 0) retire(voice);
    };
  }

  function replay(): void {
    const cue = queued;
    queued = null;
    if (!cue || disposed || context?.state !== "running") return;
    if (now() - cue.at < QUEUED_CUE_MS) play(cue.name, cue.options);
  }

  function play(name: SoundName, playOptions: PlayOptions = {}): boolean {
    if (disposed || !isEnabled() || isHidden()) return false;
    const recipe = RECIPES[name];
    const volume = getVolume();
    if (!(volume > 0.001)) return false;

    let gain = volumeToGain(volume) * Math.min(1, Math.max(0, playOptions.gain ?? 1));
    if (isNarrationPlaying()) {
      if (recipe.whileNarrating.mode === "skip") return false;
      gain *= dbToGain(recipe.whileNarrating.gainDb);
    }

    const ctx = context;
    if (!ctx || !graph) return false;
    if (ctx.state !== "running") {
      // The latest dropped cue is kept for a moment and played once the resume lands, so the first
      // cue after a suspend is heard; one that waits longer than that is stale and is let go.
      queued = { name, options: playOptions, at: now() };
      void ctx
        .resume()
        .then(replay)
        .catch(() => undefined);
      return false;
    }

    const stamp = now();
    const previous = lastPlayedAt.get(name);
    if (previous !== undefined && stamp - previous < recipe.minIntervalMs) return false;
    lastPlayedAt.set(name, stamp);

    const t0 = ctx.currentTime + 0.005;
    voices = voices.filter((voice) => voice.endsAt > ctx.currentTime);
    while (voices.length >= MAX_POLYPHONY) stealOldest(ctx);

    const output = ctx.createGain();
    output.gain.value = gain;
    output.connect(graph.input);
    const voice: Voice = {
      endsAt: t0 + recipeDurationMs(recipe) / 1000 + 0.05,
      gain: output,
      sources: [],
      remaining: 0,
    };
    voices.push(voice);

    recipe.layers.forEach((layer, index) => {
      if (layer.kind === "tone") scheduleTone(ctx, layer, playOptions, t0, output, voice);
      else if (graph) scheduleNoise(ctx, layer, index, t0, output, voice, graph.noise);
    });
    return true;
  }

  function unlock(): void {
    if (disposed) return;
    // iOS mutes Web Audio while the ring/silent switch is on, unless the page asks for playback.
    try {
      const session = (navigator as { audioSession?: { type: string } }).audioSession;
      if (session && session.type !== "playback") session.type = "playback";
    } catch {
      // Not fatal: older browsers have no audio session.
    }
    if (!context) {
      try {
        context = createContext();
        graph = buildGraph(context);
      } catch {
        context = null;
        graph = null;
        return;
      }
    }
    if (context.state !== "running") void context.resume().catch(() => undefined);
    // Some iOS versions only leave "suspended" after a source starts inside the gesture.
    try {
      const silent = context.createBuffer(1, 1, context.sampleRate);
      const source = context.createBufferSource();
      source.buffer = silent;
      source.connect(context.destination);
      source.start();
    } catch {
      // Not fatal: resume() above is the main path.
    }
  }

  function dispose(): void {
    disposed = true;
    for (const voice of [...voices]) {
      for (const source of voice.sources) {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      }
      retire(voice);
    }
    if (context) void context.close().catch(() => undefined);
    context = null;
    graph = null;
  }

  function activeVoices(): number {
    if (!context) return 0;
    const t = context.currentTime;
    return voices.filter((voice) => voice.endsAt > t).length;
  }

  return { play, unlock, dispose, activeVoices };
}

/**
 * Calls engine.unlock() on the first user gestures. The context is created inside a real gesture,
 * which is the only moment mobile browsers allow it. Keeps listening afterwards because iOS can
 * interrupt the context (a call, an alarm) and a later gesture must be able to resume it.
 */
export function installGestureUnlock(
  engine: Pick<SoundEngine, "unlock">,
  target: EventTarget = document,
): () => void {
  // iOS Safari grants audio only inside touchend, pointerup or click, never pointerdown or
  // touchstart; Android Chrome counts the same. Listening to all of them covers both.
  const events = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
  const handler = (): void => engine.unlock();
  for (const type of events)
    target.addEventListener(type, handler, { capture: true, passive: true });
  return () => {
    for (const type of events) target.removeEventListener(type, handler, { capture: true });
  };
}

/**
 * Default for the Sounds setting. Sounds are on, except for people who asked their system for
 * reduced motion: they get silence until they opt in, since the preference often signals
 * sensitivity to stimulation in general.
 */
export function defaultSoundsEnabled(
  matchMedia: ((query: string) => { matches: boolean }) | undefined = typeof window !== "undefined"
    ? window.matchMedia?.bind(window)
    : undefined,
): boolean {
  if (!matchMedia) return true;
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}
