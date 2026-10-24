import type { Category } from "@dispatch/core";
import type { Taste } from "../profile/tasteNote.js";
import type { VoiceField } from "../voice/lint.js";

/** One finalist and the text it is written from. `text` is untrusted web content. */
export interface SourceMaterial {
  id: string;
  title: string;
  source: string;
  author?: string;
  category: Category;
  text: string;
  /** The owner's prompt for the block this story airs in (D177); absent for the built-in one. */
  prompt?: string;
}

export interface WrittenItem {
  id: string;
  headline: string;
  /** A few words naming the story for the player bar; absent when the writer gave none that fit. */
  chapter?: string | undefined;
  summary: string;
  /** The story as a host would tell it aloud. Narration only; absent when it failed a check. */
  spoken?: string | undefined;
  /** The writer no longer produces one. Present only when an agent session supplied it. */
  why?: string | undefined;
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
 * Writes headlines and four-beat summaries in the house voice from source text only. The model
 * has no tools; a batch that fails reports its items instead of throwing, except for the spend
 * guard, whose BudgetExceededError always propagates.
 */
export interface Writer {
  /** `feedback` is the owner's note on what to improve; it shapes wording and emphasis, never facts. */
  /**
   * `airing` names the headlines the episode already carries beyond `items` (a refill's
   * replacements join written stories), so the writer sees the episode's other headlines.
   */
  write(
    items: readonly SourceMaterial[],
    feedback?: string,
    taste?: Taste,
    airing?: readonly string[],
  ): Promise<WriteResult>;
  /** Rewrite one field to fix the listed problems. Null when the model could not. */
  rewrite(request: RewriteRequest): Promise<string | null>;
}
