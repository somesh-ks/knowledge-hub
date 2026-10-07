import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Digest, digestRelPath, parseDigestFile, type Source } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { validateDigest } from "../src/validate/validateDigest.js";
import { buildFixtureDigest, LEGACY_SUMMARY, LEGACY_WHY } from "./render-factories.js";
import { REPO_ROOT } from "./score-factories.js";
import { testLinter } from "./write-fakes.js";

const linter = testLinter();

const codes = (
  digest: unknown,
  pool?: Parameters<typeof validateDigest>[1]["pool"],
  sources?: Source[],
) => validateDigest(digest, { pool, sources, linter }).issues.map((i) => `${i.severity}:${i.code}`);

/** A deep copy that tests can mutate into a broken digest. */
const clone = (digest: Digest): Digest => structuredClone(digest);

describe("validateDigest", () => {
  it("accepts a clean digest with its pool", () => {
    const { digest, fixture } = buildFixtureDigest(8);
    const report = validateDigest(digest, { pool: fixture.items, linter });
    expect(report).toMatchObject({ ok: true, errors: 0, warnings: 0, issues: [] });
  });

  it("reports schema errors with their paths and stops", () => {
    const { digest } = buildFixtureDigest(5);
    const broken: Record<string, unknown> = { ...digest, kind: "daily", items: [] };
    const report = validateDigest(broken, { linter });
    expect(report.ok).toBe(false);
    expect(report.issues.every((i) => i.code === "schema")).toBe(true);
    expect(report.issues.map((i) => i.message).join(" ")).toContain("kind");
  });

  it("rejects a URL that is not in the pool", () => {
    const { digest, fixture } = buildFixtureDigest(5);
    const bad = clone(digest);
    (bad.items[0] as { url: string }).url = "https://invented.example.com/post";
    expect(codes(bad, fixture.items)).toContain("error:url_not_in_pool");
  });

  it("accepts a URL that matches the pool's original url as well as its canonical one", () => {
    const { digest, fixture } = buildFixtureDigest(4);
    const pool = fixture.items.map((i) => ({ ...i, url: `${i.canonical_url}?utm_source=x` }));
    const swapped = clone(digest);
    swapped.items.forEach((item, i) => {
      item.url = pool.find((p) => p.id === item.id)?.url ?? item.url;
      expect(i).toBeGreaterThanOrEqual(0);
    });
    expect(codes(swapped, pool)).not.toContain("error:url_not_in_pool");
  });

  it("skips the pool checks when no pool is given", () => {
    const { digest } = buildFixtureDigest(5);
    expect(codes(digest)).toEqual([]);
  });

  it("flags an id or source type that disagrees with the pool", () => {
    const { digest, fixture } = buildFixtureDigest(5);
    const bad = clone(digest);
    (bad.items[0] as { id: string }).id = "ffffffffffff";
    (bad.items[1] as { source_type: string }).source_type = "github";
    const found = codes(bad, fixture.items);
    expect(found).toContain("error:id_mismatch");
    expect(found).toContain("error:source_type_mismatch");
  });

  it("flags repeated ids and repeated URLs", () => {
    const { digest, fixture } = buildFixtureDigest(5);
    const bad = clone(digest);
    (bad.items[1] as { id: string }).id = (bad.items[0] as { id: string }).id;
    (bad.items[2] as { url: string }).url = (bad.items[0] as { url: string }).url;
    const found = codes(bad, fixture.items);
    expect(found).toContain("error:duplicate_id");
    expect(found).toContain("error:duplicate_url");
  });

  it("flags non-http URLs", () => {
    const { digest } = buildFixtureDigest(4);
    const bad = clone(digest);
    (bad.items[0] as { url: string }).url = "ftp://example.com/file";
    expect(codes(bad)).toContain("error:url_invalid");
  });

  it("caps a regular digest at 12 items but allows 13 in a weekly one", () => {
    const regular = buildFixtureDigest(13).digest;
    expect(codes(regular)).toContain("error:item_count");
    const weekly = buildFixtureDigest(13, {}, "weekly").digest;
    expect(codes(weekly)).not.toContain("error:item_count");
  });

  it("rejects a window that ends before it starts", () => {
    const { digest } = buildFixtureDigest(4);
    const bad = clone(digest);
    bad.window = { from: digest.window.to, to: digest.window.from };
    expect(codes(bad)).toContain("error:window");
  });

  it("runs the voice lint on every written field and names the item", () => {
    const { digest } = buildFixtureDigest(5);
    const bad = clone(digest);
    (bad.items[0] as { headline: string }).headline = "An incredible release!";
    (bad.items[1] as { summary: string }).summary =
      "One fact sits here. Two facts sit here. Three facts sit here. Four facts sit here. Five sentences is one more than a summary may hold.";
    (bad.items[2] as { why: string }).why = "Check out the drawers now. And toasts.";
    const report = validateDigest(bad, { linter });
    const voice = report.issues.filter((i) => i.code === "voice");
    expect(voice.map((i) => i.itemId)).toContain(bad.items[0]?.id);
    expect(voice.map((i) => i.itemId)).toContain(bad.items[1]?.id);
    expect(voice.map((i) => i.itemId)).toContain(bad.items[2]?.id);
    expect(voice.some((i) => i.message.startsWith("headline:"))).toBe(true);
    expect(voice.find((i) => i.itemId === bad.items[1]?.id)?.message).toBe(
      "summary: The summary has 5 sentences; the limit is 4.",
    );
    expect(voice.some((i) => i.message.startsWith("why:"))).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("holds a summary to the four-beat minimum when the item has no why line", () => {
    const { digest } = buildFixtureDigest(5);
    const bad = clone(digest);
    (bad.items[3] as { summary: string }).summary = LEGACY_SUMMARY;
    const report = validateDigest(bad, { linter });
    const voice = report.issues.filter((i) => i.code === "voice");
    expect(voice.map((i) => `${i.severity}:${i.itemId}:${i.message}`)).toEqual([
      `error:${bad.items[3]?.id}:summary: The summary has 13 words; it needs at least 25.`,
    ]);
    expect(report.ok).toBe(false);
  });

  it("accepts a digest written before the four-beat voice: short summaries with why lines", () => {
    const { digest } = buildFixtureDigest(5);
    const legacy = clone(digest);
    for (const item of legacy.items) {
      item.summary = LEGACY_SUMMARY;
      item.why = LEGACY_WHY;
    }
    // Reading times are recomputed, so the only thing under test is the voice check.
    const report = validateDigest(legacy, { linter });
    expect(report.issues.filter((i) => i.code === "voice")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("still holds a legacy summary to the upper limits", () => {
    const { digest } = buildFixtureDigest(5);
    const legacy = clone(digest);
    const item = legacy.items[0] as Digest["items"][number];
    item.why = LEGACY_WHY;
    item.summary =
      "One fact sits here. Two facts sit here. Three facts sit here. Four facts sit here. Five sentences is one more than a summary may hold.";
    const voice = validateDigest(legacy, { linter }).issues.filter((i) => i.code === "voice");
    expect(voice.map((i) => i.message)).toEqual([
      "summary: The summary has 5 sentences; the limit is 4.",
    ]);
  });

  it("rejects categories that never publish", () => {
    const { digest } = buildFixtureDigest(5);
    const bad = clone(digest);
    (bad.items[4] as { category: string }).category = "venture_capital_and_gossip";
    expect(codes(bad)).toContain("error:never_publish");
  });

  it("rejects a section that does not fit the category", () => {
    const { digest } = buildFixtureDigest(8);
    const bad = clone(digest);
    const target = bad.items.find((i) => i.section !== "top") as { section: string };
    target.section = target.section === "research" ? "launches" : "research";
    expect(codes(bad)).toContain("error:section_mismatch");
  });

  it("requires exactly three top picks", () => {
    const { digest } = buildFixtureDigest(8);
    const four = clone(digest);
    const extra = four.items.find((i) => i.section !== "top");
    (extra as { section: string }).section = "top";
    expect(codes(four)).toContain("error:top_size");
    const two = clone(digest);
    (two.items[0] as { section: string }).section = "ai";
    expect(codes(two)).toContain("error:top_size");
  });

  it("warns, without failing, when the minutes differ from the text", () => {
    const { digest } = buildFixtureDigest(8);
    const bad = clone(digest);
    bad.read_minutes = digest.read_minutes + 5;
    const report = validateDigest(bad, { linter });
    expect(report.ok).toBe(true);
    expect(report.warnings).toBe(1);
    expect(report.issues[0]).toMatchObject({ severity: "warning", code: "minutes" });
  });

  it("warns when the displayed source differs from the registry name", () => {
    const { digest, fixture } = buildFixtureDigest(4);
    const sources = [{ id: "source-0", name: "Registry Name" }] as Source[];
    const report = validateDigest(digest, { pool: fixture.items, sources, linter });
    expect(report.ok).toBe(true);
    expect(report.issues.some((i) => i.code === "source_name" && i.severity === "warning")).toBe(
      true,
    );
  });

  it.each(["2026-10-06", "2026-10-07"])(
    "raises no summary minimum against the committed digest %s, written in the older voice",
    (id) => {
      const text = readFileSync(join(REPO_ROOT, digestRelPath(id)), "utf8");
      const digest = parseDigestFile(text);
      const report = validateDigest(digest, { linter });
      const messages = report.issues.map((i) => i.message).join("\n");
      expect(messages).not.toMatch(/it needs at least/);
      // Every summary in these files is shorter than the four-beat minimum, so the exemption is
      // what keeps them valid.
      const short = digest.items.filter((item) =>
        linter.lint("summary", item.summary).some((v) => v.rule === "too_few_words"),
      );
      expect(short.length).toBeGreaterThan(0);
    },
  );

  it("counts errors and warnings in the summary", () => {
    const { digest } = buildFixtureDigest(5);
    const bad = clone(digest);
    bad.read_minutes += 3;
    (bad.items[0] as { headline: string }).headline = "Revolutionary springs";
    const report = validateDigest(bad, { linter });
    expect(report.errors).toBe(1);
    expect(report.warnings).toBe(1);
  });
});
