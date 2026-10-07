import { stockholmDate, type UsageFile } from "@dispatch/core";

/**
 * The Speechify budget rules with no storage behind them. The engine keeps the count in
 * state/usage.json (budget.ts); the site's narrate function keeps it in a Blob counter. Both apply
 * these rules, so nothing here may read a file.
 */

/** Planning figure for the free plan; override with SPEECHIFY_MONTHLY_CHARS once confirmed. */
export const DEFAULT_MONTHLY_CHARS = 500_000;

/** Stop at 90 percent of the allowance so a late digest never runs into the hard cap. */
export const BUDGET_RATIO = 0.9;

/** Read SPEECHIFY_MONTHLY_CHARS. Unset or empty gives the default; anything else must be a positive integer. */
export function parseMonthlyChars(raw: string | number | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_MONTHLY_CHARS;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("SPEECHIFY_MONTHLY_CHARS must be a positive whole number");
  }
  return value;
}

/** Usage is tracked per Stockholm calendar month, YYYY-MM. */
export function usageMonth(now: Date): string {
  return stockholmDate(now).slice(0, 7);
}

export function emptyUsage(month: string): UsageFile {
  return { version: 1, speechify: { month, characters: 0 } };
}

/** Usage for `month`: a stored count from an earlier month starts over at zero. */
export function rollOver(usage: UsageFile | undefined, month: string): UsageFile {
  if (!usage || usage.speechify.month !== month) return emptyUsage(month);
  return usage;
}

export interface BudgetAllowed {
  ok: true;
  month: string;
  used: number;
  requested: number;
  limit: number;
  remaining: number;
}

/** The typed refusal a caller turns into `audio: null` plus a warning. */
export interface BudgetRefusal {
  ok: false;
  reason: "monthly_budget";
  month: string;
  used: number;
  requested: number;
  limit: number;
  monthlyChars: number;
}

export type BudgetDecision = BudgetAllowed | BudgetRefusal;

export interface BudgetCheckInput {
  usage: UsageFile;
  now: Date;
  requested: number;
  monthlyChars: number;
}

/** Allow the request while month-to-date plus the request stays at or under 90 percent of the allowance. */
export function checkBudget(input: BudgetCheckInput): BudgetDecision {
  if (!Number.isInteger(input.requested) || input.requested <= 0) {
    throw new Error("Requested character count must be a positive whole number");
  }
  const month = usageMonth(input.now);
  const used = rollOver(input.usage, month).speechify.characters;
  const limit = Math.floor(input.monthlyChars * BUDGET_RATIO);
  if (used + input.requested > limit) {
    return {
      ok: false,
      reason: "monthly_budget",
      month,
      used,
      requested: input.requested,
      limit,
      monthlyChars: input.monthlyChars,
    };
  }
  return { ok: true, month, used, requested: input.requested, limit, remaining: limit - used };
}

export function describeRefusal(refusal: BudgetRefusal): string {
  return (
    `Speechify budget for ${refusal.month}: ${refusal.used} characters used, ` +
    `${refusal.requested} requested, limit ${refusal.limit} (90 percent of ${refusal.monthlyChars})`
  );
}

/** Pure update: add characters to the month's total, rolling over first when the month changed. */
export function addUsage(usage: UsageFile, now: Date, characters: number): UsageFile {
  const month = usageMonth(now);
  const current = rollOver(usage, month);
  return {
    version: 1,
    speechify: {
      month,
      characters: current.speechify.characters + Math.max(0, Math.round(characters)),
    },
  };
}
