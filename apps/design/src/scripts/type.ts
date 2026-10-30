/**
 * The Type page: the sample field retypes every role's sample, and each role prints the size,
 * weight and leading it resolves to at this window (the fluid sizes change with it).
 */
export {};

const samples = Array.from(document.querySelectorAll<HTMLElement>("[data-sample]"));
const field = document.querySelector<HTMLInputElement>("[data-sample-input]");

function measure(): void {
  for (const row of document.querySelectorAll<HTMLElement>(".guide-type-row")) {
    const sample = row.querySelector<HTMLElement>("[data-sample]");
    if (!sample) continue;
    const style = getComputedStyle(sample);
    const size = row.querySelector("[data-size]");
    const weight = row.querySelector("[data-weight]");
    const leading = row.querySelector("[data-leading]");
    if (size) size.textContent = `${Number.parseFloat(style.fontSize).toFixed(0)}px`;
    if (weight) weight.textContent = `weight ${style.fontWeight}`;
    if (leading)
      leading.textContent = `leading ${(Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize)).toFixed(2)}`;
  }
}

field?.addEventListener("input", () => {
  for (const sample of samples) sample.textContent = field.value || "The quick brown fox";
  measure();
});
addEventListener("resize", measure);
// After the fonts load, so a fallback's metrics are not read.
document.fonts?.ready.then(measure);
measure();
