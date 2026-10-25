/**
 * What the design catalogue page (/design, D189) reads at build time: the tokens from tokens.json,
 * grouped as the tiers group them, and the usage comment written over a shared class in its
 * stylesheet, so the page documents the system from the files the system is built from and cannot
 * drift from them. The page exists in dev and fixture builds only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "./repoRoot";

export interface CatalogueToken {
  /** The dotted path under its tier: "color.accent". */
  path: string;
  /** The custom property the build writes: "--color-accent". */
  name: string;
  type: string;
  /** The value as written: a literal or a {reference}. */
  value: string;
  description?: string;
}

export type Tier = "primitive" | "semantic" | "component";

interface RawToken {
  $type?: string;
  $value?: unknown;
  $description?: string;
}

const isToken = (node: unknown): node is RawToken =>
  typeof node === "object" && node !== null && "$value" in node;

const valueText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null)
    return Object.entries(value as Record<string, unknown>)
      .map(([key, part]) => `${key} ${valueText(part)}`)
      .join(", ");
  return JSON.stringify(value);
};

/** The tokens of one tier, in file order, grouped by their first segment ("color", "space"). */
export function tokenGroups(
  tier: Tier,
  root: string = findRepoRoot(),
): Map<string, CatalogueToken[]> {
  const doc = JSON.parse(readFileSync(join(root, "tokens", "tokens.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const groups = new Map<string, CatalogueToken[]>();
  const walk = (node: unknown, path: string[]): void => {
    if (isToken(node)) {
      const group = path[0] ?? "";
      const list = groups.get(group) ?? [];
      list.push({
        path: path.join("."),
        name: `--${path.join("-")}`,
        type: node.$type ?? "",
        value: valueText(node.$value),
        ...(node.$description ? { description: node.$description } : {}),
      });
      groups.set(group, list);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>))
      if (!key.startsWith("$")) walk(child, [...path, key]);
  };
  walk(doc[tier], []);
  return groups;
}

/**
 * The comment written over a class in a stylesheet: the block comment that ends on the line before
 * the first rule whose selector list begins with `selector`. Whitespace is folded; an empty string
 * when the class has no comment, which the page shows as a gap to fill.
 */
export function usageComment(
  stylesheet: string,
  selector: string,
  root: string = findRepoRoot(),
): string {
  const css = readFileSync(join(root, "apps", "web", "src", "styles", stylesheet), "utf8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The first rule under a comment: a class may also open a group ("a, b {") that has none.
  for (const rule of css.matchAll(new RegExp(`^${escaped}(?:[,\\s{]|$)`, "gm"))) {
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
