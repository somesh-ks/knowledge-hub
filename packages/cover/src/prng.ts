/** Seeded randomness. Everything a cover draws comes from here, so a seed is a cover. */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** One element, uniformly. */
  pick<T>(items: readonly T[]): T;
  /** One element, weighted. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
  /** Approximately normal, mean 0, deviation 1 (sum of uniforms). */
  gauss(): number;
  /** -1 or 1. */
  sign(): 1 | -1;
  /** A new generator whose stream depends on this one's state and a label. */
  fork(label: string): Rng;
}

/** mulberry32: a small, fast 32-bit generator with good distribution for visual work. */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("pick from empty list");
      return item;
    },
    weighted: (items, weight) => {
      const weights = items.map(weight);
      const total = weights.reduce((sum, w) => sum + w, 0);
      let cursor = next() * total;
      for (let i = 0; i < items.length; i += 1) {
        cursor -= weights[i] ?? 0;
        if (cursor < 0) return items[i] as (typeof items)[number];
      }
      return items[items.length - 1] as (typeof items)[number];
    },
    gauss: () => (next() + next() + next() + next() - 2) * 1.7320508,
    sign: () => (next() < 0.5 ? -1 : 1),
    fork: (label) => mulberry32(hash32(`${label}:${Math.floor(next() * 4294967296)}`)),
  };
  return rng;
}

/** FNV-1a with a murmur-style finalizer, so nearby strings give unrelated seeds. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function lattice(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in [0, 1]. */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = lattice(x0, y0, seed);
  const b = lattice(x0 + 1, y0, seed);
  const c = lattice(x0, y0 + 1, seed);
  const d = lattice(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal value noise in [0, 1]: octaves of halving amplitude and doubling frequency. */
export function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * frequency, y * frequency, seed + i * 101) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}
