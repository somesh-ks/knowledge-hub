/** Lowercase kebab-case from any text: letters and digits, single hyphens, no edge hyphens. */
export function slugify(text: string, maxLength = 80): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}
