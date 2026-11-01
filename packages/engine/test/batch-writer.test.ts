import { loadEnv, ModelRouting } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { BatchApi, BatchOutcome } from "../src/llm/anthropicBatch.js";
import { runBatch } from "../src/llm/batchRunner.js";
import { createModelRouter } from "../src/llm/modelRouter.js";
import { TokenBudget } from "../src/llm/tokenBudget.js";
import type { BatchLlm } from "../src/llm/types.js";
import { batchDeadline } from "../src/run/writeStage.js";
import { LlmWriter, WRITER_BATCH_SIZE } from "../src/write/llmWriter.js";
import type { SourceMaterial, WrittenItem } from "../src/write/types.js";
import { captureLog, FakeLlm, NO_WAIT, testVoice } from "./write-fakes.js";

/**
 * D294: a scheduled run writes its first pass through the Message Batches API, at half the price,
 * in the hours it would otherwise sit idle. What these protect: a batch that is late, cut off or
 * unreadable must never cost the run its stories or its publish time, and what a batch bills must
 * reach the ledger at the batch price.
 */

const entries = [
  {
    customId: "w0",
    request: { model: "m", messages: [], maxTokens: 1, schema: null, timeoutMs: 1 },
  },
  {
    customId: "w1",
    request: { model: "m", messages: [], maxTokens: 1, schema: null, timeoutMs: 1 },
  },
];
const ok = (text: string): BatchOutcome => ({
  type: "succeeded",
  reply: { text, stopReason: "end", inputTokens: 10, outputTokens: 5 },
});

/** A clock the fake sleep moves, so a poll loop runs in no time. */
function clock() {
  let at = 1_000_000;
  return {
    now: () => at,
    sleep: async (ms: number) => {
      at += ms;
    },
  };
}

describe("the batch wait", () => {
  it("returns the entries that finished and leaves out the ones that did not", async () => {
    const { now, sleep } = clock();
    let polls = 0;
    const api: BatchApi = {
      submit: async () => "b1",
      status: async () => ({ status: ++polls < 3 ? "in_progress" : "ended" }),
      results: async () =>
        new Map<string, BatchOutcome>([
          ["w0", ok("{}")],
          ["w1", { type: "expired" }],
        ]),
      cancel: async () => {},
    };
    const out = await runBatch(api, entries, { until: now() + 3_600_000, now, sleep });
    expect(out.get("w0")?.type).toBe("succeeded");
    expect(out.get("w1")?.type).toBe("expired");
    expect(polls).toBe(3);
  });

  // The 2026-10-28 plan (D209): results read before a cancelled batch has ended miss entries that
  // were still finishing, and those are billed all the same.
  it("cancels at the cutoff and reads results only after the batch has ended", async () => {
    const { now, sleep } = clock();
    const order: string[] = [];
    let cancelled = false;
    let afterCancel = 0;
    const api: BatchApi = {
      submit: async () => "b1",
      status: async () => {
        if (!cancelled) return { status: "in_progress" };
        return { status: ++afterCancel < 3 ? "canceling" : "ended" };
      },
      results: async () => {
        order.push("results");
        return new Map<string, BatchOutcome>([["w0", ok("{}")]]);
      },
      cancel: async () => {
        order.push("cancel");
        cancelled = true;
      },
    };
    const out = await runBatch(api, entries, {
      until: now() + 120_000,
      now,
      sleep,
      pollMs: 30_000,
    });
    expect(order).toEqual(["cancel", "results"]);
    expect([...out.keys()]).toEqual(["w0"]);
  });

  it("gives up with nothing, not an error, when the batch is refused or its status cannot be read", async () => {
    const { now, sleep } = clock();
    const refused: BatchApi = {
      submit: async () => {
        throw new Error("400");
      },
      status: async () => ({ status: "ended" }),
      results: async () => new Map(),
      cancel: async () => {},
    };
    expect((await runBatch(refused, entries, { until: now() + 1, now, sleep })).size).toBe(0);
    const unreadable: BatchApi = {
      ...refused,
      submit: async () => "b1",
      status: async () => {
        throw new Error("503");
      },
    };
    const out = await runBatch(unreadable, entries, { until: now() + 3_600_000, now, sleep });
    expect(out.size).toBe(0);
  });

  // A batch left running after the wait gave up is billed and then written again live.
  it("cancels the batch when it gives up on reading its status", async () => {
    const { now, sleep } = clock();
    let cancels = 0;
    const api: BatchApi = {
      submit: async () => "b1",
      status: async () => {
        throw new Error("503");
      },
      results: async () => new Map(),
      cancel: async () => {
        cancels += 1;
      },
    };
    await runBatch(api, entries, { until: now() + 3_600_000, now, sleep });
    expect(cancels).toBe(1);
  });

  // A later pass of one run starts after the first pass waited to the cutoff: nothing to submit.
  it("does not submit a batch once the cutoff has passed", async () => {
    const { now, sleep } = clock();
    let submits = 0;
    const api: BatchApi = {
      submit: async () => {
        submits += 1;
        return "b1";
      },
      status: async () => ({ status: "ended" }),
      results: async () => new Map(),
      cancel: async () => {},
    };
    const out = await runBatch(api, entries, { until: now() - 1, now, sleep });
    expect(out.size).toBe(0);
    expect(submits).toBe(0);
  });
});

