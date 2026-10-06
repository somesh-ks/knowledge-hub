/**
 * A short synthesized audio file for the fixture digest, so the e2e tests and the visual review can
 * press play without a real narration. It is 8-bit mono PCM in a WAV container: a quiet tone with a
 * brief click at each item boundary, so a listener can hear the seek land. Served only when
 * DISPATCH_FIXTURES=1.
 */
export interface FixtureAudioOptions {
  seconds: number;
  sampleRate?: number;
  /** Seconds at which an item starts, for the boundary clicks. */
  boundaries?: readonly number[];
}

const SILENCE = 128;

export function synthesizeWav({
  seconds,
  sampleRate = 8000,
  boundaries = [],
}: FixtureAudioOptions): Uint8Array<ArrayBuffer> {
  const samples = Math.round(seconds * sampleRate);
  const buffer = new Uint8Array(44 + samples);
  const view = new DataView(buffer.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      buffer[offset + index] = text.charCodeAt(index);
    }
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // bytes per second: one byte per sample
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples, true);

  const clickLength = Math.round(sampleRate * 0.04);
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const tone = Math.sin(2 * Math.PI * 220 * time) * 5;
    const boundary = boundaries.find(
      (start) => time >= start && index - start * sampleRate < clickLength,
    );
    const click = boundary === undefined ? 0 : Math.sin(2 * Math.PI * 660 * time) * 14;
    buffer[44 + index] = Math.round(SILENCE + tone + click);
  }
  return buffer;
}
