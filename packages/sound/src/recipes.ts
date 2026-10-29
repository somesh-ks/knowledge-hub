/**
 * Sound recipes: pure data. One family, synthesized, zero assets.
 *
 * The family is a felt-hammered wooden bar (think marimba or kalimba under a soft mallet):
 * - Tone: a sine fundamental plus a quiet second partial at 4x with a faster decay, which is what
 *   gives a struck wooden bar its "tock" instead of a beep.
 * - Touch: a short burst of noise through a low-pass around 400 to 900 Hz, the felt meeting the
 *   bar. It sits well below the 3 to 6 kHz band a plastic click would use, on purpose.
 * - Pitch: every resting pitch is drawn from one D major pentatonic set (D E F# A B). A pentatonic
 *   set has no semitone clashes, so any two sounds that overlap, or any run of scrub ticks, stay
 *   consonant. Direction carries meaning: up is forward, on, open, start; down is back, off, close.
 * - Weight: level, length and note count rise with importance. Taps are one note under 110 ms,
 *   skips are two grace notes, the end of a digest is a three-note settle, and only the finished
 *   Generate run gets a sustained two-note resolve.
 * - Space: all sounds share one master low-pass at 3.6 kHz so nothing above ~4 kHz ever reaches
 *   the speaker, and every sound peaks at or below -13 dBFS at full master volume.
 */