describe("when a run waits for a batch", () => {
  const plan = { mode: "scheduled" as const, dry_run: false };
  const at = new Date("2026-11-01T05:07:00Z");
  it("waits until 15 minutes before the publish time", () => {
    expect(batchDeadline({ ...plan, publish_at: "2026-11-01T06:57:00Z" }, at)).toBe(
      Date.parse("2026-11-01T06:42:00Z"),
    );
  });
  // A reader is waiting on a Catch up or a Regenerate, and a late scheduled run publishes at once.
  it("does not wait for anything but a scheduled run with time to spare", () => {
    const publish_at = "2026-11-01T06:57:00Z";
    expect(batchDeadline({ ...plan, mode: "on-demand", publish_at }, at)).toBeUndefined();
    expect(batchDeadline({ ...plan, dry_run: true, publish_at }, at)).toBeUndefined();
    expect(batchDeadline(plan, at)).toBeUndefined();
    expect(batchDeadline({ ...plan, publish_at: "2026-11-01T05:20:00Z" }, at)).toBeUndefined();
  });
});

let n = 0;
const material = (): SourceMaterial => {
  n += 1;
  return {
    id: n.toString(16).padStart(12, "0"),
    title: `Springlet ${n}`,
    source: "Example Blog",
    category: "css_canvas_motion_techniques",
    text: "Springlet 2.0 retargets springs mid-flight.",
  };
};
const good = (id: string): WrittenItem => ({
  id,
  headline: "Springlet 2.0 retargets springs mid-flight",
  summary:
    "Springlet 2.0 swaps the rest target without resetting velocity. Interrupted drawers keep their speed, and the change is about 120 lines of plain JavaScript. A fixed timestep keeps the motion the same on slow phones.",
});
const idsOf = (request: { messages: readonly { content: string }[] }): string[] =>
  [
    ...request.messages
      .map((m) => m.content)
      .join("\n")
      .matchAll(/id=([0-9a-f]{12}) category=/g),
  ].map((m) => m[1] as string);

