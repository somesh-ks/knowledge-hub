/**
 * The Structure view on the Preferences page (D170, docs/design/podcast-structure.md, "The screen"):
 * what each podcast kind's blocks are called, what a row says about a block, which blocks the Add
 * sheet offers, and the rows' markup. Pure and free of core's runtime (zod), so the build draws the
 * list with it and the editor (scripts/structureEditor.ts) draws it again after an edit from the
 * same text: one markup, one source.
 */
import type { StructureBlock, StructureKind } from "@dispatch/core";
import type { ConfigOp } from "../types/contracts";
import { ICON_PATHS, ICON_VIEW_BOX, type IconName } from "./icons";

export const KIND_LABEL: Record<StructureKind, string> = {
  daily: "Daily",
  weekly: "Weekly",
  catch_up: "Catch up",
};

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
  /** Each kind's blocks as built: the stored list, or the defaults for the owner's topics. */
  blocks: Record<StructureKind, StructureBlock[]>;
  /** The owner's prompts as built, by kind and key. */
  prompts: Record<StructureKind, Record<string, string>>;
  /** The built-in prompts, each text once (they repeat across blocks and kinds). */
  texts: string[];
  /** For each kind and block type ("section" for every section), the index of its built-in prompt. */
  builtins: Record<StructureKind, Partial<Record<StructureBlock["type"], number>>>;
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

