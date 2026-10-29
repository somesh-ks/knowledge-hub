import type { Item, JudgmentEntry, JudgmentsFile, Preferences } from "@singularity/core";
import { DEFAULT_JEV_MODEL } from "../judge/jev.js";
import { QUESTIONS_HASH } from "../judge/questions.js";
import { scoreItem } from "../score/scoreItem.js";
import { eligibility } from "../score/selectItems.js";
import { type AuthorityFile, authorityMatcher, isAuthority, withAuthority } from "./authority.js";

/** The reassessment line (D234): an authority domain whose judged items pass more often than this. */
export const AUTHORITY_PASS_GUARD = 0.3;
/** Fewer judged items than this say nothing about a domain's rate. */
export const AUTHORITY_GUARD_MIN = 5;

export interface DomainReplay {
  judged: number;
  passed_before: number;
  passed_after: number;
  /** passed_after / judged. */
  share_after: number;
}

export interface NewlyPassing {
  id: string;
  title: string;
  source_id: string;
  url: string;
  category: string;
  score_before: number;
  score_after: number;
  /** Place among everything that passes with the list on, 1 first. */
  rank_after: number;
}

export interface AuthorityReplay {
  /** Distinct items in the pools. */
  items: number;
  /** Items with a cached judgment, the only ones that can be scored. */
  judged: number;
  /** Judged items whose host is on the list. */
  authority_items: number;
  passed_before: number;
  passed_after: number;
  newly_passing: NewlyPassing[];
  /** Per list domain, over judged items. */
  domains: Record<string, DomainReplay>;
  /** Domains over AUTHORITY_PASS_GUARD with at least AUTHORITY_GUARD_MIN judged items. */
  over_guard: string[];
}

/**
 * The cache is keyed `item:questions_hash:model` and may hold one item several times (a pinned
 * model and an alias, an older question set). The entry a run would use now wins; else the most
 * recently judged one, ties broken by key so the choice never depends on file order.
 */
export function entryByItem(judgments: JudgmentsFile): Map<string, JudgmentEntry> {
  const best = new Map<string, JudgmentEntry>();
  const current = (entry: JudgmentEntry): boolean =>
    entry.questions_hash === QUESTIONS_HASH && entry.model === DEFAULT_JEV_MODEL;
  const newer = (a: JudgmentEntry, b: JudgmentEntry): boolean =>
    current(a) !== current(b)
      ? current(a)
      : a.judged_at !== b.judged_at
        ? a.judged_at > b.judged_at
        : `${a.questions_hash}:${a.model}` > `${b.questions_hash}:${b.model}`;
  for (const entry of Object.values(judgments.entries)) {
    const held = best.get(entry.item_id);
    if (!held || newer(entry, held)) best.set(entry.item_id, entry);
  }
  return best;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Score a set of judged pools with and without the owner's list, as the write stage would, from
 * the cached judgments alone: no model call, no network. The list is read as if enabled, so the
 * owner can see its effect before switching it on. What the prefilter would have let into a pool
 * because of the list (a vetted page that matched no keyword) is not replayed: the pools hold only
 * what the old prefilter kept.
 */
export function replayAuthority(input: {
  pools: readonly Item[];
  judgments: JudgmentsFile;
  preferences: Preferences;
  authority: AuthorityFile;
}): AuthorityReplay {
  const matcher = authorityMatcher({ ...input.authority, enabled: true });
  const byId = new Map(input.pools.map((item) => [item.id, item]));
  const entries = entryByItem(input.judgments);
  const rows: {
    item: Item;
    category: string;
    before: number;
    after: number;
    passBefore: boolean;
    passAfter: boolean;
    listed: boolean;
  }[] = [];
  for (const item of byId.values()) {
    const entry = entries.get(item.id);
    if (!entry) continue;
    const base = scoreItem(entry, input.preferences, item);
    const lifted = withAuthority(base, matcher);
    rows.push({
      item,
      category: base.topCategory,
      before: base.score,
      after: lifted.score,
      passBefore: eligibility(base).eligible,
      passAfter: eligibility(lifted).eligible,
      listed: isAuthority(matcher, item),
    });
  }

  const passing = rows.filter((row) => row.passAfter).sort((a, b) => b.after - a.after);
  const rank = new Map(passing.map((row, index) => [row.item.id, index + 1]));
  const domains: Record<string, DomainReplay> = {};
  for (const entry of input.authority.entries) {
    const domain = entry.domain;
    const own = rows.filter((row) => {
      const host = hostOf(row.item.url);
      return host === domain || host.endsWith(`.${domain}`);
    });
    const passedAfter = own.filter((row) => row.passAfter).length;
    domains[domain] = {
      judged: own.length,
      passed_before: own.filter((row) => row.passBefore).length,
      passed_after: passedAfter,
      share_after: own.length === 0 ? 0 : Math.round((passedAfter / own.length) * 1000) / 1000,
    };
  }
  return {
    items: byId.size,
    judged: rows.length,
    authority_items: rows.filter((row) => row.listed).length,
    passed_before: rows.filter((row) => row.passBefore).length,
    passed_after: passing.length,
    newly_passing: rows
      .filter((row) => row.passAfter && !row.passBefore)
      .sort((a, b) => b.after - a.after)
      .map((row) => ({
        id: row.item.id,
        title: row.item.title,
        source_id: row.item.source_id,
        url: row.item.url,
        category: row.category,
        score_before: row.before,
        score_after: row.after,
        rank_after: rank.get(row.item.id) ?? 0,
      })),
    domains,
    over_guard: Object.entries(domains)
      .filter(
        ([, d]) =>
          d.judged >= AUTHORITY_GUARD_MIN && d.passed_after / d.judged > AUTHORITY_PASS_GUARD,
      )
      .map(([domain]) => domain),
  };
}
