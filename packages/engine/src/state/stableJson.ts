function compareKeys(a: string, b: string): number {
  // "version" leads every file; the rest is plain code-unit order so it never depends on locale.
  if (a === "version") return b === "version" ? 0 : -1;
  if (b === "version") return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort(compareKeys)) {
      sorted[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * JSON for committed state: keys sorted, 2-space indent, trailing newline. The same data always
 * serializes to the same bytes, so a diff shows only what changed.
 */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}
