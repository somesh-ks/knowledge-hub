import type { z } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface JsonRequest<T> {
  /** Validates the model's reply. Also sent to the provider as the response schema. */
  schema: z.ZodType<T>;
  /** Model-visible name of the schema. */
  schemaName: string;
  messages: readonly ChatMessage[];
  /** Defaults to 0.2. */
  temperature?: number;
  /** Upper bound on the reply, also used for the spend estimate. */
  maxTokens?: number;
  /** Short name of the call, used in logs. */
  label: string;
}

export interface JsonResult<T> {
  value: T;
  usage: LlmUsage;
}

/**
 * A text model that answers with schema-validated JSON. It has no tools and no network access
 * of its own beyond the single request; callers pass untrusted text as delimited data.
 */
export interface LlmClient {
  /** The model id this client sends. */
  readonly model: string;
  completeJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>>;
}
