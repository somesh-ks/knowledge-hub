export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Four decimals keep persisted scores stable and make exact tie-breaking meaningful. */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
