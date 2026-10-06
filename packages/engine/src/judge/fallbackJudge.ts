import type { Item, JudgmentEntry } from "@dispatch/core";
import type { Logger } from "../context.js";
import type { Judge } from "./types.js";

/**
 * Runs the primary judge, then hands any item it could not answer (Jev rate limited or down) to
 * the fallback judge. Cache keys follow the primary, so fallback answers are re-judged by the
 * primary on the next run instead of being treated as final.
 */
export class FallbackJudge implements Judge {
  readonly name = "fallback";
  private readonly primary: Judge;
  private readonly fallback: Judge;
  private readonly log: Logger | undefined;

  constructor(primary: Judge, fallback: Judge, log?: Logger) {
    this.primary = primary;
    this.fallback = fallback;
    this.log = log;
  }

  get model(): string {
    return this.primary.model;
  }

  get questionsHash(): string {
    return this.primary.questionsHash;
  }

  async judge(items: Item[]): Promise<JudgmentEntry[]> {
    const primaryEntries = await this.primary.judge(items);
    const answered = new Set(primaryEntries.map((entry) => entry.item_id));
    const missing = items.filter((item) => !answered.has(item.id));
    if (missing.length === 0) return primaryEntries;

    this.log?.warn("Using the fallback judge; its probabilities are coarser than Jev's", {
      primary: this.primary.name,
      fallback: this.fallback.name,
      items: missing.length,
    });
    const fallbackEntries = await this.fallback.judge(missing);
    const byId = new Map<string, JudgmentEntry>();
    for (const entry of [...primaryEntries, ...fallbackEntries]) byId.set(entry.item_id, entry);
    return items
      .map((item) => byId.get(item.id))
      .filter((e): e is JudgmentEntry => e !== undefined);
  }
}
