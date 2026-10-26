/**
 * Which file of a briefing's narration this browser plays (plan 19.1). The engine publishes the MP3
 * and the same speech as Opus in WebM and in MP4 (`.m4a`). WebM Opus is first (Chrome, Edge,
 * Firefox, Android), then MP4 Opus (iOS Safari), then the MP3, which every browser plays.
 */
export interface AudioSources {
  url: string;
  webm_url?: string | undefined;
  m4a_url?: string | undefined;
}

export type CanPlayType = (type: string) => string;

export const WEBM_OPUS = "audio/webm; codecs=opus";
export const M4A_OPUS = "audio/mp4; codecs=opus";

/** "probably" and "maybe" both say the browser can try; only "" says it cannot. */
export function pickAudioUrl(audio: AudioSources, canPlayType: CanPlayType): string {
  if (audio.webm_url && canPlayType(WEBM_OPUS) !== "") return audio.webm_url;
  if (audio.m4a_url && canPlayType(M4A_OPUS) !== "") return audio.m4a_url;
  return audio.url;
}

/** The page's own answer, asked of an element that is never attached or loaded. */
export function browserCanPlayType(): CanPlayType {
  if (typeof document === "undefined") return () => "";
  const probe = document.createElement("audio");
  return (type) => probe.canPlayType(type);
}