export const SOUND_NAMES = [
  "play",
  "pause",
  "itemNext",
  "itemPrev",
  "scrubDetent",
  "speedChange",
  "sheetOpen",
  "sheetClose",
  "generateStart",
  "generateDone",
  "error",
  "toggleOn",
  "toggleOff",
  "digestEnd",
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

/** Equal temperament, A4 = 440 Hz. */
function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** D major pentatonic: the only pitches the family uses. */
export const PITCH = {
  D3: midiToHz(50),
  E3: midiToHz(52),
  Fs3: midiToHz(54),
  A3: midiToHz(57),
  B3: midiToHz(59),
  D4: midiToHz(62),
  E4: midiToHz(64),
  Fs4: midiToHz(66),
  A4: midiToHz(69),
  B4: midiToHz(71),
  D5: midiToHz(74),
  E5: midiToHz(76),
  Fs5: midiToHz(78),
  A5: midiToHz(81),
  B5: midiToHz(83),
  D6: midiToHz(86),
} as const;

/** Every resting pitch the family may use. Tests assert recipes stay inside this set. */
export const PENTATONIC_HZ: readonly number[] = Object.values(PITCH);

/** Scrub ticks climb this ladder as the playhead moves through the digest. */
export const SCRUB_LADDER: readonly number[] = [
  PITCH.D4,
  PITCH.E4,
  PITCH.Fs4,
  PITCH.A4,
  PITCH.B4,
  PITCH.D5,
  PITCH.E5,
  PITCH.Fs5,
  PITCH.A5,
];

/** Playback rates 0.75 to 2 in steps of 0.25 map to rising pitches. */
export const SPEED_LADDER: readonly number[] = [
  PITCH.Fs4,
  PITCH.A4,
  PITCH.B4,
  PITCH.D5,
  PITCH.E5,
  PITCH.Fs5,
];

export type LowpassSpec = {
  type: "lowpass";
  frequencyHz: number;
  /** Web Audio lowpass Q is in dB: -3.01 dB is Butterworth, 0 dB adds a slight shoulder. */
  qDb: number;
};

export type BandpassSpec = {
  type: "bandpass";
  frequencyHz: number;
  /** Bandpass Q is linear. */
  q: number;
};

export type FilterSpec = LowpassSpec | BandpassSpec;

export interface PartialSpec {
  /** Multiple of the fundamental. */
  ratio: number;
  /** Amplitude relative to the fundamental's peak. */
  gain: number;
  /** Decay time as a fraction of the fundamental's decay. */
  decayScale: number;
}

export interface ToneLayer {
  kind: "tone";
  /** Offset from the trigger, in ms. */
  startMs: number;
  wave: "sine" | "triangle";
  /** Resting pitch in Hz, from the pentatonic set. Replaced when the layer tracks a parameter. */
  frequencyHz: number;
  /** Starts at frequencyHz * fromRatio and glides exponentially onto frequencyHz. */
  glide?: { fromRatio: number; ms: number };
  /** Which play option chooses this layer's pitch. */
  tracks?: "position" | "rate";
  /** Linear peak amplitude, full scale = 1. */
  peak: number;
  attackMs: number;
  /** Time for the exponential decay to reach the -80 dB floor, measured from the end of the attack. */
  decayMs: number;
  /** Fixed detune of this layer in cents, for the chorus on the signature chime. */
  detuneCents?: number;
  partials?: readonly PartialSpec[];
  lowpass?: LowpassSpec;
}

export interface NoiseLayer {
  kind: "noise";
  startMs: number;
  /** Amplitude of the unfiltered noise before its envelope. A low-pass takes most of it away. */
  peak: number;
  attackMs: number;
  decayMs: number;
  filter: FilterSpec;
}

export type Layer = ToneLayer | NoiseLayer;

export type NarrationPolicy =
  /** Do not play while narration is playing. */
  | { mode: "skip" }
  /** Play, lowered by gainDb (negative). */
  | { mode: "duck"; gainDb: number };

export interface SoundRecipe {
  name: SoundName;
  /** Why the sound exists and what it should feel like. */
  intent: string;
  layers: readonly Layer[];
  whileNarrating: NarrationPolicy;
  /** The same sound cannot retrigger inside this window. */
  minIntervalMs: number;
  /** Declared ceiling for the whole sound, checked against the layers by tests. */
  maxDurationMs: number;
  /** The one signature sound is allowed to be long. */
  signature?: true;
}

/** -80 dBFS. Exponential ramps cannot start or end at zero. */
export const FLOOR = 0.0001;
export const MAX_POLYPHONY = 4;

/** One shared low-pass for the whole family: nothing above about 4 kHz reaches the speaker. */
export const MASTER_LOWPASS = { frequencyHz: 3600, qDb: -3.01 } as const;

/** The wooden second partial. 4x is the first overtone of a tuned marimba bar. */
const woodPartial = (gain: number): PartialSpec => ({ ratio: 4, gain, decayScale: 0.45 });

/** A chime also gets a soft octave, which a bar does not have. */
const chimePartials: readonly PartialSpec[] = [
  woodPartial(0.2),
  { ratio: 2, gain: 0.1, decayScale: 0.6 },
];

const FELT = (startMs: number, peak: number, decayMs: number, frequencyHz = 700): NoiseLayer => ({
  kind: "noise",
  startMs,
  peak,
  attackMs: 2,
  decayMs,
  filter: { type: "lowpass", frequencyHz, qDb: -3.01 },
});

interface BarOptions {
  glide?: { fromRatio: number; ms: number };
  tracks?: "position" | "rate";
  attackMs?: number;
  detuneCents?: number;
  /** Gain of the wooden 4x partial. Zero omits it. */
  woodGain?: number;
  partials?: readonly PartialSpec[];
}

function bar(
  startMs: number,
  frequencyHz: number,
  peak: number,
  decayMs: number,
  options: BarOptions = {},
): ToneLayer {
  const woodGain = options.woodGain ?? 0.22;
  const partials = options.partials ?? (woodGain > 0 ? [woodPartial(woodGain)] : []);
  return {
    kind: "tone",
    startMs,
    wave: "sine",
    frequencyHz,
    peak,
    attackMs: options.attackMs ?? 3,
    decayMs,
    ...(options.glide ? { glide: options.glide } : {}),
    ...(options.tracks ? { tracks: options.tracks } : {}),
    ...(options.detuneCents !== undefined ? { detuneCents: options.detuneCents } : {}),
    ...(partials.length > 0 ? { partials } : {}),
  };
}

export const RECIPES: Readonly<Record<SoundName, SoundRecipe>> = {
  play: {
    name: "play",
    intent:
      "Start narration. One bright bar rising into D5. It plays into silence, just before speech begins.",
    layers: [
      bar(0, PITCH.D5, 0.13, 102, { glide: { fromRatio: 0.965, ms: 28 } }),
      FELT(0, 0.38, 14),
    ],
    whileNarrating: { mode: "skip" },
    minIntervalMs: 120,
    maxDurationMs: 110,
  },
  pause: {
    name: "pause",
    intent:
      "Stop narration. The same bar a fifth lower, falling onto A4. It plays after the narration has stopped.",
    layers: [
      bar(0, PITCH.A4, 0.11, 90, { glide: { fromRatio: 1.035, ms: 28 } }),
      FELT(0, 0.34, 12),
    ],
    whileNarrating: { mode: "skip" },
    minIntervalMs: 120,
    maxDurationMs: 100,
  },
  itemNext: {
    name: "itemNext",
    intent: "Skip forward one item. Two quick grace notes climbing a fourth, B4 to E5.",
    layers: [
      bar(0, PITCH.B4, 0.095, 56, { woodGain: 0.18 }),
      bar(44, PITCH.E5, 0.11, 62, { woodGain: 0.18 }),
      FELT(0, 0.27, 10),
    ],
    whileNarrating: { mode: "duck", gainDb: -9 },
    minIntervalMs: 90,
    maxDurationMs: 112,
  },
  itemPrev: {
    name: "itemPrev",
    intent: "Skip back one item. The same two grace notes, falling E5 to B4.",
    layers: [
      bar(0, PITCH.E5, 0.095, 56, { woodGain: 0.18 }),
      bar(44, PITCH.B4, 0.11, 62, { woodGain: 0.18 }),
      FELT(0, 0.27, 10),
    ],
    whileNarrating: { mode: "duck", gainDb: -9 },
    minIntervalMs: 90,
    maxDurationMs: 112,
  },
  scrubDetent: {
    name: "scrubDetent",
    intent:
      "A very soft tick when the scrubber crosses an item boundary. Pitch climbs a pentatonic ladder with position, so a drag from start to end plays a rising line.",
    layers: [bar(0, PITCH.A4, 0.055, 40, { tracks: "position", woodGain: 0.12, attackMs: 2 })],
    whileNarrating: { mode: "duck", gainDb: -9 },
    minIntervalMs: 55,
    maxDurationMs: 45,
  },
  speedChange: {
    name: "speedChange",
    intent:
      "Confirm a new playback speed. The bar lands on a pitch that rises with the rate: 0.75x F#4, 1x A4, 1.25x B4, 1.5x D5, 1.75x E5, 2x F#5.",
    layers: [
      bar(0, PITCH.A4, 0.125, 100, { tracks: "rate", glide: { fromRatio: 0.94, ms: 32 } }),
      FELT(0, 0.37, 14),
    ],
    whileNarrating: { mode: "duck", gainDb: -6 },
    minIntervalMs: 150,
    maxDurationMs: 105,
  },
  sheetOpen: {
    name: "sheetOpen",
    intent: "A sheet commits open. A low felt knock with a bar rising into D4.",
    layers: [
      bar(0, PITCH.D4, 0.105, 96, { glide: { fromRatio: 0.94, ms: 40 }, woodGain: 0.12 }),
      FELT(0, 0.51, 40, 520),
    ],
    whileNarrating: { mode: "skip" },
    minIntervalMs: 250,
    maxDurationMs: 100,
  },
  sheetClose: {
    name: "sheetClose",
    intent: "A sheet commits closed. The same knock, shorter, falling onto D4.",
    layers: [
      bar(0, PITCH.D4, 0.08, 70, { glide: { fromRatio: 1.06, ms: 30 }, woodGain: 0.1 }),
      FELT(0, 0.51, 30, 440),
    ],
    whileNarrating: { mode: "skip" },
    minIntervalMs: 250,
    maxDurationMs: 75,
  },
  generateStart: {
    name: "generateStart",
    intent: "A run was accepted. One low bar rising into A3 with a soft latch of felt.",
    layers: [
      bar(0, PITCH.A3, 0.125, 120, { glide: { fromRatio: 0.9, ms: 60 }, woodGain: 0.16 }),
      FELT(0, 0.45, 18, 600),
    ],
    whileNarrating: { mode: "duck", gainDb: -6 },
    minIntervalMs: 500,
    maxDurationMs: 130,
  },
  generateDone: {
    name: "generateDone",
    intent:
      "The signature. A new podcast is ready. Two sustained bars, A4 then D5, a perfect fourth up that resolves the dominant onto the tonic, each lightly doubled and detuned for a warm shimmer.",
    layers: [
      bar(0, PITCH.A4, 0.135, 300, { partials: chimePartials }),
      bar(0, PITCH.A4, 0.052, 280, { detuneCents: 5, woodGain: 0 }),
      FELT(0, 0.3, 16),
      bar(120, PITCH.D5, 0.15, 640, { partials: chimePartials }),
      bar(120, PITCH.D5, 0.057, 600, { detuneCents: -5, woodGain: 0 }),
    ],
    whileNarrating: { mode: "duck", gainDb: -3 },
    minIntervalMs: 800,
    maxDurationMs: 780,
    signature: true,
  },
  error: {
    name: "error",
    intent:
      "Something failed and the screen says what. A muted low thud: a triangle bar sagging onto A3 under a dull knock. It informs and never scolds.",
    layers: [
      {
        kind: "tone",
        startMs: 0,
        wave: "triangle",
        frequencyHz: PITCH.A3,
        glide: { fromRatio: 1.08, ms: 60 },
        peak: 0.115,
        attackMs: 3,
        decayMs: 130,
        lowpass: { type: "lowpass", frequencyHz: 900, qDb: -3.01 },
      },
      FELT(0, 0.7, 45, 420),
    ],
    whileNarrating: { mode: "duck", gainDb: -3 },
    minIntervalMs: 400,
    maxDurationMs: 135,
  },
  toggleOn: {
    name: "toggleOn",
    intent:
      "A switch turns on. A short tick up onto F#5 with extra felt, the most tactile of the family.",
    layers: [
      bar(0, PITCH.Fs5, 0.105, 62, { glide: { fromRatio: 0.96, ms: 18 }, woodGain: 0.14 }),
      FELT(0, 0.42, 12, 800),
    ],
    whileNarrating: { mode: "duck", gainDb: -9 },
    minIntervalMs: 120,
    maxDurationMs: 68,
  },
  toggleOff: {
    name: "toggleOff",
    intent: "A switch turns off. The same tick, a sixth lower, falling onto A4.",
    layers: [
      bar(0, PITCH.A4, 0.09, 56, { glide: { fromRatio: 1.04, ms: 18 }, woodGain: 0.14 }),
      FELT(0, 0.42, 12, 650),
    ],
    whileNarrating: { mode: "duck", gainDb: -9 },
    minIntervalMs: 120,
    maxDurationMs: 62,
  },
  digestEnd: {
    name: "digestEnd",
    intent:
      "The last item finished. Three short bars stepping down F#5, D5, A4: a settle, not a fanfare.",
    layers: [
      bar(0, PITCH.Fs5, 0.08, 58, { woodGain: 0.14 }),
      bar(38, PITCH.D5, 0.09, 60, { woodGain: 0.14 }),
      bar(76, PITCH.A4, 0.1, 70, { woodGain: 0.14 }),
      FELT(0, 0.24, 10),
    ],
    whileNarrating: { mode: "duck", gainDb: -6 },
    minIntervalMs: 1000,
    maxDurationMs: 150,
  },
};

export function recipeFor(name: SoundName): SoundRecipe {
  return RECIPES[name];
}

/** Total length of the recipe as written: the latest layer end. */
export function recipeDurationMs(recipe: SoundRecipe): number {
  return Math.max(...recipe.layers.map((layer) => layer.startMs + layer.attackMs + layer.decayMs));
}

export interface PlayOptions {
  /** 0 to 1 position through the digest. Drives scrubDetent. */
  position?: number;
  /** Playback rate. Drives speedChange. */
  rate?: number;
  /** Extra gain multiplier 0 to 1 for this call. */
  gain?: number;
}

export function scrubFrequency(position: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(position) ? position : 0));
  const index = Math.round(clamped * (SCRUB_LADDER.length - 1));
  return SCRUB_LADDER[index] ?? PITCH.A4;
}