describe("the writer's first pass by batch", () => {
  const items = Array.from({ length: WRITER_BATCH_SIZE + 1 }, material);

  it("writes live only the stories a batch did not bring back, and each story once", async () => {
    const live = new FakeLlm((request) => ({ items: idsOf(request).map(good) }));
    let asked = 0;
    const batch: BatchLlm = {
      completeJsonBatch: async (sent) => {
        asked = sent.length;
        const first = sent[0];
        const done = new Map();
        // Only the first batch came back; the second expired.
        if (first) {
          done.set(first.id, {
            value: first.request.schema.parse({ items: idsOf(first.request).map(good) }),
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          });
        }
        return done;
      },
    };
    const writer = new LlmWriter({ llm: live, batch, voice: testVoice(), log: captureLog().log });
    const result = await writer.write(items, undefined, undefined, [], { batchUntil: 1 });
    expect(asked).toBe(2);
    expect(live.calls).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(result.written.map((w) => w.id).sort()).toEqual(items.map((m) => m.id).sort());
  });

  // A valid reply that skips one story used to count as the whole batch done, so the run
  // published a story short.
  it("writes live a story that a valid batch reply left out", async () => {
    const live = new FakeLlm((request) => ({ items: idsOf(request).map(good) }));
    const batch: BatchLlm = {
      completeJsonBatch: async (sent) => {
        const done = new Map();
        for (const entry of sent) {
          const ids = idsOf(entry.request);
          done.set(entry.id, {
            value: entry.request.schema.parse({ items: ids.slice(1).map(good) }),
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          });
        }
        return done;
      },
    };
    const writer = new LlmWriter({ llm: live, batch, voice: testVoice(), log: captureLog().log });
    const result = await writer.write(items, undefined, undefined, [], { batchUntil: 1 });
    expect(result.failed).toEqual([]);
    expect(result.written.map((w) => w.id).sort()).toEqual(items.map((m) => m.id).sort());
  });

  it("sends nothing to a batch when the run has a reader waiting", async () => {
    const live = new FakeLlm((request) => ({ items: idsOf(request).map(good) }));
    const batch: BatchLlm = {
      completeJsonBatch: async () => {
        throw new Error("a live run must not use the batch");
      },
    };
    const writer = new LlmWriter({ llm: live, batch, voice: testVoice(), log: captureLog().log });
    const result = await writer.write(items);
    expect(result.written).toHaveLength(items.length);
  });
});

describe("the batch on the wire", () => {
  const routing = ModelRouting.parse({
    version: 1,
    families: { "claude-sonnet": { fallback_id: "claude-sonnet-5-5" } },
    steps: { story_writer: { chain: [{ family: "claude-sonnet", effort: "medium" }] } },
  });
  const Out = z.object({ ok: z.boolean() });
  const request = (label: string) => ({
    schema: Out,
    schemaName: "out",
    messages: [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: label },
    ],
    maxTokens: 800,
    label,
  });

  it("posts the Messages body of each request, bills batch tokens at the batch unit, and drops an unreadable reply", async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    const message = (text: string) => ({
      type: "message",
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
      usage: { input_tokens: 100, output_tokens: 40 },
    });
    const fetchFake: typeof fetch = async (url, init) => {
      const u = String(url);
      sent.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (u.endsWith("/messages/batches")) return Response.json({ id: "msgbatch_1" });
      if (u.endsWith("/results")) {
        const lines = [
          { custom_id: "w0", result: { type: "succeeded", message: message('{"ok":true}') } },
          { custom_id: "w1", result: { type: "succeeded", message: message("not json") } },
        ];
        // A truncated line must cost only its own entry, not the whole batch's results.
        return new Response(
          [...lines.map((l) => JSON.stringify(l)), "null", '{"custom_id":"w2","res'].join("\n"),
        );
      }
      return Response.json({ processing_status: "ended" });
    };
    const usage: Array<{ batch?: boolean; inputTokens: number; outputTokens: number }> = [];
    const router = createModelRouter({
      routing,
      resolve: async () => ({
        "claude-sonnet": { family: "claude-sonnet", id: "claude-sonnet-5-5", source: "fallback" },
      }),
      env: loadEnv({ ANTHROPIC_API_KEY: "a" }),
      budget: new TokenBudget(1_000_000),
      log: captureLog().log,
      fetch: fetchFake,
      retry: NO_WAIT,
      onUsage: (u) => usage.push(u),
      batchTiming: { now: () => 0, sleep: async () => {} },
    });
    const done = await router.batchFor("story_writer").completeJsonBatch(
      [
        { id: "a", request: request("a") },
        { id: "b", request: request("b") },
      ],
      { until: 1_000_000 },
    );
    expect([...done.keys()]).toEqual(["a"]);
    const post = sent.find((s) => s.url.endsWith("/messages/batches"))?.body as {
      requests: Array<{ custom_id: string; params: { model: string; output_config?: unknown } }>;
    };
    expect(post.requests.map((r) => r.custom_id)).toEqual(["w0", "w1"]);
    expect(post.requests[0]?.params.model).toBe("claude-sonnet-5-5");
    expect(JSON.stringify(post.requests[0]?.params.output_config)).toContain("json_schema");
    // Both replies were billed, usable or not.
    expect(usage).toHaveLength(2);
    expect(usage.every((u) => u.batch === true)).toBe(true);
  });
});
