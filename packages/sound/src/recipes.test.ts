import { describe, expect, it } from "vitest";
import {
  dbToGain,
  type Layer,
  PENTATONIC_HZ,
  RECIPES,
  recipeDurationMs,
  resolveFrequency,
  SCRUB_LADDER,
  SOUND_NAMES,
  type SoundRecipe,
  SPEED_LADDER,
  scrubFrequency,
  speedFrequency,
  type ToneLayer,
  volumeToGain,
} from "./recipes.js";
import { analyzeSpectrum, layerPeaks, peakToDbfs, renderRecipe } from "./render.js";

const recipes: SoundRecipe[] = SOUND_NAMES.map((name) => RECIPES[name]);
const isPentatonic = (hz: number): boolean =>
  PENTATONIC_HZ.some((candidate) => Math.abs(candidate - hz) < 0.01);

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

  it("keeps the map restrained: no sound for scroll, link, hover or theme", () => {
    for (const forbidden of ["scroll", "link", "hover", "theme", "tap", "click"]) {
      expect(SOUND_NAMES.some((name) => name.toLowerCase().includes(forbidden))).toBe(false);
    }
    expect(SOUND_NAMES).toHaveLength(14);
  });

  it("has exactly one signature, and it is the Generate resolve", () => {
    const signatures = recipes.filter((recipe) => recipe.signature);
    expect(signatures.map((recipe) => recipe.name)).toEqual(["generateDone"]);
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

  it("keeps every resting pitch inside the D major pentatonic set", () => {
    for (const layer of toneLayers(recipe)) {
      expect(isPentatonic(layer.frequencyHz), `${layer.frequencyHz} Hz`).toBe(true);
      expect(layer.frequencyHz).toBeGreaterThanOrEqual(140);
      expect(layer.frequencyHz).toBeLessThanOrEqual(1200);
      if (layer.glide) {
        expect(layer.glide.fromRatio).toBeGreaterThan(0.85);
        expect(layer.glide.fromRatio).toBeLessThan(1.15);
        expect(layer.glide.ms).toBeLessThanOrEqual(80);
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

    it("keeps the felt touch under the tone, never above it", () => {
      const peaks = layerPeaks(recipe, { position: 0.5, rate: 1.25 });
      const tonePeak = Math.max(
        ...recipe.layers.map((layer, index) => (layer.kind === "tone" ? (peaks[index] ?? 0) : 0)),
      );
      recipe.layers.forEach((layer, index) => {
        if (layer.kind !== "noise") return;
        const ratio = (peaks[index] ?? 0) / tonePeak;
        expect(ratio).toBeGreaterThan(0.1);
        expect(ratio).toBeLessThan(1);
      });
    });
  });
});

describe("family relationships", () => {
  const rms = (recipe: SoundRecipe): number =>
    renderRecipe(recipe, { position: 0.5, rate: 1.25 }).rms;

  it("makes the signature the loudest sound by RMS, and everything else clearly quieter", () => {
    const signature = rms(RECIPES.generateDone);
    for (const recipe of recipes) {
      if (recipe.signature) continue;
      expect(rms(recipe), recipe.name).toBeLessThan(signature * 0.6);
    }
  });

  it("makes the scrub tick the quietest sound", () => {
    const tick = rms(RECIPES.scrubDetent);
    for (const recipe of recipes) {
      if (recipe.name !== "scrubDetent") expect(rms(recipe), recipe.name).toBeGreaterThan(tick);
    }
  });

  it("keeps the error muted: lower and quieter than the signature, in the low register", () => {
    const [layer] = toneLayers(RECIPES.error);
    expect(layer?.frequencyHz).toBeLessThan(300);
    expect(rms(RECIPES.error)).toBeLessThan(rms(RECIPES.generateDone) * 0.5);
  });

  it("gives every sound a distinct fingerprint of length, first pitch and note count", () => {
    const seen = new Set<string>();
    for (const recipe of recipes) {
      const tones = toneLayers(recipe).filter((layer) => layer.detuneCents === undefined);
      const first = tones[0];
      const fingerprint = [
        Math.round(recipeDurationMs(recipe) / 5),
        Math.round(first?.frequencyHz ?? 0),
        tones.length,
      ].join(":");
      expect(seen.has(fingerprint), `${recipe.name} duplicates ${fingerprint}`).toBe(false);
      seen.add(fingerprint);
    }
  });

  it("pairs directions: up for forward, on, open, start; down for back, off, close, stop", () => {
    const glideDirection = (recipe: SoundRecipe): number => {
      const layer = toneLayers(recipe).find((candidate) => candidate.glide);
      return layer?.glide ? Math.sign(1 - layer.glide.fromRatio) : 0;
    };
    // fromRatio below 1 starts flat and rises into the note; above 1 starts sharp and falls.
    expect(glideDirection(RECIPES.play)).toBe(1);
    expect(glideDirection(RECIPES.pause)).toBe(-1);
    expect(glideDirection(RECIPES.toggleOn)).toBe(1);
    expect(glideDirection(RECIPES.toggleOff)).toBe(-1);
    expect(glideDirection(RECIPES.sheetOpen)).toBe(1);
    expect(glideDirection(RECIPES.sheetClose)).toBe(-1);
    const [firstNext, secondNext] = toneLayers(RECIPES.itemNext);
    const [firstPrev, secondPrev] = toneLayers(RECIPES.itemPrev);
    expect((secondNext?.frequencyHz ?? 0) > (firstNext?.frequencyHz ?? 0)).toBe(true);
    expect((secondPrev?.frequencyHz ?? 0) < (firstPrev?.frequencyHz ?? 0)).toBe(true);
  });

  it("resolves the signature as a rising perfect fourth, A4 to D5", () => {
    const notes = toneLayers(RECIPES.generateDone)
      .filter((layer) => layer.detuneCents === undefined)
      .map((layer) => layer.frequencyHz);
    expect(notes).toHaveLength(2);
    expect((notes[1] ?? 0) / (notes[0] ?? 1)).toBeCloseTo(2 ** (5 / 12), 3);
  });
});

describe("parameter mapping", () => {
  it("keeps both ladders inside the pentatonic set", () => {
    for (const hz of [...SCRUB_LADDER, ...SPEED_LADDER]) expect(isPentatonic(hz)).toBe(true);
  });

  it("climbs the scrub ladder monotonically from D4 to A5", () => {
    let previous = 0;
    for (let step = 0; step <= 100; step += 1) {
      const hz = scrubFrequency(step / 100);
      expect(hz).toBeGreaterThanOrEqual(previous);
      expect(isPentatonic(hz)).toBe(true);
      previous = hz;
    }
    expect(scrubFrequency(0)).toBeCloseTo(293.66, 1);
    expect(scrubFrequency(1)).toBeCloseTo(880, 1);
    expect(scrubFrequency(Number.NaN)).toBeCloseTo(293.66, 1);
  });

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
    expect(half.peak / full.peak).toBeCloseTo(0.25, 2);
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
