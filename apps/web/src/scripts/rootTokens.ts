/** A custom property as the root computes it now (the mood's tokens). */
export function rootStyle(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

/** A duration token in ms (the build writes 1500ms as 1.5s). */
export function tokenMs(token: string): number {
  const value = rootStyle(token).trim();
  return Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000) || 0;
}
