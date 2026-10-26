import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Digest, parseDigestFile, type Source, seedTopicsFile } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { buildDigest } from "../src/render/buildDigest.js";
import { validateDigest } from "../src/validate/validateDigest.js";
import { makeSource } from "./fetch-helpers.js";
import {
  buildFixtureDigest,
  COVER,
  LEGACY_SUMMARY,
  LEGACY_WHY,
  makeFixture,
  NOW,
  WINDOW,
} from "./render-factories.js";
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

  it("allows five tech stories on top of twelve items, and on top of eighteen in a weekly", () => {
    const regular = buildFixtureDigest(12, {}, "regular", 5);
    expect(regular.digest.items).toHaveLength(17);
    expect(validateDigest(regular.digest, { pool: regular.fixture.items, linter })).toMatchObject({
      ok: true,
      errors: 0,
    });
    const weekly = buildFixtureDigest(18, {}, "weekly", 5);
    expect(weekly.digest.items).toHaveLength(23);
    expect(validateDigest(weekly.digest, { pool: weekly.fixture.items, linter }).ok).toBe(true);
  });

  it("rejects a sixth tech story", () => {
    const { digest } = buildFixtureDigest(6, {}, "regular", 6);
    const report = validateDigest(digest, { linter });
    expect(report.issues.filter((i) => i.code === "item_count").map((i) => i.message)).toEqual([
      "6 Tech releases items; the limit is 5.",
    ]);
  });

  it("does not let the tech allowance raise the cap for everything else", () => {
    const { digest } = buildFixtureDigest(13, {}, "regular", 2);
    const report = validateDigest(digest, { linter });
    expect(report.issues.filter((i) => i.code === "item_count").map((i) => i.message)).toEqual([
      "13 items outside Tech releases; the limit for a regular digest is 12.",
    ]);
    // The same thirteen fit a weekly digest.
    expect(codes(buildFixtureDigest(13, {}, "weekly", 2).digest)).not.toContain("error:item_count");
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

  it("warns, without failing, about a headline shaped like a changelog line", () => {
    const { digest } = buildFixtureDigest(5);
    const changelog = clone(digest);
    (changelog.items[0] as { headline: string }).headline =
      "Springlet 2.0 released with mid-flight spring retargeting";
    const report = validateDigest(changelog, { linter });
    const voice = report.issues.filter((i) => i.code === "voice");
    expect(voice).toEqual([
      {
        severity: "warning",
        code: "voice",
        itemId: changelog.items[0]?.id,
        message:
          "headline: The headline reads like a changelog line. Say what happened and why a reader would care, with a real verb.",
      },
    ]);
    expect(report.ok).toBe(true);
    expect(report.warnings).toBe(1);
  });

  it("lints a spoken version, and rejects one that states a number the summary does not", () => {
    const { digest } = buildFixtureDigest(5);
    const target = digest.items[0];
    const withSpoken = clone(digest);
    const telling =
      "Springlet has a new release, and it keeps velocity when a drawer is interrupted. It's about 120 lines of plain JavaScript. A fixed timestep keeps the motion the same on slow phones. The catch: older browsers still need a fallback for it.";
    const summary = `${target?.summary} The change is about 120 lines.`;
    (withSpoken.items[0] as { summary: string }).summary = summary;
    (withSpoken.items[0] as { spoken: string }).spoken = telling;
    expect(
      validateDigest(withSpoken, { linter }).issues.filter((i) => i.message.startsWith("spoken")),
    ).toEqual([]);

    const invented = clone(withSpoken);
    (invented.items[0] as { spoken: string }).spoken = telling.replace("120", "900");
    const report = validateDigest(invented, { linter });
    expect(report.issues.find((i) => i.message.startsWith("spoken:"))).toMatchObject({
      severity: "error",
      code: "voice",
      itemId: target?.id,
      message: "spoken: states 900, which the headline and summary do not.",
    });
    expect(report.ok).toBe(false);

    const loud = clone(withSpoken);
    (loud.items[0] as { spoken: string }).spoken = `${telling} Ready to try it?`;
    expect(
      validateDigest(loud, { linter }).issues.some((i) =>
        i.message.startsWith("spoken: Do not ask"),
      ),
    ).toBe(true);
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
    const topics = seedTopicsFile();
    const blocked = topics.topics.find((topic) => topic.id === "venture_capital_and_gossip");
    if (!blocked) throw new Error("Missing seeded gossip topic");
    blocked.never_publish = true;
    const issues = validateDigest(bad, { linter, topics }).issues;
    expect(issues.map((i) => `${i.severity}:${i.code}`)).toContain("error:never_publish");
  });

  it("rejects a section that does not fit the category", () => {
    const { digest } = buildFixtureDigest(8);
    const bad = clone(digest);
    const target = bad.items.find((i) => i.section !== "top") as { section: string };
    target.section = target.section === "design" ? "trending" : "design";
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

  it("expects one Top pick for each item outside tech when there are fewer than three", () => {
    const { digest, fixture } = buildFixtureDigest(2, {}, "regular", 3);
    expect(digest.items.map((i) => i.section)).toEqual(["top", "top", "tech", "tech", "tech"]);
    expect(validateDigest(digest, { pool: fixture.items, linter }).ok).toBe(true);

    const one = clone(digest);
    (one.items[1] as { section: string }).section = "ai";
    const report = validateDigest(one, { linter });
    expect(report.issues.find((i) => i.code === "top_size")?.message).toBe(
      "Top picks has 1 items; it must have 2.",
    );
  });

  it("accepts a digest of tech stories alone, which has no Top picks", () => {
    const { digest, fixture } = buildFixtureDigest(0, {}, "regular", 4);
    expect(digest.items.every((i) => i.section === "tech")).toBe(true);
    expect(validateDigest(digest, { pool: fixture.items, linter })).toMatchObject({
      ok: true,
      errors: 0,
    });
  });

  it("rejects a tech story among the Top picks, even the highest-scoring one", () => {
    const { digest } = buildFixtureDigest(6, {}, "regular", 2);
    const tech = digest.items.find((i) => i.section === "tech");
    expect(tech?.score).toBe(0.99);
    expect(tech?.score).toBeGreaterThan(Math.max(...digest.items.slice(0, 3).map((i) => i.score)));
    expect(codes(digest)).toEqual([]);

    // Swapped in for a real pick: the count is right, and the story is still not allowed there.
    const swapped = clone(digest);
    (swapped.items[2] as { section: string }).section = "research";
    const promoted = swapped.items.find((i) => i.id === tech?.id) as { section: string };
    promoted.section = "top";
    const report = validateDigest(swapped, { linter });
    const mismatch = report.issues.filter((i) => i.code === "section_mismatch");
    expect(mismatch).toEqual([
      {
        severity: "error",
        code: "section_mismatch",
        message: "A Tech releases story cannot be a Top pick; it belongs in the tech section.",
        itemId: tech?.id,
      },
    ]);
    expect(report.ok).toBe(false);

    // Added as a fourth pick: both rules fire.
    const fourth = clone(digest);
    (fourth.items.find((i) => i.id === tech?.id) as { section: string }).section = "top";
    const found = codes(fourth);
    expect(found).toContain("error:section_mismatch");
    expect(found).toContain("error:top_size");
  });

  it("rejects a tech story filed under another section, and another story filed under tech", () => {
    const { digest } = buildFixtureDigest(6, {}, "regular", 2);
    const misfiled = clone(digest);
    (misfiled.items.find((i) => i.section === "tech") as { section: string }).section = "design";
    expect(codes(misfiled)).toContain("error:section_mismatch");
    const wrong = clone(digest);
    (wrong.items.find((i) => i.section === "ai") as { section: string }).section = "tech";
    expect(codes(wrong)).toContain("error:section_mismatch");
  });

  // The 2026-10-18 weekly failed validation once Software Engineering took tool launches (D155).
  it("keeps a tool launch a briefing filed under Design Engineering before it moved", () => {
    const { digest } = buildFixtureDigest(6);
    const legacy = clone(digest);
    legacy.date = "2026-10-18";
    const item = legacy.items.find((i) => i.section === "ui-craft") as {
      category: string;
      section: string;
    };
    item.category = "developer_tool_launches";
    expect(codes(legacy)).not.toContain("error:section_mismatch");
    // A briefing written since is held to the new home.
    legacy.date = "2026-10-24";
    expect(codes(legacy)).toContain("error:section_mismatch");
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
    const sources: Source[] = [makeSource({ id: "source-0", name: "Registry Name" })];
    const report = validateDigest(digest, { pool: fixture.items, sources, linter });
    expect(report.ok).toBe(true);
    expect(report.issues.some((i) => i.code === "source_name" && i.severity === "warning")).toBe(
      true,
    );
  });

  it("expects the publisher, not the registry name, for aggregated and link-list items", () => {
    const fixture = makeFixture(4);
    const pool = fixture.items.map((item, i) =>
      i === 0 ? { ...item, source_type: "exa" as const, source_id: "exa-discovery" } : item,
    );
    const selected = fixture.selected.map((sel) => ({
      ...sel,
      item: pool.find((p) => p.id === sel.item.id) ?? sel.item,
    }));
    const sources: Source[] = [
      makeSource({ id: "exa-discovery", name: "Exa discovery", type: "exa" }),
      makeSource({ id: "source-1", name: "Link List", options: { kind: "newsletter-link" } }),
      makeSource({ id: "source-2", name: "Source Two" }),
    ];
    const build = (linkSources?: Set<string>) =>
      buildDigest({
        selected,
        written: fixture.written,
        window: WINDOW,
        kind: "regular",
        now: NOW,
        coverPicker: () => COVER,
        allocateId: () => "2026-10-07",
        audio: null,
        sourceNames: Object.fromEntries(sources.map((s) => [s.id, s.name])),
        ...(linkSources ? { linkSources } : {}),
      });
    const names = (digest: Digest) =>
      Object.fromEntries(
        pool.map((p) => [p.source_id, digest.items.find((i) => i.id === p.id)?.source]),
      );

    const good = build(new Set(["source-1"]));
    expect(names(good)).toMatchObject({
      "exa-discovery": "example.com",
      "source-1": "example.com",
      "source-2": "Source Two",
    });
    const report = validateDigest(good, { pool, sources, linter });
    expect(report.issues.filter((i) => i.code === "source_name")).toEqual([]);

    // Built without knowing which sources are link lists: the registry name slips through for
    // that one, and the validator says what it expected instead.
    const stale = build();
    expect(names(stale)["source-1"]).toBe("Link List");
    const warned = validateDigest(stale, { pool, sources, linter }).issues.filter(
      (i) => i.code === "source_name",
    );
    expect(warned.map((i) => i.message)).toEqual([
      'The source "Link List" differs from the expected name "example.com".',
    ]);
  });

  it.each(["2026-10-06", "2026-10-07"])(
    "raises no summary minimum against the committed digest %s, written in the older voice",
    (id) => {
      const text = readFileSync(
        join(REPO_ROOT, "packages/engine/test/fixtures/digests", `${id}.md`),
        "utf8",
      );
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
