/** What the style guide's pages read at build time: the tokens, grouped as the tiers group them. */
import { type CatalogueToken, tokenGroups } from "../../../web/src/lib/designCatalogue";
import { href } from "./sections";

export const semantic = tokenGroups("semantic");
export const primitive = tokenGroups("primitive");
export const component = tokenGroups("component");

/** The semantic colour roles, in the groups a reader looks for them by. */
export const COLOUR_GROUPS: readonly { title: string; note: string; names: readonly string[] }[] = [
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
    note: "Colour is information: it says what happened, and a word or a glyph always says it too.",
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
    note: "The ring that survives forced colours, and the scrim under a sheet.",
    names: ["focus-ring", "focus-gap", "scrim"],
  },
];

/** Foreground on background pairs the style guide measures live, with the contrast each must reach. */
export const COLOUR_PAIRS: readonly { fg: string; bg: string; min: number; note: string }[] = [
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

/** A semantic colour token by its role name ("on-surface"). */
export function colourToken(name: string): CatalogueToken | undefined {
  return semantic.get("color")?.find((token) => token.path === `color.${name}`);
}

/** One searchable thing: a colour, a text role, a token. */
export interface SearchEntry {
  kind: "colour" | "type" | "token";
  title: string;
  /** What else the search matches: classes, categories, values, notes. */
  tags: string;
  href: string;
  detail: string;
}

/** Where each token group is drawn, when it is not on a Tokens section of its own name. */
const TOKEN_GROUP_HREF: Record<string, string> = {
  stroke: "/tokens#radius",
  font: "/type",
  duration: "/tokens#motion",
  ease: "/tokens#motion",
  spring: "/tokens#motion",
  scale: "/tokens#motion",
  distance: "/tokens#motion",
  state: "/tokens#motion",
  opacity: "/tokens#motion",
  blur: "/tokens#motion",
  z: "/tokens#layers",
  breakpoint: "/tokens#layout",
  size: "/tokens#layout",
};

export function searchIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const token of semantic.get("color") ?? [])
    entries.push({
      kind: "colour",
      title: token.name,
      tags: `${token.value} ${token.description ?? ""}`,
      href: href(`/colour#${token.path.slice("color.".length)}`),
      detail: "Colour",
    });
  for (const token of semantic.get("text") ?? [])
    entries.push({
      kind: "type",
      title: token.name,
      tags: "type text role font",
      href: href(`/type#${token.path.replace(".", "-")}`),
      detail: "Type",
    });
  for (const [group, tokens] of [...primitive.entries(), ...semantic.entries()]) {
    if (group === "color" || group === "text") continue;
    for (const token of tokens)
      entries.push({
        kind: "token",
        title: token.name,
        tags: `${token.value} ${token.description ?? ""}`,
        href: href(TOKEN_GROUP_HREF[group] ?? `/tokens#${group}`),
        detail: token.value.length > 28 ? group : `${group} · ${token.value}`,
      });
  }
  return entries;
}
