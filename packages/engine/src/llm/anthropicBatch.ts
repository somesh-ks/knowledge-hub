import {
  ANTHROPIC_BASE,
  ANTHROPIC_HEADERS,
  type AnthropicBody,
  type ApiReply,
  type ApiRequest,
  anthropicBody,
  failure,
  readAnthropicReply,
  send,
} from "./providers.js";

/** How one entry of a batch ended. Only `succeeded` carries a reply. */
export type BatchOutcome =
  | { type: "succeeded"; reply: ApiReply }
  | { type: "errored" | "canceled" | "expired" };

export interface BatchStatus {
  /** "ended" is final: every entry has an outcome. "canceling" still has entries in flight. */
  status: "in_progress" | "canceling" | "ended";
}

/**
 * The Anthropic Message Batches API: half the price of the same requests sent one by one, answered
 * within 24 hours (in practice minutes for a request this size). REST only, like the Messages
 * client; entries carry the Messages body, so a batch entry and a live call are the same request.
 */
export interface BatchApi {
  submit(entries: ReadonlyArray<{ customId: string; request: ApiRequest }>): Promise<string>;
  status(batchId: string): Promise<BatchStatus>;
  /** The outcome of each entry of an ended batch, by custom id. */
  results(batchId: string): Promise<Map<string, BatchOutcome>>;
  /** Asks the batch to stop. Cancellation is asynchronous: poll `status` until it is "ended". */
  cancel(batchId: string): Promise<void>;
}

const CALL_TIMEOUT_MS = 60_000;

export function createAnthropicBatchApi(options: {
  apiKey: string;
  fetch?: typeof fetch;
  /** Counts each request. */
  onRequest?: () => void;
}): BatchApi {
  const doFetch = options.fetch ?? fetch;
  const headers = ANTHROPIC_HEADERS(options.apiKey);
  async function call(path: string, init: RequestInit, timeoutMs = CALL_TIMEOUT_MS) {
    options.onRequest?.();
    const response = await send("Anthropic", doFetch, `${ANTHROPIC_BASE}${path}`, init, timeoutMs);
    if (!response.ok) throw await failure("Anthropic", response);
    return response;
  }
  return {
    async submit(entries) {
      const response = await call("/messages/batches", {
        method: "POST",
        headers,
        body: JSON.stringify({
          requests: entries.map((entry) => ({
            custom_id: entry.customId,
            params: anthropicBody(entry.request),
          })),
        }),
      });
      const json = (await response.json()) as { id?: string };
      if (!json.id) throw new Error("Anthropic accepted a batch but sent no id");
      return json.id;
    },
    async status(batchId) {
      const response = await call(`/messages/batches/${encodeURIComponent(batchId)}`, {
        method: "GET",
        headers,
      });
      const json = (await response.json()) as { processing_status?: string };
      const status =
        json.processing_status === "ended"
          ? "ended"
          : json.processing_status === "canceling"
            ? "canceling"
            : "in_progress";
      return { status };
    },
    async results(batchId) {
      const response = await call(
        `/messages/batches/${encodeURIComponent(batchId)}/results`,
        { method: "GET", headers },
        180_000,
      );
      const outcomes = new Map<string, BatchOutcome>();
      for (const line of (await response.text()).split("\n")) {
        if (line.trim() === "") continue;
        let entry: { custom_id?: string; result?: { type?: string; message?: AnthropicBody } };
        try {
          entry = JSON.parse(line);
        } catch {
          // One unreadable line loses only its own entry, which is then written live.
          continue;
        }
        if (!entry.custom_id) continue;
        const type = entry.result?.type;
        if (type === "succeeded" && entry.result?.message) {
          outcomes.set(entry.custom_id, {
            type: "succeeded",
            reply: readAnthropicReply(entry.result.message),
          });
        } else {
          outcomes.set(entry.custom_id, {
            type: type === "canceled" || type === "expired" ? type : "errored",
          });
        }
      }
      return outcomes;
    },
    async cancel(batchId) {
      await call(`/messages/batches/${encodeURIComponent(batchId)}/cancel`, {
        method: "POST",
        headers,
      });
    },
  };
}
