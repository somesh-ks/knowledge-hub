import {
  categoryIsOff,
  Digest,
  type Digest as DigestType,
  digestSections,
  displaySource,
  hasOwnAllowance,
  homeSection,
  homeSectionFor,
  type Item,
  isBuiltinCategory,
  isRetiredSection,
  type Source,
  TECH_SECTION,
  type TopicsFile,
  VOICE_LIMITS,
} from "@singularity/core";
import { isHttpUrl } from "../extract/urlSafety.js";
import { digestWords, listenMinutes, readMinutes } from "../render/readTime.js";
import { RELEASE_SECTION } from "../score/releaseNotes.js";
import type { SectionPlan } from "../score/sectionPlan.js";
import { allowanceFor, capFor, TOP_PICKS } from "../score/selectItems.js";
import { type Linter, type ViolationRule, VOICE_FIELDS } from "../voice/lint.js";
import { ungroundedNumbers } from "../write/spokenCheck.js";

/**
 * A category's home before it moved, and the last briefing date it was home: a briefing published
 * by then keeps the section it was filed in, and a later one is checked as usual.
 */
const FORMER_HOMES: Partial<Record<string, { section: string; until: string }>> = {
  // Tool launches lived in Design Engineering until Software Engineering took them (D155).
  developer_tool_launches: { section: "ui-craft", until: "2026-10-22" },
};

function filedInFormerHome(item: { category: string; section: string }, date: string): boolean {
  const former = FORMER_HOMES[item.category];
  return former !== undefined && former.section === item.section && date <= former.until;
}

/** The lower bounds a summary gained with the four-beat voice. */
const SUMMARY_MINIMUMS: ReadonlySet<ViolationRule> = new Set([
  "too_few_words",
  "too_few_sentences",
]);

export type IssueSeverity = "error" | "warning";

export type IssueCode =
  | "schema"
  | "item_count"
  | "duplicate_id"
  | "duplicate_url"
  | "url_invalid"
  | "url_not_in_pool"
  | "id_mismatch"
  | "source_type_mismatch"
  | "source_name"
  | "never_publish"
  | "section_mismatch"
  | "top_size"
  | "window"
  | "voice"
  | "minutes";

export interface ValidationIssue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  itemId?: string;
}

export interface ValidationReport {
  /** True when there are no errors. Warnings do not fail validation. */
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
}

export interface ValidateContext {
  /** Candidate pool of the run. Omit to skip the pool checks (for example when validating an old file). */
  pool?: readonly Item[];
  /** Source registry, used to check the displayed source name against the pool item's source. */
  sources?: readonly Source[];
  /**
   * config/topics.json, to check a custom topic's section and its never-publish flag. Without it
   * a custom topic's section is not checked, which is right for an old digest whose topic was removed.
   */
  topics?: TopicsFile | null | undefined;
  /**
   * Most items outside the sections with their own allowance. Defaults to the kind's cap (12,
   * weekly 18); a briefing sized by the owner's length passes the digest's hard cap instead.
   */
  cap?: number;
  /** The kind's structure (D170): its Top picks count and section allowances. Absent is the default. */
  plan?: SectionPlan;
  linter: Linter;
}

/**
 * Validate a digest. Errors: schema, item limits, repeated ids or URLs, a URL missing from the
 * pool (the model may never invent a link), a never-publish category, a wrong section or top
 * size, a Tech releases story among the Top picks, and voice lint failures on any written field.
 * Warnings: a source name or reading time that differs from what the engine would compute.
 *
 * Item limits are counted in two pools: Tech releases has its own allowance, and everything else
 * shares the cap for the digest kind.
 *
 * "No empty sections" holds by construction (a digest lists only the sections its items use), so
 * the check that can fail is the Top picks size: three, or every item outside Tech releases when
 * there are fewer than three of those.
 */
