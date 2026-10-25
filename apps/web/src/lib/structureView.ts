/**
 * The Structure view on the Preferences page (D170, docs/design/podcast-structure.md, "The screen"):
 * what the one structure's blocks are called, what a row says about a block, which blocks the Add
 * sheet offers, and the rows' markup. Pure and free of core's runtime (zod), so the build draws the
 * list with it and the editor (scripts/structureEditor.ts) draws it again after an edit from the
 * same text: one markup, one source.
 */
import type { NamedProfile, StructureBlock, StructureProfile } from "@singularity/core";
import type { ConfigOp } from "../types/contracts";
import type { IconName } from "./icons";
import { escapeHtml, iconHtml, sheetHeadHtml } from "./sheetHead";

/** A section a block may name: its id, its name, and the topics that file their stories there. */
export interface SectionOffer {
  id: string;
  name: string;
  topics: string[];
}

/** The topics each briefing leaves out (schedule.json, by topic id). Catch up picks per request. */
export interface SkipLists {
  daily: string[];
  weekly: string[];
}

/** Everything the page is built with, handed to the editor in one data attribute. */
export interface StructureData {
  /** The active listener profile as built (Custom until the owner chooses one). */
  profile: StructureProfile;
  /** The one list every podcast follows, as built: the stored one, or the defaults for the owner's topics. */
  blocks: StructureBlock[];
  /** Each named profile's preset, with the owner's topic sections placed in it. */
  presets: Record<NamedProfile, StructureBlock[]>;
  /** The owner's prompts as built, by key. */
  prompts: Record<string, string>;
  /** The built-in prompts, each text once (they repeat across blocks). */
  texts: string[];
  /** For each block type ("section" for every section), the index of its built-in prompt. */
  builtins: Partial<Record<StructureBlock["type"], number>>;
  sections: SectionOffer[];
  skip: SkipLists;
}

/** The most blocks a structure holds, and of the owner's own (MAX_STRUCTURE_BLOCKS, MAX_CUSTOM_BLOCKS). */
export const MAX_BLOCKS = 32;
export const MAX_OWN_BLOCKS = 6;

/** The name a block's prompt is kept under, as core's blockPromptKey names it. */
export function promptKey(block: StructureBlock): string {
  return block.type === "section" ? `section:${block.id}` : block.type;
}

/** The block's built-in prompt, or null when no model writes it. */
export function builtinPrompt(
  data: Pick<StructureData, "texts" | "builtins">,
  block: StructureBlock,
): string | null {
  const index = data.builtins[block.type];
  return index === undefined ? null : (data.texts[index] ?? null);
}

/** Hello and the sign-off open and close every episode: they never move and never leave. */
export function isFrame(block: StructureBlock): boolean {
  return block.type === "hello" || block.type === "sign_off";
}

const TYPE_NAME: Record<Exclude<StructureBlock["type"], "section" | "custom">, string> = {
  hello: "Hello",
  rundown: "Rundown",
  top_picks: "Top picks",
  trending: "Trending",
  release_news: "Release news",
  close: "Close",
  sign_off: "Sign-off",
};

export function blockName(block: StructureBlock, sections: readonly SectionOffer[]): string {
  if (block.type === "section")
    return sections.find((section) => section.id === block.id)?.name ?? block.id;
  if (block.type === "custom") return block.title;
  return TYPE_NAME[block.type];
}

/** The count a block keeps, or undefined for a block that has none. */
export function storiesOf(block: StructureBlock): number | null | undefined {
  switch (block.type) {
    case "section":
      return block.max_stories ?? null;
    case "rundown":
    case "top_picks":
    case "trending":
    case "release_news":
      return block.stories ?? null;
    default:
      return undefined;
  }
}

/** The same block with its count set; null leaves the app's own count. */
export function withStories(block: StructureBlock, stories: number | null): StructureBlock {
  if (block.type === "section") {
    const { max_stories: _, ...rest } = block;
    return stories === null ? rest : { ...rest, max_stories: stories };
  }
  if (
    block.type === "rundown" ||
    block.type === "top_picks" ||
    block.type === "trending" ||
    block.type === "release_news"
  ) {
    const { stories: _, ...rest } = block;
    return stories === null ? rest : { ...rest, stories };
  }
  return block;
}

/** The most stories each block type may hold (core's schema), for the Stories choice. */
export const STORIES_MAX: Partial<Record<StructureBlock["type"], number>> = {
  section: 8,
  rundown: 6,
  top_picks: 6,
  trending: 8,
  release_news: 8,
};

/** The most stories one outlet may bring to a block (core's PER_SOURCE_MAX). */
export const PER_SOURCE_MAX = 4;

type StoryBlock = Extract<
  StructureBlock,
  { type: "section" | "top_picks" | "trending" | "release_news" }
>;

