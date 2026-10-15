/**
 * Rewrites a replayed episode's stories with a writer prompt, so loop/eval.ts can judge the
 * writer stage (the replay alone reads each story as it was written):
 *
 *   npx tsx loop/rewrite.ts <episode dir> <out dir> [--prompt <prompt module>] [--voice <voice.md>]
 *
 * The pool keeps no source text, so each story's summary stands in for it, the same for both
 * prompts. Defaults are this branch's prompt and config/voice.md; CI passes main's copies to get
 * the "before" episode. Batches of four with the writer's own model, like the engine. Needs
 * ANTHROPIC_API_KEY.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  type Category,
  isBuiltinCategory,
  parseDigestFile,
  serializeDigestFile,
} from "../packages/core/src/index.js";
import { createAnthropicLlm } from "../packages/engine/src/llm/anthropicClient.js";
import { mapConcurrent } from "../packages/engine/src/llm/concurrency.js";
import { TokenBudget } from "../packages/engine/src/llm/tokenBudget.js";
import { newBoundary } from "../packages/engine/src/llm/untrusted.js";
import { parseVoice } from "../packages/engine/src/voice/voice.js";
import { cleanField, WRITER_BATCH_SIZE } from "../packages/engine/src/write/nebiusWriter.js";
import type { SourceMaterial } from "../packages/engine/src/write/types.js";

const ROOT = join(import.meta.dirname, "..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { prompt: { type: "string" }, voice: { type: "string" } },
});
const [episodeDir, outDir] = positionals;
if (!episodeDir || !outDir) throw new Error("Usage: rewrite.ts <episode dir> <out dir>");

type PromptModule = typeof import("../packages/engine/src/write/prompt.js");
const prompt = (await import(
  resolve(values.prompt ?? join(ROOT, "packages/engine/src/write/prompt.ts"))
)) as PromptModule;
const voice = parseVoice(readFileSync(values.voice ?? join(ROOT, "config/voice.md"), "utf8"));
const model = (
  JSON.parse(readFileSync(join(ROOT, "config/writer.json"), "utf8")) as { model: string }
).model;
const llm = createAnthropicLlm({ env: process.env, model, budget: new TokenBudget(2_000_000) });

const Output = z.object({
  items: z.array(
    z.object({ id: z.string(), headline: z.string(), summary: z.string(), spoken: z.string() }),
  ),
});

const digest = parseDigestFile(readFileSync(join(episodeDir, "episode.md"), "utf8"));
const materials: SourceMaterial[] = digest.items.map((item) => ({
  id: item.id,
  title: item.headline,
  source: item.source,
  category: (isBuiltinCategory(item.category) ? item.category : "none") as Category,
  text: item.summary,
}));
const batches: SourceMaterial[][] = [];
for (let i = 0; i < materials.length; i += WRITER_BATCH_SIZE) {
  batches.push(materials.slice(i, i + WRITER_BATCH_SIZE));
}
const written = new Map<string, { headline: string; summary: string; spoken: string }>();
await mapConcurrent(batches, 4, async (batch) => {
  const boundary = newBoundary();
  const { value } = await llm.completeJson({
    schema: Output,
    schemaName: "dispatch_items",
    messages: [
      { role: "system", content: prompt.writerSystemPrompt(voice, boundary) },
      { role: "user", content: prompt.writerUserMessage(batch, boundary) },
    ],
    temperature: 0.2,
    maxTokens: 800 * batch.length + 300,
    label: "writer",
  });
  for (const row of value.items) {
    written.set(row.id, {
      headline: cleanField("headline", row.headline),
      summary: cleanField("summary", row.summary),
      spoken: cleanField("spoken", row.spoken),
    });
  }
});

const items = digest.items.flatMap((item) => {
  const text = written.get(item.id);
  return text ? [{ ...item, ...text }] : [];
});
mkdirSync(outDir, { recursive: true });
copyFileSync(join(episodeDir, "settings.json"), join(outDir, "settings.json"));
writeFileSync(join(outDir, "episode.md"), serializeDigestFile({ ...digest, items }));
console.log(`${outDir}: ${items.length} of ${digest.items.length} stories rewritten with ${model}`);