export function validateDigest(input: unknown, context: ValidateContext): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (
    severity: IssueSeverity,
    code: IssueCode,
    message: string,
    itemId?: string,
  ): void => {
    issues.push({ severity, code, message, ...(itemId ? { itemId } : {}) });
  };

  const parsed = Digest.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      add("error", "schema", `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    return summarize(issues);
  }
  const digest: DigestType = parsed.data;

  // Where the item belongs by its category. Undefined when that cannot be known: a custom topic
  // checked without config/topics.json, or one that has since been removed.
  const homeOf = (item: DigestType["items"][number]): string | null | undefined => {
    if (isBuiltinCategory(item.category)) return homeSection(item.category, item.source_type);
    if (!context.topics) return undefined;
    if (!context.topics.topics.some((topic) => topic.id === item.category)) return undefined;
    return homeSectionFor(context.topics, item.category, item.source_type);
  };
  const ownerOf = (item: DigestType["items"][number]): string | undefined => {
    const home = homeOf(item);
    if (home !== undefined) return home ?? undefined;
    return item.section === "top" ? undefined : item.section;
  };
  // Sections with an allowance of their own (Tech releases and custom sections) count apart from the cap.
  const allowanceBySection = new Map<string, number>();
  for (const item of digest.items) {
    const owner = ownerOf(item);
    if (owner !== undefined && hasOwnAllowance(owner)) {
      allowanceBySection.set(owner, (allowanceBySection.get(owner) ?? 0) + 1);
    }
  }
  const allowanceCount = [...allowanceBySection.values()].reduce((sum, n) => sum + n, 0);
  const mainCount = digest.items.length - allowanceCount;
  const cap = context.cap ?? capFor(digest.kind);
  const onlyTech = [...allowanceBySection.keys()].every((section) => section === TECH_SECTION);
  if (mainCount > cap) {
    add(
      "error",
      "item_count",
      allowanceCount === 0
        ? `${mainCount} items; the limit for a ${digest.kind} digest is ${cap}.`
        : onlyTech
          ? `${mainCount} items outside Tech releases; the limit for a ${digest.kind} digest is ${cap}.`
          : `${mainCount} items outside the sections with their own allowance; the limit for a ${digest.kind} digest is ${cap}.`,
    );
  }
  const titles = new Map(digestSections(digest).map((section) => [section.id, section.title]));
  for (const [section, count] of allowanceBySection) {
    const allowance = allowanceFor(section, context.plan);
    if (count <= allowance) continue;
    add(
      "error",
      "item_count",
      section === TECH_SECTION
        ? `${count} Tech releases items; the limit is ${allowance}.`
        : `${count} items in ${titles.get(section) ?? section}; the limit is ${allowance}.`,
    );
  }
  if (digest.items.length < VOICE_LIMITS.items.floor) {
    add(
      "error",
      "item_count",
      `${digest.items.length} items; the minimum is ${VOICE_LIMITS.items.floor}.`,
    );
  }
  if (Date.parse(digest.window.from) >= Date.parse(digest.window.to)) {
    add("error", "window", "The window must start before it ends.");
  }

  const poolByUrl = new Map<string, Item>();
  for (const item of context.pool ?? []) {
    poolByUrl.set(item.url, item);
    poolByUrl.set(item.canonical_url, item);
  }
  const registry = new Map((context.sources ?? []).map((s) => [s.id, s]));

  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  for (const item of digest.items) {
    if (seenIds.has(item.id))
      add("error", "duplicate_id", `The id ${item.id} appears twice.`, item.id);
    seenIds.add(item.id);
    if (seenUrls.has(item.url))
      add("error", "duplicate_url", `The URL ${item.url} appears twice.`, item.id);
    seenUrls.add(item.url);

    if (!isHttpUrl(item.url))
      add("error", "url_invalid", "Item URLs must be http or https.", item.id);

    if (context.pool) {
      const source = poolByUrl.get(item.url);
      if (!source) {
        add(
          "error",
          "url_not_in_pool",
          `The URL ${item.url} is not in the candidate pool.`,
          item.id,
        );
      } else {
        if (source.id !== item.id) {
          add(
            "error",
            "id_mismatch",
            `The id ${item.id} does not match the pool item ${source.id}.`,
            item.id,
          );
        }
        if (source.source_type !== item.source_type) {
          add(
            "error",
            "source_type_mismatch",
            `source_type ${item.source_type} differs from the pool (${source.source_type}).`,
            item.id,
          );
        }
        // Aggregated and link-list items are credited to the publisher of their URL.
        const entry = registry.get(source.source_id);
        const expectedName =
          entry &&
          displaySource({
            url: source.canonical_url,
            sourceType: source.source_type,
            sourceName: entry.name,
            linkSource: entry.options.kind === "newsletter-link",
          });
        if (expectedName && expectedName !== item.source) {
          add(
            "warning",
            "source_name",
            `The source "${item.source}" differs from the expected name "${expectedName}".`,
            item.id,
          );
        }
      }
    }

    const customTopic = isBuiltinCategory(item.category)
      ? undefined
      : context.topics?.topics.find((topic) => topic.id === item.category);
    if (categoryIsOff(context.topics, item.category) || customTopic?.never_publish) {
      add("error", "never_publish", `The category ${item.category} never publishes.`, item.id);
    }
    if (!isBuiltinCategory(item.category) && context.topics && !customTopic) {
      add(
        "warning",
        "section_mismatch",
        `The topic ${item.category} is not in config/topics.json, so its section was not checked.`,
        item.id,
      );
    }
    const home = homeOf(item);
    if (item.section === "top" && home !== undefined && home !== null && hasOwnAllowance(home)) {
      add(
        "error",
        "section_mismatch",
        home === TECH_SECTION
          ? "A Tech releases story cannot be a Top pick; it belongs in the tech section."
          : `A story from ${titles.get(home) ?? home} cannot be a Top pick; it belongs in its own section.`,
        item.id,
      );
    } else if (
      home !== undefined &&
      item.section !== "top" &&
      item.section !== home &&
      // A briefing published before the sections were retitled keeps the section it was filed in.
      !isRetiredSection(item.section) &&
      !filedInFormerHome(item, digest.date)
    ) {
      add(
        "error",
        "section_mismatch",
        `The section ${item.section} does not fit the category ${item.category} (expected ${home ?? "none"}).`,
        item.id,
      );
    }

    // An item with a why line was written before the four-beat voice, when a summary was one or
    // two short sentences. Its summary keeps the upper limits but not the newer lower bounds.
    const legacy = item.why !== undefined;
    for (const field of VOICE_FIELDS) {
      const text = item[field];
      // A digest in the four-beat voice has no why line; there is nothing to lint.
      if (text === undefined) continue;
      for (const violation of context.linter.lint(field, text)) {
        if (legacy && field === "summary" && SUMMARY_MINIMUMS.has(violation.rule)) continue;
        add("error", "voice", `${field}: ${violation.message}`, item.id);
      }
    }
    // A shape worth a second look, not a reason to hold the digest back.
    for (const warning of context.linter.warnings("headline", item.headline)) {
      add("warning", "voice", `headline: ${warning.message}`, item.id);
    }
    if (item.spoken !== undefined) {
      const missing = ungroundedNumbers(item.spoken, item.headline, item.summary);
      if (missing.length > 0) {
        add(
          "error",
          "voice",
          `spoken: states ${missing.join(", ")}, which the headline and summary do not.`,
          item.id,
        );
      }
    }
  }

  const top = digest.items.filter((item) => item.section === "top").length;
  // Release stories are never Top picks (selectItems.ts), so a briefing of few others has fewer.
  const releases = digest.items.filter((item) => item.section === RELEASE_SECTION).length;
  const picks = context.plan?.topPicks ?? TOP_PICKS;
  const expectedTop = Math.min(picks, mainCount - releases);
  // A digest from before D39, when Launches was an ordinary section, kept three picks beside it.
  if (top !== expectedTop && top !== Math.min(picks, mainCount)) {
    add("error", "top_size", `Top picks has ${top} items; it must have ${expectedTop}.`);
  }

  const words = digestWords(digest.items);
  if (
    digest.read_minutes !== readMinutes(words) ||
    digest.listen_minutes !== listenMinutes(words)
  ) {
    add(
      "warning",
      "minutes",
      `Reading and listening times (${digest.read_minutes} and ${digest.listen_minutes}) differ from the text (${readMinutes(words)} and ${listenMinutes(words)}).`,
    );
  }
  return summarize(issues);
}

function summarize(issues: ValidationIssue[]): ValidationReport {
  const errors = issues.filter((i) => i.severity === "error").length;
  return { ok: errors === 0, errors, warnings: issues.length - errors, issues };
}
