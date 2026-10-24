import { describe, expect, it } from "vitest";
import {
  dbToGain,
  type Layer,
  RECIPES,
  recipeDurationMs,
  resolveFrequency,
  SOUND_NAMES,
  type SoundRecipe,
  speedFrequency,
  type ToneLayer,
  volumeToGain,
} from "./recipes.js";
import { analyzeSpectrum, peakToDbfs, renderRecipe } from "./render.js";

const recipes: SoundRecipe[] = SOUND_NAMES.map((name) => RECIPES[name]);

/** Peak ceiling at full master volume: about -12 dBFS. */
const PEAK_CEILING = 0.25;

function toneLayers(recipe: SoundRecipe): ToneLayer[] {
  return recipe.layers.filter((layer): layer is ToneLayer => layer.kind === "tone");
}

function numbersIn(layer: Layer): number[] {
  const numbers = [layer.startMs, layer.peak, layer.attackMs, layer.decayMs];
  if (layer.kind === "tone") {
    numbers.push(layer.frequencyHz, layer.detuneCents ?? 0);
    if (layer.glide) numbers.push(layer.glide.fromRatio, layer.glide.ms);
    for (const partial of layer.partials ?? []) {
      numbers.push(partial.ratio, partial.gain, partial.decayScale);
    }
    if (layer.lowpass) numbers.push(layer.lowpass.frequencyHz, layer.lowpass.qDb);
  } else {
    numbers.push(layer.filter.frequencyHz);
    numbers.push(layer.filter.type === "lowpass" ? layer.filter.qDb : layer.filter.q);
  }
  return numbers;
}

describe("recipe set", () => {
  it("defines exactly one recipe per sound name, with matching names", () => {
    expect(Object.keys(RECIPES).sort()).toEqual([...SOUND_NAMES].sort());
    for (const name of SOUND_NAMES) expect(RECIPES[name].name).toBe(name);
  });
});

