import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Item, type JudgmentEntry, loadEnv } from "@dispatch/core";
import type { CommandContext } from "../src/context.js";
import type { CurateDeps } from "../src/curate/pipeline.js";
import type { ExtractedText } from "../src/extract/extractText.js";
import type { Judge } from "../src/judge/types.js";
import type { Grounder } from "../src/validate/grounding.js";
import { groundedSentences } from "../src/validate/grounding.js";
import type { RewriteRequest, SourceMaterial, Writer, WrittenItem } from "../src/write/types.js";
import { type EntryOptions, FIXTURE_CONFIG, makeEntry, makeItem } from "./score-factories.js";
import { captureLog, testLinter } from "./write-fakes.js";

export const FIXED_NOW = new Date("2026-10-07T05:13:00Z");

/** A judge answering from a table. Items not in the table get "none", so they never publish. */
export class TableJudge implements Judge {
  readonly name = "table";
  readonly model = "table-model";
  readonly questionsHash = "abc123def456";
  readonly asked: string[][] = [];
  private readonly table: Map<string, EntryOptions>;
  private readonly skip: Set<string>;

  constructor(table: Map<string, EntryOptions>, skip: Set<string> = new Set()) {
    this.table = table;
    this.skip = skip;
  }

  async judge(items: Item[]): Promise<JudgmentEntry[]> {
    this.asked.push(items.map((i) => i.id));
    return items
      .filter((i) => !this.skip.has(i.id))
      .map((i) => ({
        ...makeEntry(i, { model: this.model, ...(this.table.get(i.id) ?? { category: "none" }) }),
        questions_hash: this.questionsHash,
        judged_at: FIXED_NOW.toISOString(),
      }));
  }
}

export interface PoolSpec extends EntryOptions {
  overrides?: Partial<Item>;
}

/** A pool and the judge table that scores it. */
export function makePool(specs: PoolSpec[]): { items: Item[]; table: Map<string, EntryOptions> } {
  const items: Item[] = [];
  const table = new Map<string, EntryOptions>();
  for (const spec of specs) {
    const { overrides, ...entry } = spec;
    const item = makeItem(overrides);
    items.push(item);
    table.set(item.id, entry);
  }
  return { items, table };
}

/** Specs that all score well: deep craft items in mixed categories. */
export function goodSpecs(count: number): PoolSpec[] {
  const categories = [
    "design_engineering_craft",
    "frontier_model_releases",
    "hci_empirical_research",
    "developer_tool_launches",
    "css_canvas_motion_techniques",
    "ai_ux_interaction_patterns",
  ] as const;
  return Array.from({ length: count }, (_, i) => ({
    category: categories[i % categories.length],
    p: 0.95,
    depth: 0.9 - i * 0.01,
  }));
}

/** What the writer returns: a headline and a four-beat summary in the house voice, no why line. */
export const okWritten = (m: Pick<SourceMaterial, "id" | "title">): WrittenItem => ({
  id: m.id,
  headline: `${m.title} retargets springs mid-flight`,
  summary: `${m.title} swaps the rest target without resetting velocity. Interrupted drawers keep their speed, and the change is about 120 lines of plain JavaScript. A fixed timestep keeps the motion the same on slow phones.`,
});

export interface FakeWriter extends Writer {
  materials: SourceMaterial[];
  rewrites: RewriteRequest[];
}

export function fakeWriter(
  options: {
    write?: (m: SourceMaterial) => WrittenItem | null;
    rewrite?: (r: RewriteRequest) => string | null;
  } = {},
): FakeWriter {
  const writer: FakeWriter = {
    materials: [],
    rewrites: [],
    async write(items) {
      writer.materials.push(...items);
      const written: WrittenItem[] = [];
      const failed: Array<{ id: string; reason: string }> = [];
      for (const m of items) {
        const out = (options.write ?? okWritten)(m);
        if (out) written.push(out);
        else failed.push({ id: m.id, reason: "The model returned no entry for this item." });
      }
      return { written, failed };
    },
    async rewrite(request) {
      writer.rewrites.push(request);
      return options.rewrite ? options.rewrite(request) : null;
    },
  };
  return writer;
}

/** Supports every sentence unless it contains UNSUPPORTED. */
export const keywordGrounder: Grounder = {
  threshold: 0.5,
  async ground(target) {
    return {
      id: target.id,
      sentences: groundedSentences(target).map((s) => {
        const bad = s.sentence.includes("UNSUPPORTED");
        return {
          ...s,
          score: bad ? 0.1 : 0.9,
          status: bad ? ("unsupported" as const) : ("supported" as const),
        };
      }),
    };
  },
};

export const longText = (item: Item): ExtractedText => ({
  text: `Source text for ${item.title}. `.repeat(40).trim(),
  method: "content",
  truncated: false,
});

export function makeDeps(overrides: Partial<CurateDeps> & { judge: Judge }): CurateDeps {
  return {
    writer: fakeWriter(),
    grounder: keywordGrounder,
    linter: testLinter(),
    extract: async (item) => longText(item),
    log: captureLog().log,
    now: () => FIXED_NOW,
    ...overrides,
  };
}

export interface TestRoot {
  root: string;
  cleanup: () => Promise<void>;
}

/** A temporary repository root with the real config files copied in. */
export async function makeRoot(): Promise<TestRoot> {
  const root = await mkdtemp(join(tmpdir(), "dispatch-curate-"));
  await mkdir(join(root, "config"), { recursive: true });
  await cp(join(FIXTURE_CONFIG, "voice.md"), join(root, "config", "voice.md"));
  await cp(join(FIXTURE_CONFIG, "preferences.json"), join(root, "config", "preferences.json"));
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
  };
}

export async function writeRunFile(
  root: string,
  runId: string,
  name: string,
  value: unknown,
): Promise<string> {
  const dir = join(root, ".cache", "run", runId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return path;
}

export function makeContext(
  root: string,
  extra: { env?: Record<string, string>; json?: boolean } = {},
): {
  ctx: CommandContext;
  logs: ReturnType<typeof captureLog>["lines"];
} {
  const { log, lines } = captureLog();
  return {
    logs: lines,
    ctx: {
      root,
      env: loadEnv(extra.env ?? {}),
      log,
      json: extra.json ?? true,
      now: () => FIXED_NOW,
    },
  };
}

/** Capture what a command writes to stdout. */
export async function captureStdout<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = await fn();
    return { result, stdout: chunks.join("") };
  } finally {
    process.stdout.write = original;
  }
}
