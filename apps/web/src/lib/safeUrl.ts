/**
 * Only http and https links are rendered as links. A digest is written by a model from text it
 * fetched, so a URL field is untrusted: `javascript:` and `data:` URLs are valid URLs but must never
 * become an href. The headline of such an item is shown as plain text instead.
 */
export function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
