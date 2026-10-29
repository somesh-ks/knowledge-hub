/** What the style guide's pages read at build time: the tokens, grouped as the tiers group them. */
import { type CatalogueToken, tokenGroups } from "../../../web/src/lib/designCatalogue";

export const semantic = tokenGroups("semantic");
export const primitive = tokenGroups("primitive");
export const component = tokenGroups("component");

/** The semantic color roles, in the groups a reader looks for them by. */
export const COLOR_GROUPS: readonly { title: string; note: string; names: readonly string[] }[] = [
  {
    title: "Surfaces",
    note: "The page and what sits on it, from the sunken well to the raised sheet.",
    names: [
      "surface",
      "surface-sunken",
      "surface-container",
      "surface-raised",
      "surface-overlay",
      "surface-inverse",
    ],
  },
  {
    title: "Text and icons",
    note: "Ink on those surfaces, from the headline down to the disabled control.",
    names: [
      "on-surface",
      "on-surface-reading",
      "on-surface-muted",
      "on-surface-subtle",
      "on-surface-disabled",
      "on-surface-inverse",
    ],
  },
  {
    title: "Accent",
    note: "One blue. Containers mark what is chosen or current; the action tone marks one creating action.",
    names: [
      "accent",
      "accent-hover",
      "accent-pressed",
      "accent-subtle",
      "accent-container",
      "on-accent-container",
      "accent-container-high",
      "on-accent-container-high",
      "accent-action",
      "on-accent-action",
      "accent-action-state",
      "on-accent",
      "cover-accent",
      "on-cover-accent",
    ],
  },
  {
    title: "Lines",
    note: "Hairlines divide; a control's edge is the one grey that stands 3 to 1.",
    names: ["border-hairline", "border-control", "track", "track-strong", "image-outline"],
  },
  {
    title: "Status",
    note: "Color is information: it says what happened, and a word or a glyph always says it too.",
    names: [
      "success",
      "success-subtle",
      "warning",
      "warning-subtle",
      "danger",
      "danger-subtle",
      "info",
      "info-subtle",
    ],
  },
  {
    title: "Focus and cover",
    note: "The ring that survives forced colors, and the scrim under a sheet.",
    names: ["focus-ring", "focus-gap", "scrim"],
  },
];

/** Foreground on background pairs the style guide measures live, with the contrast each must reach. */
export const COLOR_PAIRS: readonly { fg: string; bg: string; min: number; note: string }[] = [
  { fg: "on-surface", bg: "surface", min: 7, note: "Headlines and labels on the page" },
  { fg: "on-surface-reading", bg: "surface", min: 7, note: "Summaries and running text" },
  { fg: "on-surface-muted", bg: "surface", min: 4.5, note: "Secondary text" },
  { fg: "on-surface-subtle", bg: "surface", min: 4.5, note: "Tertiary text, never lighter" },
  { fg: "on-surface", bg: "surface-container", min: 4.5, note: "A control on the page" },
  { fg: "accent", bg: "surface", min: 4.5, note: "Accent used as text" },
  { fg: "on-accent", bg: "accent", min: 4.5, note: "The filled button" },
  { fg: "on-accent-container", bg: "accent-container", min: 4.5, note: "A chosen chip or segment" },
  {
    fg: "on-accent-container-high",
    bg: "accent-container-high",
    min: 4.5,
    note: "An action that is not a place",
  },
  { fg: "on-accent-action", bg: "accent-action", min: 4.5, note: "The side column's Catch up" },
  { fg: "on-surface-inverse", bg: "surface-inverse", min: 4.5, note: "A toast" },
  { fg: "border-control", bg: "surface", min: 3, note: "A text field's edge (WCAG 1.4.11)" },
  { fg: "danger", bg: "surface", min: 4.5, note: "An error line" },
];

/** A semantic color token by its role name ("on-surface"). */
export function colorToken(name: string): CatalogueToken | undefined {
  return semantic.get("color")?.find((token) => token.path === `color.${name}`);
}

/** How a color role is drawn on the Color page: its fill, the ink laid on it, and the pair measured. */
export interface SwatchSpec {
  fill: string;
  ink?: string;
  fg: string;
  bg: string;
}

/**
 * A role is shown as it is used. A text color sits on the surface it is set on; a surface carries
 * the text set on it; a fill that has its own "on-" role carries that; a status tint carries its
 * status; anything else (a line, a status, a ring) is measured on the page.
 */
export function swatchSpec(name: string): SwatchSpec {
  const has = (role: string): boolean => colorToken(role) !== undefined;
  if (name.startsWith("on-")) {
    const base = name.slice(3);
    const fill = has(base) ? base : "surface";
    return { fill, ink: name, fg: name, bg: fill };
  }
  if (name.startsWith("surface")) {
    const ink = name === "surface-inverse" ? "on-surface-inverse" : "on-surface";
    return { fill: name, ink, fg: ink, bg: name };
  }
  if (has(`on-${name}`)) return { fill: name, ink: `on-${name}`, fg: `on-${name}`, bg: name };
  const base = name.replace(/-subtle$/, "");
  if (base !== name && has(base)) return { fill: name, ink: base, fg: base, bg: name };
  return { fill: name, fg: name, bg: "surface" };
}

/** The color-valued component tokens, each with the semantic role it points at. */
export function componentColors(): { group: string; token: CatalogueToken; role: string }[] {
  const found: { group: string; token: CatalogueToken; role: string }[] = [];
  for (const [group, tokens] of component)
    for (const token of tokens) {
      if (token.type !== "color") continue;
      found.push({
        group,
        token,
        role: token.value.match(/\{semantic\.color\.([^}]+)\}/)?.[1] ?? token.value,
      });
    }
  return found;
}
