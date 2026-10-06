/**
 * Deterministic white noise for the felt layer.
 *
 * Why seeded: a felt knock that differs on every press reads as hiss. A fixed one reads as the
 * same wooden object being struck. The engine and the offline renderer use the same generator.
 */

const NOISE_SEED = 0x5eed;

/** Mulberry32: tiny, fast, good enough for audio noise, and identical on every platform. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<number, Float32Array>();

/** One second of uniform noise in [-1, 1] at the given sample rate. Cached per rate. */
export function generateNoise(sampleRate: number): Float32Array {
  const cached = cache.get(sampleRate);
  if (cached) return cached;
  const random = mulberry32(NOISE_SEED);
  const samples = new Float32Array(Math.round(sampleRate));
  for (let i = 0; i < samples.length; i += 1) samples[i] = random() * 2 - 1;
  cache.set(sampleRate, samples);
  return samples;
}
