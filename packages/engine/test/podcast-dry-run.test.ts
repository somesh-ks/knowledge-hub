import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePodcastCommand } from "../src/commands/podcast.js";
import type { HttpClient } from "../src/http.js";
import { captureStdout, makeContext } from "./curate-helpers.js";
import { commitAll, createRepoPair, git, put, type RepoPair } from "./git-testRepo.js";
import {
  dayAgo,
  FakeScriptWriter,
  makeDigest,
  NOW,
  REQUEST,
  scriptOf,
  writeDigest,
} from "./podcast-fixtures.js";

const FIELDS = [
  "audience",
  "format",
  "length_minutes",
  "topic_ids",
  "budget_chars",
  "script_chars",
  "percent_of_budget",
  "listen_minutes",
  "turns",
  "speakers",
  "stories",
  "empty_topics",
  "writer_calls",
  "short_by_chars",
  "title",
  "problems",
];

describe("singularity podcast --dry-run", () => {
  let pair: RepoPair;
  let root: string;
  let outside: string;

  beforeEach(async () => {
    pair = await createRepoPair({ seedDigest: false });
    root = pair.a;
    outside = await mkdtemp(join(tmpdir(), "singularity-dry-"));
    for (const days of [1, 2]) {
      const when = dayAgo(days);
      await writeDigest(
        root,
        makeDigest(when.id, when.at, [{ n: days * 10 }, { n: days * 10 + 1 }]),
      );
    }
    await commitAll(root, "chore: seed digests");
  });
  afterEach(async () => {
    await pair.cleanup();
    await rm(outside, { recursive: true, force: true });
  });

  async function dry(
    request: unknown,
    extra: string[] = [],
    opts: { http?: HttpClient; writer?: FakeScriptWriter } = {},
  ): Promise<{ code: number; stdout: string; errors: string[]; writer: FakeScriptWriter }> {
    const writer = opts.writer ?? new FakeScriptWriter();
    const { ctx, logs } = makeContext(root, { json: false });
    const command = makePodcastCommand({
      makeWriter: () => writer,
      ...(opts.http ? { http: opts.http } : {}),
    });
    const argv = ["--request", JSON.stringify(request), "--now", NOW.toISOString(), "--dry-run"];
    const { result, stdout } = await captureStdout(() => command([...argv, ...extra], ctx));
    return {
      code: result,
      stdout,
      writer,
      errors: logs.filter((l) => l.level === "error").map((l) => l.message),
    };
  }

  const lastJson = (stdout: string): Record<string, unknown> =>
    JSON.parse(stdout.trimEnd().split("\n").at(-1) ?? "");

  it("writes and commits nothing, and prints the readout at 5 minutes as the last line", async () => {
    const head = git(root, "rev-parse", "HEAD");
    const { code, stdout, writer } = await dry(REQUEST);
    expect(code).toBe(0);
    expect(writer.calls).toHaveLength(1);
    expect(existsSync(join(root, "Podcasts"))).toBe(false);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);

    const out = lastJson(stdout);
    expect(Object.keys(out).sort()).toEqual([...FIELDS].sort());
    const chars = out.script_chars as number;
    expect(out).toMatchObject({
      audience: "custom",
      format: "readout",
      length_minutes: 5,
      topic_ids: ["ai"],
      budget_chars: 4840,
      percent_of_budget: Math.round((chars / 4840) * 100),
      listen_minutes: Math.max(1, Math.round(chars / 968)),
      speakers: ["a"],
      empty_topics: [],
      writer_calls: 1,
      short_by_chars: 0,
      problems: [],
    });
    expect(Number.isInteger(out.percent_of_budget)).toBe(true);
    expect(chars).toBeGreaterThanOrEqual(Math.floor(4840 * 0.8));
  });

  it("reports a discussion at 10 minutes with two speakers", async () => {
    const { code, stdout } = await dry({ ...REQUEST, length_minutes: 10, format: "discussion" });
    expect(code).toBe(0);
    const out = lastJson(stdout);
    const chars = out.script_chars as number;
    expect(out).toMatchObject({
      format: "discussion",
      length_minutes: 10,
      budget_chars: 9680,
      percent_of_budget: Math.round((chars / 9680) * 100),
      listen_minutes: Math.round(chars / 968),
      speakers: ["a", "b"],
    });
    expect(out.turns as number).toBeGreaterThan(4);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("lists the problems of the last rejected reply and counts the writer calls", async () => {
    const writer = new FakeScriptWriter((input, call) =>
      call === 0 ? { turns: [{ speaker: "a", text: "Hello." }] } : scriptOf(input),
    );
    const { stdout } = await dry(REQUEST, [], { writer });
    const out = lastJson(stdout);
    expect(out.writer_calls).toBe(2);
    expect((out.problems as string[]).join(" ")).toMatch(/too short/);
  });

  it("--save writes the Markdown outside the repository and nothing inside", async () => {
    const path = join(outside, "nested", "episode.md");
    const { code } = await dry(REQUEST, ["--save", path]);
    expect(code).toBe(0);
    const text = await readFile(path, "utf8");
    expect(text).toMatch(/^---\n/);
    expect(text).toContain("Singularity");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("refuses --save inside the repository, before calling the writer", async () => {
    const { code, errors, writer } = await dry(REQUEST, ["--save", join(root, "tmp", "ep.md")]);
    expect(code).toBe(2);
    expect(errors.join(" ")).toMatch(/outside the repository/);
    expect(writer.calls).toHaveLength(0);
    expect(existsSync(join(root, "tmp"))).toBe(false);
  });

  it("refuses --dry-run with --no-push, and --save without --dry-run", async () => {
    const both = await dry(REQUEST, ["--no-push"]);
    expect(both.code).toBe(2);
    expect(both.errors.join(" ")).toMatch(/--dry-run and --no-push/);
    const { ctx } = makeContext(root, { json: false });
    const command = makePodcastCommand({ makeWriter: () => new FakeScriptWriter() });
    const code = await command(
      ["--request", JSON.stringify(REQUEST), "--save", join(outside, "x.md")],
      ctx,
    );
    expect(code).toBe(2);
  });

  it("runs the general pipeline from feeds without writing anything", async () => {
    await put(
      root,
      "config/sources.json",
      JSON.stringify({
        version: 1,
        sources: ["world", "business"].map((t) => ({
          id: `npr-${t}`,
          name: "NPR",
          type: "rss",
          url: "https://npr.test",
          feed_url: `https://npr.test/${t}`,
          tier: "daily",
          high_signal: false,
          enabled: true,
          failures: 0,
          options: {},
          topic_ids: [t],
        })),
      }),
    );
    await commitAll(root, "chore: feeds");
    const when = new Date(NOW.getTime() - 3_600_000).toUTCString();
    const item = (title: string, link: string): string =>
      `<item><title>${title}</title><link>${link}</link><pubDate>${when}</pubDate><description>${title} in detail.</description></item>`;
    const http: HttpClient = {
      async fetchText(url) {
        const text = `<?xml version="1.0"?><rss version="2.0"><channel><title>F</title>${item("Magnitude 6.1 earthquake strikes Izmir coast", `${url}/a`)}${item("Central bank holds interest rates steady in Frankfurt", `${url}/b`)}${item("Volcano in Iceland erupts near Reykjanes town", `${url}/c`)}</channel></rss>`;
        return { url, status: 200, contentType: "text/xml", text };
      },
      async getJson() {
        throw new Error("not used");
      },
      async postJson() {
        throw new Error("not used");
      },
    };
    const { code, stdout, errors } = await dry(
      {
        topic_ids: ["world"],
        length_minutes: 5,
        format: "readout",
        window_days: 2,
        tone: "neutral",
        audience: "general",
      },
      [],
      { http },
    );
    expect(errors).toEqual([]);
    expect(code).toBe(0);
    const out = lastJson(stdout);
    expect(out).toMatchObject({ audience: "general", topic_ids: ["world"], title: "World" });
    expect(Object.keys(out)).toHaveLength(FIELDS.length);
    expect(existsSync(join(root, "Podcasts"))).toBe(false);
    expect(git(root, "status", "--porcelain")).toBe("");
  });
});