/** A block that brings stories and so takes the rule code holds it to (per source). */
export function isStoryBlock(block: StructureBlock): block is StoryBlock {
  return (
    block.type === "section" ||
    block.type === "top_picks" ||
    block.type === "trending" ||
    block.type === "release_news"
  );
}

/** The same block with a rule set; null leaves the app's own. */
export function withRule(
  block: StructureBlock,
  rule: "per_source",
  value: number | null,
): StructureBlock {
  if (!isStoryBlock(block)) return block;
  const { [rule]: _, ...rest } = block;
  return (value === null ? rest : { ...rest, [rule]: value }) as StructureBlock;
}

const DEPTH_LABEL = { deep: "in depth", brief: "short" } as const;

const storiesText = (count: number): string => (count === 1 ? "1 story" : `${count} stories`);

/**
 * What a row says under the block's name, in parts joined by a centred dot: "4 stories · in depth
 * · 1 per source". A setting left to the app says nothing, except where nothing else
 * would ("Auto", the word the Stories select uses for the same thing).
 */
export function blockSummary(block: StructureBlock): string {
  const count = storiesOf(block);
  const counted = typeof count === "number" ? storiesText(count) : null;
  const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
  const rules =
    isStoryBlock(block) && block.per_source !== undefined ? [`${block.per_source} per source`] : [];
  const join = (parts: readonly (string | null)[]): string =>
    capital(parts.filter((part): part is string => part !== null).join(" · "));
  switch (block.type) {
    case "section":
    case "top_picks":
      return join([counted, DEPTH_LABEL[block.depth], ...rules]);
    case "trending":
    case "release_news":
      return join([counted ?? (rules.some(Boolean) ? null : "Auto"), ...rules]);
    case "rundown":
      return counted ?? "Auto";
    case "close":
      return block.length === "long" ? "Long" : "Short";
    case "custom":
      return "Your own block";
    case "hello":
      return "Opens the episode";
    case "sign_off":
      return "Ends the episode";
  }
}

/** The skip lists after the store's and this device's topic.scope edits. */
export function skipAfter(skip: SkipLists, ops: readonly ConfigOp[]): SkipLists {
  const lists = { daily: new Set(skip.daily), weekly: new Set(skip.weekly) };
  for (const op of ops) {
    if (op.op !== "topic.scope") continue;
    for (const kind of ["daily", "weekly"] as const) {
      const on = (op as Record<string, unknown>)[kind];
      if (typeof on !== "boolean") continue;
      for (const id of op.ids) {
        if (on) lists[kind].delete(id);
        else lists[kind].add(id);
      }
    }
  }
  return { daily: [...lists.daily], weekly: [...lists.weekly] };
}

/**
 * Whether a section block plays nothing in either briefing because every topic it gathers is left
 * out of both (a topic's Listen in). It stays in the list, quiet, so it comes back where it was.
 * Catch up picks its topics on its form, so it never makes a block off.
 */
export function isOff(
  block: StructureBlock,
  sections: readonly SectionOffer[],
  skip: SkipLists,
): boolean {
  if (block.type !== "section") return false;
  const topics = sections.find((section) => section.id === block.id)?.topics ?? [];
  return (
    topics.length > 0 && topics.every((id) => skip.daily.includes(id) && skip.weekly.includes(id))
  );
}

/** A block the Add sheet offers: what it adds and the name it is listed by. */
export interface AddOffer {
  key: string;
  name: string;
  block: StructureBlock | null;
}

/**
 * The blocks not yet in the structure: each section not placed, then the singletons not placed,
 * then the close and a block of the owner's own. Only Catch up, whose script a model writes, speaks
 * a close or an owner's block; the briefings keep them in the list and skip them (D176). Nothing
 * when full.
 */
export function addOffers(
  blocks: readonly StructureBlock[],
  sections: readonly SectionOffer[],
): AddOffer[] {
  if (blocks.length >= MAX_BLOCKS) return [];
  const placed = new Set(blocks.map((block) => block.type));
  const placedSections = new Set(
    blocks.flatMap((block) => (block.type === "section" ? [block.id] : [])),
  );
  const offers: AddOffer[] = sections
    .filter((section) => !placedSections.has(section.id))
    .map((section) => ({
      key: `section:${section.id}`,
      name: section.name,
      block: { type: "section", id: section.id, depth: "brief" },
    }));
  const singles: StructureBlock[] = [
    { type: "rundown" },
    { type: "top_picks", depth: "deep" },
    { type: "trending" },
    { type: "release_news" },
    { type: "close", length: "short" } as const,
  ];
  for (const block of singles) {
    if (!placed.has(block.type))
      offers.push({ key: block.type, name: blockName(block, sections), block });
  }
  const own = blocks.filter((block) => block.type === "custom").length;
  if (own < MAX_OWN_BLOCKS) offers.push({ key: "custom", name: "Your own block", block: null });
  return offers;
}

