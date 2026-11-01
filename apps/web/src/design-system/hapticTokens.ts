/* biome-ignore-all format: generated file, formatted by scripts/buildTokens.ts */
/*
 * GENERATED FILE. Do not edit.
 * Source: tokens/tokens.json (primitive.haptic, semantic.haptic). Build: npx tsx scripts/buildTokens.ts
 * Android plays `android` through navigator.vibrate; iPhone plays `ios.ticks` ticks, `ios.gap_ms` apart.
 */

export const HAPTIC_PATTERNS = {
  "none": { android: [], ios: { ticks: 0, gap_ms: 0 } },
  "tick-light": { android: [12], ios: { ticks: 1, gap_ms: 0 } },
  "tick": { android: [16], ios: { ticks: 1, gap_ms: 0 } },
  "double": { android: [12, 70, 12], ios: { ticks: 2, gap_ms: 90 } },
  "thud": { android: [16, 60, 16], ios: { ticks: 2, gap_ms: 60 } },
  "celebrate": { android: [12, 108, 20], ios: { ticks: 2, gap_ms: 120 } },
} as const;

export type HapticPattern = keyof typeof HAPTIC_PATTERNS;

/** What a control asks for. A call site names one of these and never a pattern. */
export const HAPTIC_INTENTS = {
  "navigate": "tick-light",
  "tap": "tick-light",
  "select": "tick-light",
  "detent": "tick-light",
  "open": "tick",
  "close": "none",
  "start": "tick",
  "success": "double",
  "error": "thud",
  "ready": "celebrate",
} as const satisfies Record<string, HapticPattern>;

export type HapticIntent = keyof typeof HAPTIC_INTENTS;