/** The block's built-in prompt in this kind, or null when no model writes it. */
export function builtinPrompt(
  data: Pick<StructureData, "texts" | "builtins">,
  kind: StructureKind,
  block: StructureBlock,
): string | null {
  const index = data.builtins[kind][block.type];
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

/** How new a block's stories must be, in hours (core's MAX_AGE_STOPS), with the words for each. */
export const AGE_STOPS: readonly { hours: number; label: string; summary: string }[] = [
  { hours: 12, label: "12 hours", summary: "last 12 h" },
  { hours: 24, label: "1 day", summary: "last day" },
  { hours: 48, label: "2 days", summary: "last 2 days" },
  { hours: 72, label: "3 days", summary: "last 3 days" },
  { hours: 168, label: "1 week", summary: "last week" },
];

type StoryBlock = Extract<
  StructureBlock,
  { type: "section" | "top_picks" | "trending" | "release_news" }
>;

/** A block that brings stories and so takes the rules code holds it to (per source, age). */
export function isStoryBlock(block: StructureBlock): block is StoryBlock {
  return (
    block.type === "section" ||
    block.type === "top_picks" ||
    block.type === "trending" ||
    block.type === "release_news"
  );
}

/**
 * Whether the block takes an age limit here. Top picks takes its stories from the sections, which
 * keep their own limits, and Catch up takes its window from its form (the Create sheet's Look back).
 */
export function takesAge(kind: StructureKind, block: StructureBlock): boolean {
  return kind !== "catch_up" && isStoryBlock(block) && block.type !== "top_picks";
}

/** The same block with a rule set; null leaves the app's own. */
export function withRule(
  block: StructureBlock,
  rule: "per_source" | "max_age_hours",
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
 * · 1 per source · last day". A setting left to the app says nothing, except where nothing else
 * would ("The usual count").
 */
export function blockSummary(kind: StructureKind, block: StructureBlock): string {
  const count = storiesOf(block);
  const counted = typeof count === "number" ? storiesText(count) : null;
  const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
  const rules = isStoryBlock(block)
    ? [
        block.per_source === undefined ? null : `${block.per_source} per source`,
        block.max_age_hours === undefined || !takesAge(kind, block)
          ? null
          : (AGE_STOPS.find((stop) => stop.hours === block.max_age_hours)?.summary ?? null),
      ]
    : [];
  const join = (parts: readonly (string | null)[]): string =>
    capital(parts.filter((part): part is string => part !== null).join(" · "));
  switch (block.type) {
    case "section":
    case "top_picks":
      return join([counted, DEPTH_LABEL[block.depth], ...rules]);
    case "trending":
    case "release_news":
      return join([counted ?? (rules.some(Boolean) ? null : "The usual count"), ...rules]);
    case "rundown":
      return counted ?? "The usual count";
    case "close":
      return block.length === "long" ? "Long" : "Short";
    case "custom":
      return "Your own block";
    case "hello":
      return kind === "catch_up" ? "Opens the episode" : "Opens the episode, spoken by the app";
    case "sign_off":
      return kind === "catch_up" ? "Ends the episode" : "Ends the episode, spoken by the app";
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
 * Whether a section block plays nothing in this briefing because every topic it gathers is left out
 * of it (a topic's Listen in). It stays in the list, quiet, so it comes back where it was. Catch up
 * picks its topics on its form, so nothing there is off.
 */
export function isOff(
  kind: StructureKind,
  block: StructureBlock,
  sections: readonly SectionOffer[],
  skip: SkipLists,
): boolean {
  if (kind === "catch_up" || block.type !== "section") return false;
  const topics = sections.find((section) => section.id === block.id)?.topics ?? [];
  return topics.length > 0 && topics.every((id) => skip[kind].includes(id));
}

/** A block the Add sheet offers: what it adds and the name it is listed by. */
export interface AddOffer {
  key: string;
  name: string;
  block: StructureBlock | null;
}

/**
 * The blocks not yet in the kind's structure: each section not placed, then the singletons not
 * placed, then (Catch up only) the close and a block of the owner's own. A close and an owner's
 * block have nobody to write them in a briefing, which code narrates (D176). Nothing when full.
 */
export function addOffers(
  kind: StructureKind,
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
    ...(kind === "catch_up" ? [{ type: "close", length: "short" } as const] : []),
  ];
  for (const block of singles) {
    if (!placed.has(block.type))
      offers.push({ key: block.type, name: blockName(block, sections), block });
  }
  const own = blocks.filter((block) => block.type === "custom").length;
  if (kind === "catch_up" && own < MAX_OWN_BLOCKS)
    offers.push({ key: "custom", name: "Your own block", block: null });
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

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * The kind as it goes into an id, read from a table rather than written through: the editor's kind
 * comes from the address, and markup takes only text this file wrote.
 */
const KIND_ID: Record<StructureKind, string> = {
  daily: "daily",
  weekly: "weekly",
  catch_up: "catch-up",
};

const icon = (name: IconName): string =>
  `<svg class="icon" viewBox="${ICON_VIEW_BOX}" aria-hidden="true" focusable="false"><path d="${ICON_PATHS[name]}"></path></svg>`;

const item = (act: string, label: string, disabled = false, extra = ""): string =>
  `<button class="hero-menu-item${extra}" type="button" role="menuitem" data-act="${act}"${disabled ? " disabled" : ""}>${label}</button>`;

/**
 * The kind's rows: a body row's grip to drag it (or to move it with the arrow keys), the block's
 * name and what it holds, its dots with Move up, Move down,
 * Edit and Remove (the More menu, MenuSheet.astro's markup: a bottom sheet on a phone), and the
 * frame rows at the ends drawn quieter with no menu. A frame a model writes (Catch up's hello and
 * sign-off) keeps one pencil for its prompt. A section whose every topic is left out of the
 * briefing stays, quiet, and says so.
 */
export function rowsHtml(
  kind: StructureKind,
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
      const off = isOff(kind, block, data.sections, skip);
      const summary = escapeHtml(
        off
          ? `Off in ${KIND_LABEL[kind].toLowerCase()} · ${blockSummary(kind, block)}`
          : blockSummary(kind, block),
      );
      const text = `<div class="settings-text"><span class="settings-label">${name}</span><span class="settings-hint">${summary}</span></div>`;
      if (isFrame(block)) {
        const edit =
          builtinPrompt(data, kind, block) === null
            ? ""
            : `<button class="icon-btn press structure-edit" type="button" aria-label="Edit ${name}" data-act="edit">${icon("pencil")}</button>`;
        return `<li class="settings-row structure-row" data-index="${index}" data-frame><span class="structure-grip-room" aria-hidden="true"></span>${text}${edit}</li>`;
      }
      const menu = `structure-menu-${KIND_ID[kind]}-${Number(index)}`;
      return [
        `<li class="settings-row structure-row" data-index="${index}"${off ? " data-off" : ""}>`,
        `<button class="icon-btn structure-grip" type="button" aria-label="Move ${name}" aria-describedby="structure-grip-hint" data-grip>${icon("grip")}</button>`,
        text,
        `<div class="structure-menu" style="--row-anchor: --${menu}">`,
        `<button class="icon-btn press structure-more" type="button" aria-label="More for ${name}" aria-haspopup="menu" popovertarget="${menu}" data-hero-more>${icon("moreVert")}</button>`,
        `<div class="hero-menu-list menu-sheet structure-menu-list" id="${menu}" popover>`,
        `<div class="create-sheet-head"><h2 class="sheet-title" id="${menu}-title">${name}</h2><button class="icon-btn press" type="button" aria-label="Close" data-menu-close>${icon("close").replace('class="icon"', 'class="icon icon-lg"')}</button></div>`,
        `<div class="menu-sheet-items" role="menu" aria-label="${name}">`,
        item("up", "Move up", index <= 1),
        item("down", "Move down", index >= last),
        item("edit", "Edit"),
        item("remove", "Remove", alone, " hero-menu-delete"),
        `</div></div></div></li>`,
      ].join("");
    })
    .join("");
}

/** The quiet line under the card: how many blocks bring stories, and how many are off. */
export function fitLine(
  kind: StructureKind,
  blocks: readonly StructureBlock[],
  sections: readonly SectionOffer[],
  skip: SkipLists,
): string {
  const story = blocks.filter(
    (block) => storiesOf(block) !== undefined && block.type !== "rundown",
  );
  const off = story.filter((block) => isOff(kind, block, sections, skip)).length;
  const playing = story.length - off;
  const count = playing === 1 ? "1 block brings stories" : `${playing} blocks bring stories`;
  return off > 0 ? `${count}; ${off} ${off === 1 ? "is" : "are"} off` : count;
}
