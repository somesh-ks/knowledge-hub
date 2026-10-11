/** "Daily", "Daily and Custom", "Daily, Weekly and Custom": the chosen labels as a person says them. */
export function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
