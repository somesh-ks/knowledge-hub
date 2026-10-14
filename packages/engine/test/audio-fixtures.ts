import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Digest, DigestItem, Section } from "@dispatch/core";
import { digestRelPath, loadEnv, serializeDigestFile } from "@dispatch/core";
import type {
  MarksSynthesis,
  SpeechMark,
  SpeechSynthesizer,
  SynthesisRequest,
} from "../src/audio/speechify.js";
import type { SpokenText } from "../src/audio/spokenText.js";
import type { CommandContext, Logger } from "../src/context.js";
import type { BlobClient, BlobListItem, BlobPutOptions } from "../src/publish/blob.js";

/** Unwrap a value the test knows is present, failing with a clear message instead of using `!`. */
export function must<T>(value: T | undefined | null, what = "value"): T {
  if (value === undefined || value === null) throw new Error(`Expected ${what} to be present`);
  return value;
}

export const FAKE_SPEECHIFY_KEY = "test-speechify-key-8f3a9c1e";
export const FAKE_BLOB_TOKEN = "test-blob-token-5b07d2aa";

const SECTION_CYCLE: Section[] = ["top", "top", "ui-craft", "ui-craft", "ai", "research"];

/**
 * A story in the four-beat voice: a headline and a three-sentence summary, no why line. `makeItem`
 * below keeps the older shape, which both digests committed before the change still have.
 */
export function makeStory(index: number, overrides: Partial<DigestItem> = {}): DigestItem {
  const { why: _why, ...story } = makeItem(index);
  return {
    ...story,
    summary: `Story ${index + 1} ships a new drawer with a spring that keeps its velocity. It costs 120 lines of plain code and runs on every phone the team tested. The catch is that older browsers still need a fallback.`,
    ...overrides,
  };
}

export function makeItem(index: number, overrides: Partial<DigestItem> = {}): DigestItem {
  const id = (index + 1).toString(16).padStart(12, "0");
  return {
    id,
    section: SECTION_CYCLE[index % SECTION_CYCLE.length] ?? "top",
    category: "design_engineering_craft",
    source_type: "rss",
    headline: `Headline number ${index + 1}`,
    url: `https://example.com/post-${index + 1}`,
    source: "Example Blog",
    summary: `Summary of item ${index + 1} in one sentence. A second short sentence follows.`,
    why: `Copy the pattern from item ${index + 1}`,
    score: 0.9,
    ...overrides,
  };
}

export function makeDigest(overrides: Partial<Digest> = {}, itemCount = 5): Digest {
  return {
    id: "2026-10-07",
    date: "2026-10-07",
    kind: "regular",
    verified: true,
    generated_at: "2026-10-07T05:13:00Z",
    window: { from: "2026-10-05T05:13:00Z", to: "2026-10-07T05:13:00Z" },
    read_minutes: 3,
    listen_minutes: 4,
    audio: null,
    cover: { template: "spring", palette: "dusk", seed: 4117 },
    items: Array.from({ length: itemCount }, (_, index) => makeItem(index)),
    ...overrides,
  };
}

/** A digest for another day, with the id and date kept in step. */
export function digestFor(id: string, itemCount = 5): Digest {
  return makeDigest({ id, date: id.slice(0, 10) }, itemCount);
}

export interface WordMarkOptions {
  /** Silence before the first word, in milliseconds. */
  leadingMs?: number;
  wordMs?: number;
  /** Drop the mark for words where this returns true. */
  skip?: (word: string, index: number, start: number) => boolean;
}

/** One word mark per whitespace-separated word of the spoken text, evenly spaced in time. */
export function wordMarks(text: string, options: WordMarkOptions = {}): SpeechMark[] {
  const leadingMs = options.leadingMs ?? 125;
  const wordMs = options.wordMs ?? 300;
  const marks: SpeechMark[] = [];
  let index = 0;
  for (const match of text.matchAll(/\S+/g)) {
    const start = match.index ?? 0;
    const value = match[0];
    if (!options.skip?.(value, index, start)) {
      marks.push({
        type: "word",
        start,
        end: start + value.length,
        start_time: leadingMs + index * wordMs,
        end_time: leadingMs + (index + 1) * wordMs,
        value,
      });
    }
    index++;
  }
  return marks;
}

