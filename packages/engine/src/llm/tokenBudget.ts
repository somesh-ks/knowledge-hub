import { BudgetExceededError } from "./errors.js";

/** Nebius has no token-counting endpoint, so estimates use a rough characters-per-token ratio. */
export const CHARS_PER_TOKEN = 3.5;

export function estimateTokensForChars(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function estimateTokens(text: string): number {
  return estimateTokensForChars(text.length);
}

/**
 * Run-wide spend guard. `check` runs before every request with a local estimate; `record`
 * runs after it with the provider's reported usage, so the estimate only gates, never bills.
 */
export class TokenBudget {
  readonly limit: number;
  private usedTokens = 0;

  constructor(limit: number) {
    this.limit = limit;
  }

  get used(): number {
    return this.usedTokens;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.usedTokens);
  }

  /** Throws BudgetExceededError when the next request is expected to pass the limit. */
  check(estimate: number): void {
    if (this.usedTokens + estimate > this.limit) {
      throw new BudgetExceededError(this.limit, this.usedTokens, estimate);
    }
  }

  record(tokens: number): void {
    this.usedTokens += Math.max(0, Math.round(tokens));
  }
}
