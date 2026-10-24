/**
 * Offline reference renderer for recipes. Pure TypeScript, no Web Audio.
 *
 * Why it exists: nobody can listen to a recipe in CI, so tests render each one to samples and
 * assert peak, RMS, length and spectrum. The sound lab draws its waveforms from the same renderer,
 * so what you see is what the tests measured.
 *
 * It mirrors the engine's graph: layer oscillators and noise with exponential envelopes, an
 * optional per-layer low-pass, one master gain, one master low-pass. Biquad coefficients follow
 * the Web Audio specification (lowpass Q in dB, bandpass Q linear), so the numbers carry over.
 */
import { generateNoise } from "./noise.js";
import {
  dbToGain,
  type FilterSpec,
  FLOOR,
  type Layer,
  MASTER_LOWPASS,
  type NoiseLayer,
  type PlayOptions,
  resolveFrequency,
  type SoundRecipe,
  type ToneLayer,
  volumeToGain,
} from "./recipes.js";

export interface RenderOptions extends PlayOptions {
  sampleRate?: number;
  /** Master volume 0 to 1, as the settings slider reports it. Defaults to 1. */
  volume?: number;
  /** Apply the recipe's narration ducking, as the engine does while speech is playing. */
  narrating?: boolean;
  /** Skip the master low-pass, to measure what the recipe contains before the shared filter. */
  bypassMasterFilter?: boolean;
}

export interface RenderResult {
  samples: Float32Array;
  sampleRate: number;
  /** Largest absolute sample. */
  peak: number;
  /** Root mean square over the whole buffer. */
  rms: number;
  /** Time of the last sample louder than -60 dBFS. */
  audibleMs: number;
}

const AUDIBLE_FLOOR = 0.001;

