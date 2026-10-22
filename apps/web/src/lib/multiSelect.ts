/** "Daily", "Daily and Catch up", "Daily, Weekly and Catch up": the chosen labels as a person says them. */
/**
 * What a MultiSelect's field says: `all` ("All podcasts") when every option is chosen and the
 * field names one, else the chosen labels joined, else `empty`.
 */
export function chosenSummary(
  labels: readonly string[],
  total: number,
  all = "",
  empty = "",
): string {
  if (all && total > 1 && labels.length === total) return all;
  return joinLabels(labels) || empty;
}

export function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
