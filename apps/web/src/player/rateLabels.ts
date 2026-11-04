/** "1x", "1.25x", "0.5x": no trailing zeros. What is said, and what a screen reader reads. */
export function rateLabel(rate: number): string {
  return `${Number(rate.toFixed(2))}x`;
}

/**
 * "1.00x", "1.05x", "0.50x": the readout's text, always five characters. Tabular digits keep each
 * digit one width, but "1x" against "1.05x" changed the text's length, so as the speed moved the
 * centred readout slid by up to 11px (the owner: "not having set character width", 2026-10-18).
 */
export function rateFace(rate: number): string {
  return `${rate.toFixed(2)}x`;
}
