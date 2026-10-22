import {
  categoryIsOff,
  type DigestKind,
  hasOwnAllowance,
  homeSectionFor,
  type Item,
  isBuiltinCategory,
  TECH_SECTION,
  type TopicsFile,
} from "@dispatch/core";
import { assignSections, capFor, TECH_ALLOWANCE } from "../score/selectItems.js";
import { type Linter, VOICE_FIELDS } from "../voice/lint.js";
import { writtenText } from "../write/text.js";
import { AgentSelection, type Selection } from "./selectionFile.js";
import type { DigestWindow } from "./window.js";

export interface AgentIssue {
  /** The item the problem is about, when it is about one. */
  id?: string;
  message: string;
}

export type AgentValidation =
  | { ok: true; selection: Selection }
  | { ok: false; issues: AgentIssue[] };

/**
 * Validate the `selection.json` a Claude Code session wrote. The session reads untrusted text
 * with tools available, so nothing it says is trusted: ids must come from the pool, categories
 * must be publishable, every field it has must pass the voice lint and the size limits, and the
 * result is marked unverified because no grounding check ran. There is no rewrite step here;
 * the session fixes what the report lists and runs the command again.
 */
export function validateAgentSelection(
  raw: unknown,
  context: {
    pool: readonly Item[];
    linter: Linter;
    kind: DigestKind;
    window: DigestWindow;
    /** config/topics.json, so a session can pick a custom topic as the category. */
    topics?: TopicsFile | null | undefined;
  },
): AgentValidation {
  const parsed = AgentSelection.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      })),
    };
  }
  const issues: AgentIssue[] = [];
  const pool = new Map(context.pool.map((item) => [item.id, item]));

  const seen = new Set<string>();
  const candidates = [];
  for (const entry of parsed.data.items) {
    if (seen.has(entry.id)) issues.push({ id: entry.id, message: "The id appears twice." });
    seen.add(entry.id);
    const item = pool.get(entry.id);
    if (!item) {
      issues.push({
        id: entry.id,
        message: "The id is not in the pool. Only pool items can be published.",
      });
      continue;
    }
    if (categoryIsOff(context.topics, entry.category)) {
      issues.push({ id: entry.id, message: `The category ${entry.category} never publishes.` });
      continue;
    }
    const home = homeSectionFor(context.topics, entry.category, item.source_type);
    if (home === null) {
      issues.push({
        id: entry.id,
        message: isBuiltinCategory(entry.category)
          ? `The category ${entry.category} has no section.`
          : `The category ${entry.category} is not a built-in category or an enabled topic that publishes.`,
      });
      continue;
    }
    for (const field of VOICE_FIELDS) {
      const text = entry[field];
      // The why line is optional: the four beats live in the summary.
      if (text === undefined) continue;
      for (const violation of context.linter.lint(field, text)) {
        issues.push({ id: entry.id, message: `${field}: ${violation.message}` });
      }
    }
    candidates.push({ item, category: entry.category, home, score: entry.score, entry });
  }

  // Two kinds of pool, as in the engine's own selection: Tech releases and each custom section
  // have an allowance of their own, and everything else shares the cap.
  const ownBySection = new Map<string, number>();
  for (const candidate of candidates) {
    if (hasOwnAllowance(candidate.home)) {
      ownBySection.set(candidate.home, (ownBySection.get(candidate.home) ?? 0) + 1);
    }
  }
  const ownCount = [...ownBySection.values()].reduce((sum, n) => sum + n, 0);
  // Entries that failed a check above have no section yet; they count against the shared cap.
  const mainCount = parsed.data.items.length - ownCount;
  const cap = capFor(context.kind);
  if (mainCount > cap) {
    const onlyTech = [...ownBySection.keys()].every((section) => section === TECH_SECTION);
    issues.push({
      message:
        ownCount === 0
          ? `${mainCount} items; the limit for a ${context.kind} digest is ${cap}.`
          : onlyTech
            ? `${mainCount} items outside Tech releases; the limit for a ${context.kind} digest is ${cap}.`
            : `${mainCount} items outside the sections with their own allowance; the limit for a ${context.kind} digest is ${cap}.`,
    });
  }
  for (const [section, count] of ownBySection) {
    if (count <= TECH_ALLOWANCE) continue;
    issues.push({
      message:
        section === TECH_SECTION
          ? `${count} Tech releases items; the limit is ${TECH_ALLOWANCE}.`
          : `${count} items in the ${section} section; the limit is ${TECH_ALLOWANCE}.`,
    });
  }
  if (issues.length > 0) return { ok: false, issues };

  const ordered = assignSections(candidates);
  const textOf = new Map(candidates.map((c) => [c.item.id, c.entry]));
  return {
    ok: true,
    selection: {
      version: 1,
      kind: context.kind,
      mode: "agent",
      outcome: "selected",
      verified: false,
      window: context.window,
      items: ordered.map((sel) => {
        const entry = textOf.get(sel.item.id) as NonNullable<ReturnType<typeof textOf.get>>;
        return {
          id: sel.item.id,
          category: sel.category,
          score: sel.score,
          ...writtenText(entry),
        };
      }),
    },
  };
}
