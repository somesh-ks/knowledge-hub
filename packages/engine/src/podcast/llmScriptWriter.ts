import { z } from "zod";
import type { Logger } from "../context.js";
import { BudgetExceededError, describeError } from "../llm/errors.js";
import { CHARS_PER_TOKEN } from "../llm/tokenBudget.js";
import type { LlmClient } from "../llm/types.js";
import { newBoundary } from "../llm/untrusted.js";
import {
  rewriteSystemPrompt,
  rewriteUserMessage,
  scriptSystemPrompt,
  scriptUserMessage,
} from "./prompt.js";
import type { ScriptInput, ScriptRow, ScriptWriter, TurnRewrite } from "./types.js";

const REWRITE_MAX_TOKENS = 400;
/** Per-turn JSON overhead and the model's own slack, on top of the speech itself. */
const SCRIPT_TOKEN_OVERHEAD = 600;
const SCRIPT_TOKEN_SLACK = 1.6;

/** One turn of a reply. Looser than the final turn: script.ts applies the format rules. */
const ScriptRowShape = z.object({
  speaker: z.enum(["a", "b"]),
  text: z.string(),
  item_id: z.string().nullish(),
});

/** What the model is asked for. */
export const ScriptReply = z.object({ turns: z.array(ScriptRowShape) });
export type ScriptReply = z.infer<typeof ScriptReply>;

const RewriteReply = z.object({ text: z.string() });

function jsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Reads the turns of `{"turns":[...]}` as the reply streams: each object that closes inside the
 * array is one complete turn, handed over with the ones before it. Strings and escapes are
 * followed, so a brace or a quote inside a turn's text is never taken for structure.
 */
export function streamedTurns(
  onTurns: (rows: readonly ScriptRow[]) => void,
): (delta: string) => void {
  let text = "";
  let at = 0;
  let inString = false;
  let escaped = false;
  const open: string[] = [];
  let start = -1;
  const rows: ScriptRow[] = [];
  return (delta) => {
    text += delta;
    const before = rows.length;
    for (; at < text.length; at += 1) {
      const char = text[at];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === "{" || char === "[") {
        open.push(char);
        if (char === "{" && open.join("") === "{[{") start = at;
      } else if (char === "}" || char === "]") {
        if (char === "}" && start >= 0 && open.join("") === "{[{") {
          const row = ScriptRowShape.safeParse(jsonOrNull(text.slice(start, at + 1)));
          if (row.success) rows.push(row.data);
          start = -1;
        }
        open.pop();
      }
    }
    if (rows.length > before) onTurns(rows.slice());
  };
}

export interface LlmScriptWriterOptions {
  llm: LlmClient;
  log?: Logger;
  secrets?: readonly string[];
}

/**
 * ScriptWriter over the routed script models, in the same shape as LlmWriter: stories reach the model
 * only inside random boundary markers, the client validates the reply against a schema, and the
 * spend guard's error always propagates.
 */
export class LlmScriptWriter implements ScriptWriter {
  private readonly options: LlmScriptWriterOptions;

  constructor(options: LlmScriptWriterOptions) {
    this.options = options;
  }

  async writeScript(input: ScriptInput, problems: readonly string[]): Promise<unknown> {
    const boundary = newBoundary();
    const maxTokens =
      Math.ceil((input.budget_chars / CHARS_PER_TOKEN) * SCRIPT_TOKEN_SLACK) +
      SCRIPT_TOKEN_OVERHEAD;
    const { value } = await this.options.llm.completeJson({
      schema: ScriptReply,
      schemaName: "singularity_script",
      messages: [
        { role: "system", content: scriptSystemPrompt(input) },
        { role: "user", content: scriptUserMessage(input, boundary, problems) },
      ],
      step: "podcast_script",
      maxTokens,
      label: "podcast_script",
      ...(input.deadline_at === undefined ? {} : { deadlineAt: input.deadline_at }),
      ...(input.onTurns ? { onText: streamedTurns(input.onTurns) } : {}),
    });
    // The opening is live already: the whole script starts with it.
    return input.opening?.length ? { turns: [...input.opening, ...value.turns] } : value;
  }

  async rewriteTurn(input: TurnRewrite): Promise<string | null> {
    const boundary = newBoundary();
    try {
      const { value } = await this.options.llm.completeJson({
        schema: RewriteReply,
        schemaName: "singularity_rewrite",
        messages: [
          { role: "system", content: rewriteSystemPrompt() },
          { role: "user", content: rewriteUserMessage(input, boundary) },
        ],
        step: "podcast_rewrite",
        maxTokens: REWRITE_MAX_TOKENS,
        label: "podcast_rewrite",
      });
      const text = value.text.replace(/\s+/g, " ").trim();
      return text.length > 0 ? text : null;
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      this.options.log?.warn("The turn rewrite failed", {
        reason: describeError(error, this.options.secrets),
      });
      return null;
    }
  }
}
