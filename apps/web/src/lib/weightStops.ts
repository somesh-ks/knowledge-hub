/**
 * A weight slider sits on one of five fixed stops (core WEIGHT_STOPS). Its value is the stop's
 * place, 0 to 4, so the stops are evenly spaced under the thumb; `data-stops` lists the weights
 * they stand for and `data-names` their names. A range without them (a test's) holds the weight.
 */

export function weightOf(slider: HTMLInputElement, value: string = slider.value): number {
  const stops = slider.dataset?.stops?.split(",").map(Number);
  return stops ? (stops[Number(value)] ?? 0) : Number(value);
}

/** The place of the stop nearest to a weight. */
export function stopFor(slider: HTMLInputElement, weight: number): number {
  const stops = slider.dataset?.stops?.split(",").map(Number);
  if (!stops) return weight;
  let best = 0;
  for (const [index, stop] of stops.entries()) {
    if (Math.abs(stop - weight) < Math.abs((stops[best] ?? 0) - weight)) best = index;
  }
  return best;
}

/** The fill, the stop's name beside the slider and the spoken value follow the thumb. */
export function drawStop(slider: HTMLInputElement): void {
  const place = Number(slider.value);
  const name = slider.dataset.names?.split(",")[place] ?? String(place);
  slider.style.setProperty("--range-fill", `${(place / (Number(slider.max) || 1)) * 100}%`);
  slider.setAttribute("aria-valuetext", `${slider.dataset.label ?? ""}, ${name}`);
  const output = slider.closest(".topic-weight")?.querySelector("[data-word]");
  if (output) output.textContent = name;
}
