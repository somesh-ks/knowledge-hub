import { isFieldRecord as isRecord } from "@singularity/core";
import { isSameOrigin } from "./generate";
import type { ApiResult } from "./http";

/** A comment is at most this long (the sheets' maxlength). */
const MAX_COMMENT_CHARS = 500;
/** No more category names than this are passed on. */
const MAX_CATEGORIES = 30;

export interface CommentHintsAnswer {
  length: boolean;
  topics: boolean;
}

export interface CommentValuesAnswer {
  length: "shorter" | "longer" | null;
  add: string[];
}

export interface RegenHintsInput {
  bodyText: string;
  origin: string | null;
  expectedOrigin: string;
}

export interface RegenHintsDeps {
  /** Asks Jev; absent when the server has no key. Null when Jev could not answer. */
  read?: (comment: string, categories: readonly string[]) => Promise<CommentHintsAnswer | null>;
  /** The shared cap on asking Jev (D150): false once this minute's asks are spent. */
  mayRead: () => Promise<boolean>;
  /** Asks Haiku what the controls should be set to (D371); absent without a key. Null when it could not answer. */
  readValues?: (
    comment: string,
    categories: readonly string[],
  ) => Promise<CommentValuesAnswer | null>;
  /** The same cap, for Haiku. */
  mayReadValues?: () => Promise<boolean>;
}

const none = { status: 200 as const, body: { length: false, topics: false, by: "none" as const } };
const noValues = { status: 200 as const, body: { length: null, add: [], by: "none" as const } };

/**
 * Which Regenerate controls a comment calls for, as Jev reads it (D370), or with `want: "values"`
 * what Haiku would set them to (D371). The sheet has already shown what its own word match
 * found, so every failure (no key, the cap, a slow or broken model) answers "nothing more" and the
 * sheet carries on.
 */
export async function handleRegenHints(
  input: RegenHintsInput,
  deps: RegenHintsDeps,
): Promise<ApiResult<unknown>> {
  if (!isSameOrigin(input.origin, input.expectedOrigin)) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.bodyText);
  } catch {
    return { status: 400, body: { error: "invalid_request" } };
  }
  if (!isRecord(parsed)) return { status: 400, body: { error: "invalid_request" } };
  const { comment, categories } = parsed;
  if (typeof comment !== "string" || comment.trim() === "" || comment.length > MAX_COMMENT_CHARS) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const names = Array.isArray(categories)
    ? categories.filter((name): name is string => typeof name === "string").slice(0, MAX_CATEGORIES)
    : [];
  if (parsed.want === "values") {
    if (!deps.readValues || !deps.mayReadValues || !(await deps.mayReadValues())) return noValues;
    const values = await deps.readValues(comment.trim(), names);
    return values ? { status: 200, body: { ...values, by: "haiku" } } : noValues;
  }
  if (!deps.read || !(await deps.mayRead())) return none;
  const answer = await deps.read(comment.trim(), names);
  return answer ? { status: 200, body: { ...answer, by: "jev" } } : none;
}