export function speedFrequency(rate: number): number {
  const steps = Math.round(((Number.isFinite(rate) ? rate : 1) - 0.75) / 0.25);
  const index = Math.min(SPEED_LADDER.length - 1, Math.max(0, steps));
  return SPEED_LADDER[index] ?? PITCH.A4;
}

/** Resolves the pitch a tone layer will actually play, given the call options. */
export function resolveFrequency(layer: ToneLayer, options: PlayOptions = {}): number {
  if (layer.tracks === "position" && options.position !== undefined) {
    return scrubFrequency(options.position);
  }
  if (layer.tracks === "rate" && options.rate !== undefined) {
    return speedFrequency(options.rate);
  }
  return layer.frequencyHz;
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Master volume 0 to 1 to linear gain. A quadratic taper puts 0.5 at -12 dB, so the slider feels even. */
export function volumeToGain(volume: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
  return clamped * clamped;
}

/** Plain-language trigger for each sound, shared by the lab and the docs. */
export const TRIGGERS: Readonly<Record<SoundName, string>> = {
  play: "Narration starts",
  pause: "Narration stops",
  itemNext: "Skip to the next item",
  itemPrev: "Skip to the previous item",
  scrubDetent: "The scrubber crosses an item boundary",
  speedChange: "Playback speed changes",
  sheetOpen: "A sheet opens",
  sheetClose: "A sheet closes",
  generateStart: "A Generate run starts",
  generateDone: "A Generate run finishes",
  error: "Something failed and the screen says what",
  toggleOn: "A switch turns on",
  toggleOff: "A switch turns off",
  digestEnd: "The last item finishes",
};

/** "A4", "F#5" for a pentatonic pitch, or the frequency when it is off the set. */
export function noteName(hz: number): string {
  for (const [key, value] of Object.entries(PITCH)) {
    if (Math.abs(value - hz) < 0.5) return key.replace("s", "#");
  }
  return `${Math.round(hz)} Hz`;
}