export function wordCount(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

/** Index of the first word of `value` at or after `offset`, in the order wordMarks numbers them. */
export function wordIndexAt(text: string, offset: number): number {
  return wordCount(text.slice(0, offset));
}

export function spokenFor(text: string, ranges: SpokenText["ranges"] = []): SpokenText {
  return { text, ranges, sectionStarts: [] };
}

export interface FakeSpeech extends SpeechSynthesizer {
  calls: { marks: SynthesisRequest[]; plain: SynthesisRequest[] };
}

export interface FakeSpeechOptions {
  /** Throw for the Nth marks call (0-based) by returning an error. */
  failMarksCall?: (callIndex: number) => Error | undefined;
  failPlain?: Error;
  /** Replace the marks the fake returns; defaults to one per word. */
  marksFor?: (request: SynthesisRequest) => SpeechMark[];
  durationMs?: (request: SynthesisRequest) => number;
  billable?: (request: SynthesisRequest) => number;
}

/** A synthesizer that never touches the network: audio is the text as bytes, marks are per word. */
export function makeFakeSpeech(options: FakeSpeechOptions = {}): FakeSpeech {
  const calls: FakeSpeech["calls"] = { marks: [], plain: [] };
  const duration = (request: SynthesisRequest): number =>
    options.durationMs?.(request) ?? wordCount(request.text) * 300 + 1000;
  const billable = (request: SynthesisRequest): number =>
    options.billable?.(request) ?? request.text.length;
  return {
    calls,
    async synthesizeWithMarks(request) {
      const index = calls.marks.length;
      calls.marks.push(request);
      const failure = options.failMarksCall?.(index);
      if (failure) throw failure;
      const result: MarksSynthesis = {
        audio: new TextEncoder().encode(`mp3:${request.text.length}`),
        marks: options.marksFor ? options.marksFor(request) : wordMarks(request.text),
        durationMs: duration(request),
        billableCharacters: billable(request),
      };
      return result;
    },
    async synthesize(request) {
      calls.plain.push(request);
      if (options.failPlain) throw options.failPlain;
      return {
        audio: new TextEncoder().encode(`plain:${request.text.length}`),
        durationMs: duration(request),
        billableCharacters: billable(request),
      };
    },
  };
}

export interface FakeBlob extends BlobClient {
  store: Map<string, { body: Uint8Array; options: BlobPutOptions; uploadedAt: Date }>;
  puts: string[];
  deletes: string[][];
  /** Fail the next N put calls. */
  failNextPuts: number;
  failList: Error | undefined;
  /** Seed an existing blob with a chosen upload time. */
  seed(pathname: string, uploadedAt: Date): void;
}

export function makeFakeBlob(pageSize = 1000): FakeBlob {
  const blob: FakeBlob = {
    store: new Map(),
    puts: [],
    deletes: [],
    failNextPuts: 0,
    failList: undefined,
    seed(pathname, uploadedAt) {
      blob.store.set(pathname, {
        body: new Uint8Array([1]),
        options: { contentType: "audio/mpeg", cacheControlMaxAge: 60 },
        uploadedAt,
      });
    },
    async put(pathname, body, options) {
      blob.puts.push(pathname);
      if (blob.failNextPuts > 0) {
        blob.failNextPuts--;
        throw new Error("blob store unavailable");
      }
      blob.store.set(pathname, { body, options, uploadedAt: new Date() });
      return { url: `https://store.public.blob.vercel-storage.com/${pathname}`, pathname };
    },
    async del(pathnames) {
      blob.deletes.push([...pathnames]);
      for (const pathname of pathnames) blob.store.delete(pathname);
    },
    async list(options) {
      if (blob.failList) throw blob.failList;
      const all: BlobListItem[] = [...blob.store.entries()]
        .filter(([pathname]) => pathname.startsWith(options.prefix))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([pathname, value]) => ({
          pathname,
          url: `https://store.public.blob.vercel-storage.com/${pathname}`,
          uploadedAt: value.uploadedAt,
          size: value.body.byteLength,
        }));
      const offset = options.cursor ? Number(options.cursor) : 0;
      const blobs = all.slice(offset, offset + pageSize);
      const next = offset + pageSize;
      return next < all.length
        ? { blobs, cursor: String(next), hasMore: true }
        : { blobs, hasMore: false };
    },
  };
  return blob;
}

export interface TestLogger extends Logger {
  lines: { level: string; message: string }[];
}

export function makeLogger(): TestLogger {
  const lines: TestLogger["lines"] = [];
  const push = (level: string) => (message: string) => {
    lines.push({ level, message });
  };
  return {
    lines,
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
  };
}

export interface TempRoot {
  root: string;
  cleanup(): Promise<void>;
}

export async function makeTempRoot(prefix = "dispatch-audio-"): Promise<TempRoot> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  return { root, cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) };
}

export async function writeRepoFile(root: string, rel: string, content: string): Promise<void> {
  const path = join(root, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

export async function writeDigest(root: string, digest: Digest): Promise<void> {
  await writeRepoFile(root, digestRelPath(digest.id), serializeDigestFile(digest));
}

export interface TestContext extends CommandContext {
  log: TestLogger;
}

export function makeContext(
  root: string,
  overrides: Partial<Omit<CommandContext, "log">> = {},
): TestContext {
  return {
    root,
    env: loadEnv({ SPEECHIFY_API_KEY: FAKE_SPEECHIFY_KEY, BLOB_READ_WRITE_TOKEN: FAKE_BLOB_TOKEN }),
    log: makeLogger(),
    json: false,
    now: () => new Date("2026-10-07T06:00:00Z"),
    ...overrides,
  };
}
