/**
 * What the style guide (D226) reads at build time: the tokens from tokens.json, grouped as the
 * tiers group them, so the guide documents the system from the file the system is built from and
 * cannot drift from it. It imports the file from the package, never from the reader (D382 step 4c).
 */
import tokens from "@singularity/design-system/tokens/tokens.json";

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
  doc: Record<string, unknown> = tokens,
): Map<string, CatalogueToken[]> {
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
