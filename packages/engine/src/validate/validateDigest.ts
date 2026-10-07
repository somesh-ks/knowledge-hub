import {
  Digest,
  type Digest as DigestType,
  homeSection,
  type Item,
  NEVER_PUBLISH,
  type Source,
  TECH_SECTION,
  VOICE_LIMITS,
} from "@dispatch/core";
import { isHttpUrl } from "../extract/urlSafety.js";
import { digestWords, listenMinutes, readMinutes } from "../render/readTime.js";
import { capFor, TECH_ALLOWANCE, TOP_PICKS } from "../score/selectItems.js";
import { type Linter, type ViolationRule, VOICE_FIELDS } from "../voice/lint.js";

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

  const isTech = (item: DigestType["items"][number]): boolean =>
    homeSection(item.category, item.source_type) === TECH_SECTION;
  const techCount = digest.items.filter(isTech).length;
  const mainCount = digest.items.length - techCount;
  const cap = capFor(digest.kind);
  if (mainCount > cap) {
    add(
      "error",
      "item_count",
      techCount === 0
        ? `${mainCount} items; the limit for a ${digest.kind} digest is ${cap}.`
        : `${mainCount} items outside Tech releases; the limit for a ${digest.kind} digest is ${cap}.`,
    );
  }
  if (techCount > TECH_ALLOWANCE) {
    add("error", "item_count", `${techCount} Tech releases items; the limit is ${TECH_ALLOWANCE}.`);
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
  const sourceNames = new Map((context.sources ?? []).map((s) => [s.id, s.name]));

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
        const expectedName = sourceNames.get(source.source_id);
        if (expectedName && expectedName !== item.source) {
          add(
            "warning",
            "source_name",
            `The source "${item.source}" differs from the registry name "${expectedName}".`,
            item.id,
          );
        }
      }
    }

    if (NEVER_PUBLISH.includes(item.category)) {
      add("error", "never_publish", `The category ${item.category} never publishes.`, item.id);
    }
    const home = homeSection(item.category, item.source_type);
    if (item.section === "top" && home === TECH_SECTION) {
      add(
        "error",
        "section_mismatch",
        "A Tech releases story cannot be a Top pick; it belongs in the tech section.",
        item.id,
      );
    } else if (item.section !== "top" && item.section !== home) {
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
  }

  const top = digest.items.filter((item) => item.section === "top").length;
  const expectedTop = Math.min(TOP_PICKS, mainCount);
  if (top !== expectedTop) {
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
