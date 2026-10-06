import type { Category } from "@dispatch/core";
import type { VoiceField } from "../voice/lint.js";

/** One finalist and the text it is written from. `text` is untrusted web content. */
export interface SourceMaterial {
  id: string;
  title: string;
  source: string;
  author?: string;
  category: Category;
  text: string;
}

export interface WrittenItem {
  id: string;
  headline: string;
  summary: string;
  why: string;
}

export interface WriteFailure {
  id: string;
  reason: string;
}

export interface WriteResult {
  written: WrittenItem[];
  failed: WriteFailure[];
}

export interface RewriteRequest {
  material: SourceMaterial;
  field: VoiceField;
  current: string;
  /** What is wrong with `current`, in plain language. Written by our code, so it is trusted. */
  problems: readonly string[];
  /**
   * Passages of `current` the problems point at, quoted from it. They were produced from
   * untrusted source text, so the prompt delimits them as data and never mixes them into `problems`.
   */
  focus?: readonly string[];
}

/**
 * Writes headline, summary and why lines in the house voice from source text only. The model
 * has no tools; a batch that fails reports its items instead of throwing, except for the spend
 * guard, whose BudgetExceededError always propagates.
 */
export interface Writer {
  write(items: readonly SourceMaterial[]): Promise<WriteResult>;
  /** Rewrite one field to fix the listed problems. Null when the model could not. */
  rewrite(request: RewriteRequest): Promise<string | null>;
}