describe.each(recipes)("recipe $name", (recipe) => {
  it("uses finite, sane numbers in every layer", () => {
    expect(recipe.layers.length).toBeGreaterThan(0);
    for (const layer of recipe.layers) {
      for (const value of numbersIn(layer)) expect(Number.isFinite(value)).toBe(true);
      expect(layer.startMs).toBeGreaterThanOrEqual(0);
      expect(layer.peak).toBeGreaterThan(0);
      expect(layer.decayMs).toBeGreaterThan(layer.attackMs);
    }
  });

  it("attacks in 2 to 8 ms, so there is no click and no smear", () => {
    for (const layer of recipe.layers) {
      expect(layer.attackMs).toBeGreaterThanOrEqual(2);
      expect(layer.attackMs).toBeLessThanOrEqual(8);
    }
  });

  it("keeps tone peaks at or below -12 dBFS and noise below a sane raw level", () => {
    for (const layer of recipe.layers) {
      if (layer.kind === "tone") {
        expect(layer.peak).toBeLessThanOrEqual(PEAK_CEILING);
        for (const partial of layer.partials ?? []) {
          expect(partial.ratio).toBeGreaterThanOrEqual(1);
          expect(partial.gain).toBeGreaterThan(0);
          expect(partial.gain).toBeLessThan(1);
          expect(partial.decayScale).toBeGreaterThan(0);
          expect(partial.decayScale).toBeLessThanOrEqual(1);
        }
      } else {
        expect(layer.peak).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it("keeps its filters out of the harsh band", () => {
    for (const layer of recipe.layers) {
      if (layer.kind === "noise") {
        const limit = layer.filter.type === "lowpass" ? 1000 : 2500;
        expect(layer.filter.frequencyHz).toBeLessThanOrEqual(limit);
      } else if (layer.lowpass) {
        expect(layer.lowpass.frequencyHz).toBeLessThanOrEqual(4000);
      }
    }
  });

  it("stays within its declared length, and under 150 ms unless it is the signature", () => {
    expect(recipeDurationMs(recipe)).toBeLessThanOrEqual(recipe.maxDurationMs);
    if (recipe.signature) {
      expect(recipe.maxDurationMs).toBeLessThanOrEqual(800);
      expect(recipe.maxDurationMs).toBeGreaterThan(150);
    } else {
      expect(recipe.maxDurationMs).toBeLessThanOrEqual(150);
    }
  });

  it("declares a narration policy and a retrigger window", () => {
    expect(["skip", "duck"]).toContain(recipe.whileNarrating.mode);
    if (recipe.whileNarrating.mode === "duck") {
      expect(recipe.whileNarrating.gainDb).toBeLessThan(0);
      expect(recipe.whileNarrating.gainDb).toBeGreaterThanOrEqual(-12);
    }
    expect(recipe.minIntervalMs).toBeGreaterThanOrEqual(50);
  });

  describe("rendered", () => {
    const result = renderRecipe(recipe, { position: 0.5, rate: 1.25 });
    const spectrum = analyzeSpectrum(result.samples, result.sampleRate, [3000, 4000]);

    it("is finite and never clips: peak at or below -12 dBFS, above -36 dBFS", () => {
      for (const sample of result.samples) expect(Number.isFinite(sample)).toBe(true);
      expect(result.peak).toBeLessThanOrEqual(PEAK_CEILING);
      expect(peakToDbfs(result.peak)).toBeGreaterThan(-36);
    });

    it("starts and ends at silence, so it cannot click", () => {
      expect(Math.abs(result.samples[0] ?? 1)).toBeLessThan(0.001);
      expect(Math.abs(result.samples.at(-1) ?? 1)).toBeLessThan(0.0005);
    });

    it("has no DC offset", () => {
      let sum = 0;
      for (const sample of result.samples) sum += sample;
      expect(Math.abs(sum / result.samples.length) / result.peak).toBeLessThan(0.02);
    });

    it("is audible for no longer than its declared length", () => {
      expect(result.audibleMs).toBeLessThanOrEqual(recipe.maxDurationMs + 10);
    });

    it("keeps energy above 4 kHz under 0.1 percent and sounds warm, not shrill", () => {
      expect(spectrum.energyAbove[4000]).toBeLessThan(0.001);
      expect(spectrum.centroidHz).toBeGreaterThan(150);
      expect(spectrum.centroidHz).toBeLessThan(1800);
    });
  });
});

describe("parameter mapping", () => {
  it("raises pitch with playback rate and clamps outside 0.75 to 2", () => {
    const rates = [0.75, 1, 1.25, 1.5, 1.75, 2];
    const pitches = rates.map(speedFrequency);
    for (let index = 1; index < pitches.length; index += 1) {
      expect(pitches[index]).toBeGreaterThan(pitches[index - 1] ?? 0);
    }
    expect(speedFrequency(0.5)).toBe(speedFrequency(0.75));
    expect(speedFrequency(3)).toBe(speedFrequency(2));
  });

  it("applies options only to layers that track them", () => {
    const scrub = toneLayers(RECIPES.scrubDetent)[0];
    const speed = toneLayers(RECIPES.speedChange)[0];
    const play = toneLayers(RECIPES.play)[0];
    if (!scrub || !speed || !play) throw new Error("missing layer");
    expect(resolveFrequency(scrub, { position: 1 })).toBeCloseTo(880, 1);
    expect(resolveFrequency(scrub, {})).toBe(scrub.frequencyHz);
    expect(resolveFrequency(speed, { rate: 2 })).toBeGreaterThan(
      resolveFrequency(speed, { rate: 1 }),
    );
    expect(resolveFrequency(play, { position: 1, rate: 2 })).toBe(play.frequencyHz);
  });

  it("renders a higher scrub tick as a higher spectral peak", () => {
    const low = renderRecipe(RECIPES.scrubDetent, { position: 0 });
    const high = renderRecipe(RECIPES.scrubDetent, { position: 1 });
    const lowPeak = analyzeSpectrum(low.samples, low.sampleRate).peakHz;
    const highPeak = analyzeSpectrum(high.samples, high.sampleRate).peakHz;
    expect(highPeak).toBeGreaterThan(lowPeak * 2);
  });
});

describe("level control", () => {
  it("tapers the master volume quadratically, with zero silent and one unity", () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25, 6);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(Number.NaN)).toBe(0);
  });

  it("scales the rendered peak with the master volume", () => {
    const full = renderRecipe(RECIPES.play, { volume: 1 });
    const half = renderRecipe(RECIPES.play, { volume: 0.5 });
    // A ratio of exactly 1 (2026-10-14, 10-22, 10-24) was a Node 24 V8 bug that made the first
    // result read the second's peak; render.ts's applyMaster says how the renderer avoids it.
    expect(
      half.peak / full.peak,
      `full ${full.peak} (${full.samples.length} samples), half ${half.peak}`,
    ).toBeCloseTo(0.25, 2);
  });

  it("applies each recipe's narration policy in the render", () => {
    for (const recipe of recipes) {
      const free = renderRecipe(recipe, { position: 0.5, rate: 1.25 });
      const narrated = renderRecipe(recipe, { position: 0.5, rate: 1.25, narrating: true });
      if (recipe.whileNarrating.mode === "skip") {
        expect(narrated.peak, recipe.name).toBe(0);
      } else {
        const expected = dbToGain(recipe.whileNarrating.gainDb);
        expect(narrated.peak / free.peak, recipe.name).toBeCloseTo(expected, 2);
      }
    }
  });

  it("keeps every sound at or below -12 dBFS across the parameter extremes", () => {
    for (const recipe of recipes) {
      const result = renderRecipe(recipe, { position: 1, rate: 2 });
      expect(peakToDbfs(result.peak), recipe.name).toBeLessThanOrEqual(-12);
    }
  });
});