class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;

  constructor(spec: FilterSpec, sampleRate: number) {
    const omega = (2 * Math.PI * Math.min(spec.frequencyHz, sampleRate / 2 - 1)) / sampleRate;
    const cosOmega = Math.cos(omega);
    const sinOmega = Math.sin(omega);
    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;
    if (spec.type === "lowpass") {
      const alpha = sinOmega / (2 * 10 ** (spec.qDb / 20));
      b0 = (1 - cosOmega) / 2;
      b1 = 1 - cosOmega;
      b2 = (1 - cosOmega) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosOmega;
      a2 = 1 - alpha;
    } else {
      const alpha = sinOmega / (2 * spec.q);
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cosOmega;
      a2 = 1 - alpha;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(input: number): number {
    const output =
      this.b0 * input +
      this.b1 * this.x1 +
      this.b2 * this.x2 -
      this.a1 * this.y1 -
      this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = input;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }
}

/** The envelope the engine schedules: exponential from the floor to the peak, then back to the floor. */
export function envelopeAt(tMs: number, attackMs: number, decayMs: number, peak: number): number {
  if (tMs < 0 || peak <= FLOOR) return 0;
  if (tMs < attackMs) return FLOOR * (peak / FLOOR) ** (tMs / attackMs);
  const elapsed = tMs - attackMs;
  if (elapsed < decayMs) return peak * (FLOOR / peak) ** (elapsed / decayMs);
  return 0;
}

function addToneLayer(
  output: Float32Array,
  layer: ToneLayer,
  options: RenderOptions,
  sampleRate: number,
): void {
  const frequency = resolveFrequency(layer, options);
  const detune = 2 ** ((layer.detuneCents ?? 0) / 1200);
  const startSample = Math.round((layer.startMs / 1000) * sampleRate);
  const lengthSamples = Math.ceil(((layer.attackMs + layer.decayMs) / 1000) * sampleRate);
  const filter = layer.lowpass ? new Biquad(layer.lowpass, sampleRate) : null;

  const voices = [
    { ratio: 1, gain: 1, decayScale: 1 },
    ...(layer.partials ?? []).map((partial) => ({ ...partial })),
  ];
  const phases = voices.map(() => 0);

  for (let n = 0; n < lengthSamples; n += 1) {
    const tMs = (n / sampleRate) * 1000;
    const glideRatio = layer.glide
      ? layer.glide.fromRatio ** (1 - Math.min(tMs, layer.glide.ms) / layer.glide.ms)
      : 1;
    let sum = 0;
    for (let v = 0; v < voices.length; v += 1) {
      const voice = voices[v];
      if (!voice) continue;
      const hz = frequency * glideRatio * detune * voice.ratio;
      phases[v] = (phases[v] ?? 0) + (2 * Math.PI * hz) / sampleRate;
      const decayMs = layer.decayMs * voice.decayScale;
      const level = envelopeAt(tMs, layer.attackMs, decayMs, layer.peak * voice.gain);
      const phase = phases[v] ?? 0;
      // Partials are always sine, as in the engine; only the fundamental takes the layer's wave.
      const wave =
        v === 0 && layer.wave === "triangle"
          ? (2 / Math.PI) * Math.asin(Math.sin(phase))
          : Math.sin(phase);
      sum += wave * level;
    }
    const index = startSample + n;
    if (index >= output.length) break;
    output[index] = (output[index] ?? 0) + (filter ? filter.process(sum) : sum);
  }
}

function addNoiseLayer(
  output: Float32Array,
  layer: NoiseLayer,
  layerIndex: number,
  sampleRate: number,
): void {
  const noise = generateNoise(sampleRate);
  const offset = Math.floor(((layerIndex * 0.137) % 0.5) * sampleRate);
  const startSample = Math.round((layer.startMs / 1000) * sampleRate);
  const lengthSamples = Math.ceil(((layer.attackMs + layer.decayMs) / 1000) * sampleRate);
  const filter = new Biquad(layer.filter, sampleRate);
  for (let n = 0; n < lengthSamples; n += 1) {
    const tMs = (n / sampleRate) * 1000;
    const level = envelopeAt(tMs, layer.attackMs, layer.decayMs, layer.peak);
    const source = noise[(offset + n) % noise.length] ?? 0;
    const index = startSample + n;
    if (index >= output.length) break;
    output[index] = (output[index] ?? 0) + filter.process(source * level);
  }
}

export function renderLayers(
  layers: readonly Layer[],
  options: RenderOptions = {},
  tailMs = 40,
): Float32Array {
  const sampleRate = options.sampleRate ?? 44100;
  const endMs = Math.max(...layers.map((layer) => layer.startMs + layer.attackMs + layer.decayMs));
  const output = new Float32Array(Math.ceil(((endMs + tailMs) / 1000) * sampleRate));
  layers.forEach((layer, index) => {
    if (layer.kind === "tone") addToneLayer(output, layer, options, sampleRate);
    else addNoiseLayer(output, layer, index, sampleRate);
  });
  return output;
}

export function renderRecipe(recipe: SoundRecipe, options: RenderOptions = {}): RenderResult {
  const sampleRate = options.sampleRate ?? 44100;
  const samples = renderLayers(recipe.layers, { ...options, sampleRate }, 60);

  let gain = volumeToGain(options.volume ?? 1) * (options.gain ?? 1);
  if (options.narrating && recipe.whileNarrating.mode === "duck") {
    gain *= dbToGain(recipe.whileNarrating.gainDb);
  }
  if (options.narrating && recipe.whileNarrating.mode === "skip") gain = 0;

  const master = options.bypassMasterFilter
    ? null
    : new Biquad({ type: "lowpass", ...MASTER_LOWPASS }, sampleRate);

  const measured = applyMaster(samples, gain, master);
  return {
    samples,
    sampleRate,
    peak: measured[0] ?? 0,
    rms: Math.sqrt((measured[1] ?? 0) / Math.max(1, samples.length)),
    audibleMs: ((measured[2] ?? 0) / sampleRate) * 1000,
  };
}

/**
 * Applies the master gain and low-pass in place and measures the result: [peak, sum of squares,
 * index of the last audible sample].
 *
 * Why the loop is not in renderRecipe, and reports in a typed array rather than an object: on
 * Node 24 (V8 13.6), when Maglev compiles a hot loop for on-stack replacement before the object
 * literal after it has run, the objects that function returns can share their number fields, so
 * an earlier render's peak turns into the next render's (nodejs/node#66457). The volume test
 * failed that way on 2026-10-14, 10-22 and 10-24. In this file, a function with a hot loop never
 * returns an object literal.
 */
function applyMaster(samples: Float32Array, gain: number, master: Biquad | null): Float64Array {
  let peak = 0;
  let sumSquares = 0;
  let lastAudible = 0;
  for (let n = 0; n < samples.length; n += 1) {
    const raw = (samples[n] ?? 0) * gain;
    const value = master ? master.process(raw) : raw;
    samples[n] = value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
    if (magnitude >= AUDIBLE_FLOOR) lastAudible = n;
    sumSquares += value * value;
  }
  return Float64Array.of(peak, sumSquares, lastAudible);
}

export function peakToDbfs(peak: number): number {
  return 20 * Math.log10(Math.max(peak, 1e-9));
}

export interface SpectrumSummary {
  /** Magnitude-weighted mean frequency. */
  centroidHz: number;
  /** Strongest bin. */
  peakHz: number;
  /** Share of spectral energy at or above each requested frequency, 0 to 1. */
  energyAbove: Record<number, number>;
}

/** Radix-2 FFT, in place. Length must be a power of two. */
function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = real[i] ?? 0;
      const ti = imag[i] ?? 0;
      real[i] = real[j] ?? 0;
      imag[i] = imag[j] ?? 0;
      real[j] = tr;
      imag[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let curReal = 1;
      let curImag = 0;
      for (let k = 0; k < size / 2; k += 1) {
        const even = start + k;
        const odd = start + k + size / 2;
        const oddReal = (real[odd] ?? 0) * curReal - (imag[odd] ?? 0) * curImag;
        const oddImag = (real[odd] ?? 0) * curImag + (imag[odd] ?? 0) * curReal;
        real[odd] = (real[even] ?? 0) - oddReal;
        imag[odd] = (imag[even] ?? 0) - oddImag;
        real[even] = (real[even] ?? 0) + oddReal;
        imag[even] = (imag[even] ?? 0) + oddImag;
        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
}

export function analyzeSpectrum(
  samples: Float32Array,
  sampleRate: number,
  thresholds: readonly number[] = [4000],
): SpectrumSummary {
  const measured = measureSpectrum(samples, sampleRate, thresholds);
  return {
    centroidHz: measured[0] ?? 0,
    peakHz: measured[1] ?? 0,
    energyAbove: Object.fromEntries(
      thresholds.map((threshold, index) => [threshold, measured[2 + index] ?? 0]),
    ),
  };
}

/**
 * [centroid, strongest bin, then each threshold's share of energy], in a typed array for the
 * reason on applyMaster.
 */
function measureSpectrum(
  samples: Float32Array,
  sampleRate: number,
  thresholds: readonly number[],
): Float64Array {
  let size = 1024;
  while (size < samples.length) size <<= 1;
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  for (let n = 0; n < samples.length; n += 1) {
    // Hann window, so the abrupt buffer end does not smear energy into high bins.
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / Math.max(1, samples.length - 1));
    real[n] = (samples[n] ?? 0) * window;
  }
  fft(real, imag);

  const binHz = sampleRate / size;
  const half = size / 2;
  let totalEnergy = 0;
  let weighted = 0;
  let strongest = 0;
  let strongestBin = 0;
  const energies = new Float64Array(half);
  for (let bin = 1; bin < half; bin += 1) {
    const energy = (real[bin] ?? 0) ** 2 + (imag[bin] ?? 0) ** 2;
    energies[bin] = energy;
    totalEnergy += energy;
    weighted += energy * bin * binHz;
    if (energy > strongest) {
      strongest = energy;
      strongestBin = bin;
    }
  }
  const measured = new Float64Array(2 + thresholds.length);
  measured[0] = totalEnergy > 0 ? weighted / totalEnergy : 0;
  measured[1] = strongestBin * binHz;
  for (const [index, threshold] of thresholds.entries()) {
    let above = 0;
    for (let bin = Math.ceil(threshold / binHz); bin < half; bin += 1) above += energies[bin] ?? 0;
    measured[2 + index] = totalEnergy > 0 ? above / totalEnergy : 0;
  }
  return measured;
}

/** Per-layer peaks after the same processing, for tuning the balance between tone and felt. */
export function layerPeaks(recipe: SoundRecipe, options: RenderOptions = {}): number[] {
  return recipe.layers.map((layer) => {
    const samples = renderLayers([layer], options, 20);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    return peak;
  });
}
