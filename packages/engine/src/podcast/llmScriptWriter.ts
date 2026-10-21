import { z } from "zod";
import type { Logger } from "../context.js";
import { BudgetExceededError, describeError } from "../llm/errors.js";
import { CHARS_PER_TOKEN } from "../llm/tokenBudget.js";
import type { LlmClient } from "../llm/types.js";
import { newBoundary } from "../llm/untrusted.js";
import {
  OPENING_INSTRUCTION,
  rewriteSystemPrompt,
  rewriteUserMessage,
  scriptSystemPrompt,
  scriptUserMessage,
} from "./prompt.js";
import type { ScriptInput, ScriptWriter, TurnRewrite } from "./types.js";

const REWRITE_MAX_TOKENS = 400;
/** Per-turn JSON overhead and the model's own slack, on top of the speech itself. */
const SCRIPT_TOKEN_OVERHEAD = 600;
const SCRIPT_TOKEN_SLACK = 1.6;
const OPENING_MAX_TOKENS = 700;

/** What the model is asked for. Looser than the final turn: script.ts applies the format rules. */
export const ScriptReply = z.object({
  turns: z.array(
    z.object({
      speaker: z.enum(["a", "b"]),
      text: z.string(),
      item_id: z.string().nullish(),
    }),
  ),
});
export type ScriptReply = z.infer<typeof ScriptReply>;

const RewriteReply = z.object({ text: z.string() });

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
        { role: "system", content: scriptSystemPrompt(input, boundary) },
        { role: "user", content: scriptUserMessage(input, boundary, problems) },
      ],
      step: "podcast_script",
      maxTokens,
      label: "podcast_script",
      ...(input.deadline_at === undefined ? {} : { deadlineAt: input.deadline_at }),
    });
    // The opening was written first and shown already: the whole script starts with it.
    return input.opening?.length ? { turns: [...input.opening, ...value.turns] } : value;
  }

  async writeOpening(input: ScriptInput): Promise<unknown> {
    const boundary = newBoundary();
    const { value } = await this.options.llm.completeJson({
      schema: ScriptReply,
      schemaName: "singularity_opening",
      messages: [
        {
          role: "system",
          content: `${scriptSystemPrompt(input, boundary)}\n${OPENING_INSTRUCTION}`,
        },
        { role: "user", content: scriptUserMessage(input, boundary, []) },
      ],
      step: "podcast_opening",
      maxTokens: OPENING_MAX_TOKENS,
      label: "podcast_opening",
      ...(input.deadline_at === undefined ? {} : { deadlineAt: input.deadline_at }),
    });
    return value;
  }

  async rewriteTurn(input: TurnRewrite): Promise<string | null> {
    const boundary = newBoundary();
    try {
      const { value } = await this.options.llm.completeJson({
        schema: RewriteReply,
        schemaName: "singularity_rewrite",
        messages: [
          { role: "system", content: rewriteSystemPrompt(boundary) },
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
