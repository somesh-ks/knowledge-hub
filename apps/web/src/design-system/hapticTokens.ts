/* biome-ignore-all format: generated file, formatted by scripts/buildTokens.ts */
/*
 * GENERATED FILE. Do not edit.
 * Source: tokens/tokens.json (primitive.haptic, semantic.haptic). Build: npx tsx scripts/buildTokens.ts
 * Android plays `android` through navigator.vibrate; iPhone plays `ios.ticks` ticks, `ios.gap_ms` apart.
 */

export const HAPTIC_PATTERNS = {
  "none": { android: [], ios: { ticks: 0, gap_ms: 0 } },
  "tick-light": { android: [20], ios: { ticks: 1, gap_ms: 0 } },
  "tick": { android: [30], ios: { ticks: 1, gap_ms: 0 } },
  "double": { android: [30, 60, 30], ios: { ticks: 2, gap_ms: 90 } },
  "triple": { android: [35, 50, 35, 50, 35], ios: { ticks: 3, gap_ms: 70 } },
  "celebrate": { android: [30, 50, 30, 50, 70], ios: { ticks: 3, gap_ms: 80 } },
} as const;

export type HapticPattern = keyof typeof HAPTIC_PATTERNS;

/** What a control asks for. A call site names one of these and never a pattern. */
export const HAPTIC_INTENTS = {
  "navigate": "none",
  "tap": "none",
  "select": "tick-light",
  "detent": "tick-light",
  "open": "tick",
  "close": "none",
  "start": "tick",
  "success": "double",
  "error": "triple",
  "ready": "celebrate",
} as const satisfies Record<string, HapticPattern>;

export type HapticIntent = keyof typeof HAPTIC_INTENTS;
