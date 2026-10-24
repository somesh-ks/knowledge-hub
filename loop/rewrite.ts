/**
 * Rewrites a replayed episode's stories with a writer prompt, so loop/eval.ts can judge the
 * writer stage (the replay alone reads each story as it was written):
 *
 *   npx tsx loop/rewrite.ts <episode dir> <out dir> [--prompt <prompt module>] [--voice <voice.md>]
 *
 * Each story's source is read again with the engine's own extractor (feed text, then the page
 * through Readability; no paid scrape), and its summary stands in when the page cannot be read, the
 * same for both prompts. Defaults are this branch's prompt and config/voice.md; CI passes main's
 * copies to get the "before" episode. Batches of four through the engine's story_writer chain.
 * Needs ANTHROPIC_API_KEY.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  type Category,
  type Item,
  isBuiltinCategory,
  loadEnv,
  loadModelRouting,
  parseDigestFile,
  serializeDigestFile,
} from "../packages/core/src/index.js";
import { extractFullText } from "../packages/engine/src/extract/extractText.js";
import { mapConcurrent } from "../packages/engine/src/llm/concurrency.js";
import { resolveFamilies } from "../packages/engine/src/llm/modelResolver.js";
import { createModelRouter } from "../packages/engine/src/llm/modelRouter.js";
import { TokenBudget } from "../packages/engine/src/llm/tokenBudget.js";
import { newBoundary } from "../packages/engine/src/llm/untrusted.js";
import { parseVoice } from "../packages/engine/src/voice/voice.js";
import { cleanField, WRITER_BATCH_SIZE } from "../packages/engine/src/write/llmWriter.js";
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
const env = loadEnv(process.env);
const routing = loadModelRouting(ROOT);
const log = { info() {}, warn() {}, error() {}, debug() {} };
const router = createModelRouter({
  routing,
  resolve: () => resolveFamilies({ routing, env, log }),
  env,
  budget: new TokenBudget(2_000_000),
  log,
});

const Output = z.object({
  items: z.array(
    z.object({ id: z.string(), headline: z.string(), summary: z.string(), spoken: z.string() }),
  ),
});

const digest = parseDigestFile(readFileSync(join(episodeDir, "episode.md"), "utf8"));
const sources = await mapConcurrent(digest.items, 8, async (item) => {
  const page = await extractFullText({
    id: item.id,
    url: item.url,
    canonical_url: item.url,
    title: item.headline,
    snippet: item.summary,
  } as Item).catch(() => null);
  return page && page.method !== "snippet" ? page.text : null;
});
const materials: SourceMaterial[] = digest.items.map((item, i) => ({
  id: item.id,
  title: item.headline,
  source: item.source,
  category: (isBuiltinCategory(item.category) ? item.category : "none") as Category,
  text: sources[i] ?? item.summary,
}));
const batches: SourceMaterial[][] = [];
for (let i = 0; i < materials.length; i += WRITER_BATCH_SIZE) {
  batches.push(materials.slice(i, i + WRITER_BATCH_SIZE));
}
const models = new Set<string>();
const written = new Map<string, { headline: string; summary: string; spoken: string }>();
await mapConcurrent(batches, 4, async (batch) => {
  const boundary = newBoundary();
  const { value, served } = await router.callModel("story_writer", {
    schema: Output,
    schemaName: "singularity_items",
    messages: [
      { role: "system", content: prompt.writerSystemPrompt(voice, boundary) },
      {
        role: "user",
        content: prompt.writerUserMessage(
          batch,
          boundary,
          undefined,
          undefined,
          materials.filter((m) => !batch.includes(m)).map((m) => m.title),
        ),
      },
    ],
    maxTokens: 800 * batch.length + 300,
    label: "writer",
  });
  models.add(served.model);
  for (const row of value.items) {
    const text = {
      headline: cleanField("headline", row.headline),
      summary: cleanField("summary", row.summary),
      spoken: cleanField("spoken", row.spoken),
    };
    // A row with an empty field is a story the model did not write: it stays out, as a missing
    // row does (an empty one failed the digest schema in #216's eval, 2026-10-22).
    if (text.headline && text.summary && text.spoken) written.set(row.id, text);
  }
});

const items = digest.items.flatMap((item) => {
  const text = written.get(item.id);
  return text ? [{ ...item, ...text }] : [];
});
mkdirSync(outDir, { recursive: true });
copyFileSync(join(episodeDir, "settings.json"), join(outDir, "settings.json"));
writeFileSync(join(outDir, "episode.md"), serializeDigestFile({ ...digest, items }));
console.log(
  `${outDir}: ${items.length} of ${digest.items.length} stories rewritten with ${[...models].join(", ")}, ${sources.filter(Boolean).length} from the page`,
);
