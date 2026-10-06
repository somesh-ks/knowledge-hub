import { describe, expect, it } from "vitest";
import { synthesizeWav } from "./fixtureAudio";

function text(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

describe("synthesizeWav", () => {
  const wav = synthesizeWav({ seconds: 2, sampleRate: 8000, boundaries: [0, 1] });
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  it("writes a valid WAV header", () => {
    expect(text(wav, 0, 4)).toBe("RIFF");
    expect(text(wav, 8, 4)).toBe("WAVE");
    expect(text(wav, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(8); // bits per sample
    expect(text(wav, 36, 4)).toBe("data");
  });

  it("has the length its header declares", () => {
    expect(view.getUint32(40, true)).toBe(16_000);
    expect(wav.byteLength).toBe(44 + 16_000);
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
  });

  it("stays quiet: no sample strays far from silence", () => {
    const loudest = Math.max(...Array.from(wav.slice(44), (sample) => Math.abs(sample - 128)));
    expect(loudest).toBeLessThanOrEqual(25);
    expect(loudest).toBeGreaterThan(0);
  });

  it("puts a louder click at each boundary", () => {
    const peak = (from: number, to: number) =>
      Math.max(...Array.from(wav.slice(44 + from, 44 + to), (sample) => Math.abs(sample - 128)));
    expect(peak(0, 300)).toBeGreaterThan(peak(1000, 1300));
    expect(peak(8000, 8300)).toBeGreaterThan(peak(10_000, 10_300));
  });
});