/**
 * Where an added block goes: before release news, the close or the sign-off, whichever comes first,
 * as a topic's new section is placed (withSectionBlock); a close goes just before the sign-off.
 */
export function insertAt(blocks: readonly StructureBlock[], block: StructureBlock): number {
  const end = blocks.length - 1;
  if (block.type === "close" || block.type === "release_news") return end;
  if (block.type === "rundown") return 1;
  const before = blocks.findIndex(
    (each) => each.type === "release_news" || each.type === "close" || each.type === "sign_off",
  );
  return before < 0 ? end : before;
}

/** The blocks with the one at `from` moved to `to`; a frame and a move past a frame stay put. */
export function moved(
  blocks: readonly StructureBlock[],
  from: number,
  to: number,
): StructureBlock[] {
  const first = 1;
  const last = blocks.length - 2;
  const block = blocks[from];
  if (!block || isFrame(block) || to < first || to > last || to === from) return [...blocks];
  const next = blocks.filter((_, index) => index !== from);
  next.splice(to, 0, block);
  return next;
}

// ------------------------------------------------------------------------------------- markup

const icon = (name: IconName): string => iconHtml(name);

/** A menu's row, as MenuSheet.astro's slot holds them: its glyph at the start, then the word. */
const item = (act: string, glyph: IconName, label: string, disabled = false, extra = ""): string =>
  `<button class="hero-menu-item${extra}" type="button" role="menuitem" data-act="${act}"${disabled ? " disabled" : ""}>${icon(glyph)}${label}</button>`;

/**
 * The rows: a body row's grip to drag it (or to move it with the arrow keys), the block's
 * name and what it holds, its dots with Move up, Move down, Edit and Remove (the More menu,
 * MenuSheet.astro's markup through sheetHead.ts: a bottom sheet on a phone). The hello and sign-off
 * the app speaks are left out; a frame a model writes (Catch up's) is drawn quieter (`data-quiet`,
 * settings.css) with one pencil for its prompt. A section whose every topic is left out of the
 * briefing stays, quiet, and says so. The dots and the pencil end the row as every row's end glyph
 * does (`icon-btn-end`, D187).
 */
export function rowsHtml(
  blocks: readonly StructureBlock[],
  data: Pick<StructureData, "sections" | "texts" | "builtins">,
  skip: SkipLists,
): string {
  const last = blocks.length - 2;
  // A structure keeps one block between the hello and the sign-off (structureProblems).
  const alone = last <= 1;
  return blocks
    .map((block, index) => {
      const name = escapeHtml(blockName(block, data.sections));
      const off = isOff(block, data.sections, skip);
      const summary = escapeHtml(
        off ? `Off in daily and weekly · ${blockSummary(block)}` : blockSummary(block),
      );
      const text = `<div class="settings-text"><span class="settings-label">${name}</span><span class="settings-hint">${summary}</span></div>`;
      if (isFrame(block)) {
        // A frame the app speaks has nothing to change, so it is not listed (owner, 2026-10-24:
        // "remove hello and closing"); one a model writes (Catch up's) stays for its prompt.
        if (builtinPrompt(data, block) === null) return "";
        const edit = `<button class="icon-btn press icon-btn-end structure-edit" type="button" aria-label="Edit ${name}" data-act="edit">${icon("pencil")}</button>`;
        return `<li class="settings-row structure-row" data-index="${index}" data-frame data-quiet><span class="structure-grip-room" aria-hidden="true"></span>${text}${edit}</li>`;
      }
      const menu = `structure-menu-${Number(index)}`;
      return [
        `<li class="settings-row structure-row" data-index="${index}"${off ? " data-off data-quiet" : ""}>`,
        `<button class="icon-btn press structure-grip" type="button" aria-label="Move ${name}" aria-describedby="structure-grip-hint" data-grip>${icon("grip")}</button>`,
        text,
        `<div class="structure-menu" style="--row-anchor: --${menu}">`,
        `<button class="icon-btn press icon-btn-end structure-more" type="button" aria-label="More for ${name}" aria-haspopup="menu" popovertarget="${menu}" data-hero-more>${icon("moreVert")}</button>`,
        `<div class="hero-menu-list menu-sheet structure-menu-list" id="${menu}" popover>`,
        sheetHeadHtml(blockName(block, data.sections), `${menu}-title`, "data-menu-close"),
        `<div class="menu-sheet-items" role="menu" aria-label="${name}">`,
        item("up", "arrowUp", "Move up", index <= 1),
        item("down", "arrowDown", "Move down", index >= last),
        item("edit", "pencil", "Edit"),
        item("remove", "trash", "Remove", alone, " hero-menu-delete"),
        `</div></div></div></li>`,
      ].join("");
    })
    .join("");
}
