/**
 * The usage comment written over a shared class in its stylesheet: the owner's wording of what a
 * part is for. The system file (build.ts) and the style guide (apps/web/src/lib/designCatalogue.ts)
 * both read it from here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The comment written over a class in a stylesheet: the block comment that ends on the line before
 * the first rule whose selector list begins with `selector` alone, in `stylesheet` (a path under
 * `root`; a descendant rule such as `selector .child` is another thing's). Whitespace is folded; an
 * empty string when the class has no comment, which the page shows as a gap to fill.
 */
export function usageComment(stylesheet: string, selector: string, root: string): string {
  const css = readFileSync(join(root, stylesheet), "utf8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The first rule under a comment: a class may also open a group ("a, b {") that has none.
  for (const rule of css.matchAll(new RegExp(`^${escaped}(?=\\s*(?:[,{]|$))`, "gm"))) {
    const before = css.slice(0, rule.index).trimEnd();
    if (!before.endsWith("*/")) continue;
    const start = before.lastIndexOf("/*");
    if (start < 0) continue;
    const text = before
      .slice(start + 2, -2)
      .replace(/^\s*\*\s?/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    // The page shows the usage, not the markup sample some comments end with.
    const markup = text.indexOf("Markup:");
    return (markup > 0 ? text.slice(0, markup) : text).trim();
  }
  return "";
}
