import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COVER_TEMPLATES, Digest, parseDigestFile, serializeDigestFile } from "@dispatch/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildDigest } from "../src/render/buildDigest.js";
import { createFallbackCoverPicker, loadCoverPalettes } from "../src/render/coverPicker.js";
import { createIdAllocator, listTakenIds, nextDigestId } from "../src/render/digestId.js";
import { digestWords, listenMinutes, readMinutes } from "../src/render/readTime.js";
import { writeDigestFile } from "../src/render/writeDigestFile.js";
import {
  buildFixtureDigest,
  COVER,
  LEGACY_WHY,
  makeFixture,
  NOW,
  WINDOW,
} from "./render-factories.js";

const tempDirs: string[] = [];
async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dispatch-render-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await rm(tempDirs.pop() as string, { recursive: true, force: true });
});

describe("reading and listening time", () => {
  it.each([
    [0, 1, 1],
    [1, 1, 1],
    [150, 1, 1],
    [160, 1, 2],
    [230, 1, 2],
    [231, 2, 2],
    [460, 2, 3],
    [1000, 5, 7],
  ])("%i words: read %i min, listen %i min", (words, read, listen) => {
    expect(readMinutes(words)).toBe(read);
    expect(listenMinutes(words)).toBe(listen);
  });

  it("counts headline, summary and why words only", () => {
    expect(digestWords([{ headline: "one two", summary: "three four five.", why: "six" }])).toBe(6);
  });

  it("counts an item without a why line by its headline and summary", () => {
    expect(digestWords([{ headline: "one two", summary: "three four five." }])).toBe(5);
    expect(digestWords([{ headline: "one two", summary: "three.", why: undefined }])).toBe(3);
  });
});

describe("buildDigest", () => {
  it("builds a digest that passes the core schema", () => {
    const { digest } = buildFixtureDigest(8);
    expect(Digest.safeParse(digest).success).toBe(true);
    expect(digest.items).toHaveLength(8);
    expect(digest.kind).toBe("regular");
    expect(digest.audio).toBeNull();
    expect(digest.verified).toBe(false);
    expect(digest.cover).toEqual(COVER);
    expect(digest.window).toEqual(WINDOW);
    expect(digest.generated_at).toBe(NOW.toISOString());
  });

  it("derives minutes from the final text", () => {
    const { digest } = buildFixtureDigest(10);
    const words = digestWords(digest.items);
    expect(digest.read_minutes).toBe(readMinutes(words));
    expect(digest.listen_minutes).toBe(listenMinutes(words));
    expect(digest.read_minutes).toBeGreaterThanOrEqual(1);
  });

  it("uses the Stockholm calendar date, not UTC", () => {
    const { digest } = buildFixtureDigest(4, { now: new Date("2026-10-06T22:30:00Z") });
    expect(digest.date).toBe("2026-10-07");
    expect(digest.id).toBe("2026-10-07");
  });

  it("asks the allocator for the id and passes it to the cover picker", () => {
    const asked: unknown[] = [];
    let pickerInput: { digestId: string; date: string; kind: string; items: number } | undefined;
    const { digest } = buildFixtureDigest(5, {
      allocateId: (input) => {
        asked.push(input);
        return "2026-10-07-2";
      },
      coverPicker: (input) => {
        pickerInput = {
          digestId: input.digestId,
          date: input.date,
          kind: input.kind,
          items: input.items.length,
        };
        return { template: "orbit", palette: "ink", seed: 7 };
      },
    });
    expect(asked).toEqual([{ date: "2026-10-07", kind: "regular" }]);
    expect(digest.id).toBe("2026-10-07-2");
    expect(pickerInput).toEqual({
      digestId: "2026-10-07-2",
      date: "2026-10-07",
      kind: "regular",
      items: 5,
    });
    expect(digest.cover).toEqual({ template: "orbit", palette: "ink", seed: 7 });
  });

  it("makes the three highest scores top picks and lists top first", () => {
    const { digest } = buildFixtureDigest(8);
    expect(digest.items.slice(0, 3).every((i) => i.section === "top")).toBe(true);
    expect(digest.items.filter((i) => i.section === "top")).toHaveLength(3);
    const topScores = digest.items.slice(0, 3).map((i) => i.score);
    const restScores = digest.items.slice(3).map((i) => i.score);
    expect(Math.min(...topScores)).toBeGreaterThanOrEqual(Math.max(...restScores));
  });

  it("keeps tech stories out of the top picks and files them after AI", () => {
    const { digest } = buildFixtureDigest(10, {}, "regular", 3);
    expect(digest.items).toHaveLength(13);
    const top = digest.items.filter((i) => i.section === "top");
    expect(top).toHaveLength(3);
    expect(top.every((i) => i.category !== "consumer_tech_releases")).toBe(true);
    const tech = digest.items.filter((i) => i.category === "consumer_tech_releases");
    expect(tech.map((i) => i.section)).toEqual(["tech", "tech", "tech"]);
    // Tech scores are the highest in the fixture, and still none of them leads.
    expect(Math.min(...tech.map((i) => i.score))).toBeGreaterThan(
      Math.max(...top.map((i) => i.score)),
    );
    const order = [...new Set(digest.items.map((i) => i.section))];
    expect(order).toEqual(["top", "design", "ui-craft", "ai", "tech"]);

    const text = serializeDigestFile(digest);
    const at = (title: string): number => text.indexOf(`## ${title}`);
    expect(at("AI Products")).toBeGreaterThan(0);
    expect(at("Tech Product Launches")).toBeGreaterThan(at("AI Products"));
    expect(parseDigestFile(text)).toEqual(digest);
  });

  it("recomputes the picks from the items outside tech when written text is missing", () => {
    const fixture = makeFixture(4, 2);
    const best = fixture.selected.find((s) => s.section === "top")?.item.id as string;
    const digest = buildDigest({
      selected: fixture.selected,
      written: fixture.written.filter((w) => w.id !== best),
      window: WINDOW,
      kind: "regular",
      now: NOW,
      coverPicker: () => COVER,
      allocateId: () => "2026-10-07",
      audio: null,
    });
    expect(digest.items).toHaveLength(5);
    expect(digest.items.map((i) => i.section)).toEqual(["top", "top", "top", "tech", "tech"]);
  });

  it("maps item fields: canonical url, source name, optional author and date", () => {
    const fixture = makeFixture(4);
    const digest = buildDigest({
      selected: fixture.selected,
      written: fixture.written,
      window: WINDOW,
      kind: "regular",
      now: NOW,
      coverPicker: () => COVER,
      allocateId: () => "2026-10-07",
      audio: null,
      sourceNames: { "source-0": "Source Zero" },
    });
    const first = digest.items.find((i) => i.id === fixture.items[0]?.id);
    expect(first?.url).toBe(fixture.items[0]?.canonical_url);
    expect(first?.source).toBe("Source Zero");
    expect(first?.author).toBe("Author 0");
    expect(first?.published_at).toBe(fixture.items[0]?.published_at);
    const second = digest.items.find((i) => i.id === fixture.items[1]?.id);
    expect(second?.source).toBe("source-1");
    expect(second).not.toHaveProperty("author");
    expect(second).not.toHaveProperty("published_at");
  });

  it("credits an aggregated item to the publisher of its URL, not to the aggregator", () => {
    const fixture = makeFixture(4);
    const urls = [
      "https://www.theverge.com/2026/10/6/ipad-pro",
      "https://news.example.org/post",
      "https://github.com/acme/lib/releases/tag/v2",
      "https://example.com/fixture-3",
    ];
    const types = ["exa", "hn", "rss", "lobsters"] as const;
    const selected = fixture.selected.map((sel) => {
      const i = fixture.items.findIndex((item) => item.id === sel.item.id);
      return {
        ...sel,
        item: {
          ...sel.item,
          canonical_url: urls[i] as string,
          source_type: types[i] as (typeof types)[number],
          source_id: ["exa-discovery", "hn-show", "brutalist-report", "lobsters"][i] as string,
        },
      };
    });
    const digest = buildDigest({
      selected,
      written: fixture.written,
      window: WINDOW,
      kind: "regular",
      now: NOW,
      coverPicker: () => COVER,
      allocateId: () => "2026-10-07",
      audio: null,
      sourceNames: {
        "exa-discovery": "Exa discovery",
        "hn-show": "Hacker News: Show HN",
        "brutalist-report": "Brutalist Report",
        lobsters: "Lobsters",
      },
      linkSources: new Set(["brutalist-report"]),
    });
    const sourceOf = (i: number) =>
      digest.items.find((item) => item.id === fixture.items[i]?.id)?.source;
    expect(sourceOf(0)).toBe("The Verge");
    expect(sourceOf(1)).toBe("news.example.org");
    expect(sourceOf(2)).toBe("GitHub");
    expect(sourceOf(3)).toBe("example.com");
    expect(digest.items.map((item) => item.source)).not.toContain("Exa discovery");
  });

  it("skips selected items without written text and recomputes the top picks", () => {
    const fixture = makeFixture(6);
    const best = fixture.selected[0]?.item.id as string;
    const digest = buildDigest({
      selected: fixture.selected,
      written: fixture.written.filter((w) => w.id !== best),
      window: WINDOW,
      kind: "regular",
      now: NOW,
      coverPicker: () => COVER,
      allocateId: () => "2026-10-07",
      audio: null,
    });
    expect(digest.items).toHaveLength(5);
    expect(digest.items.some((i) => i.id === best)).toBe(false);
    expect(digest.items.filter((i) => i.section === "top")).toHaveLength(3);
  });

  it("refuses to build below the floor", () => {
    const fixture = makeFixture(5);
    expect(() =>
      buildDigest({
        selected: fixture.selected,
        written: fixture.written.slice(0, 2),
        window: WINDOW,
        kind: "regular",
        now: NOW,
        coverPicker: () => COVER,
        allocateId: () => "2026-10-07",
        audio: null,
      }),
    ).toThrow(/minimum is 3/);
  });

  it("marks a digest verified only when told", () => {
    expect(buildFixtureDigest(4, { verified: true }).digest.verified).toBe(true);
  });

  it("writes no why key when the text has none, in the frontmatter or the body", () => {
    const { digest } = buildFixtureDigest(4);
    for (const item of digest.items) expect(item).not.toHaveProperty("why");
    const text = serializeDigestFile(digest);
    expect(text).not.toMatch(/^\s+why:/m);
    expect(text).not.toContain("Why:");
    expect(parseDigestFile(text)).toEqual(digest);
  });

  it("keeps a why line that the text does carry, such as one from an agent session", () => {
    const fixture = makeFixture(4);
    const withWhy = fixture.written.map((w, i) => (i === 0 ? { ...w, why: LEGACY_WHY } : w));
    const digest = buildDigest({
      selected: fixture.selected,
      written: withWhy,
      window: WINDOW,
      kind: "regular",
      now: NOW,
      coverPicker: () => COVER,
      allocateId: () => "2026-10-07",
      audio: null,
    });
    const first = digest.items.find((i) => i.id === fixture.written[0]?.id);
    expect(first?.why).toBe(LEGACY_WHY);
    expect(digest.items.filter((i) => i.why !== undefined)).toHaveLength(1);
    const text = serializeDigestFile(digest);
    expect(text.match(/^Why: /gm)).toHaveLength(1);
    expect(parseDigestFile(text)).toEqual(digest);
  });

  it("carries the spoken telling into the digest for the items that have one", () => {
    const fixture = makeFixture(4);
    const telling = "Springlet has a new release, and it keeps velocity.";
    const digest = buildDigest({
      selected: fixture.selected,
      written: fixture.written.map((w, i) => (i === 0 ? { ...w, spoken: telling } : w)),
      window: WINDOW,
      kind: "regular",
      now: NOW,
      coverPicker: () => COVER,
      allocateId: () => "2026-10-07",
      audio: null,
    });
    const spoken = digest.items.filter((i) => i.spoken !== undefined);
    expect(spoken.map((i) => i.spoken)).toEqual([telling]);
    // The telling is not read or listened to as page text, so it does not move the minutes.
    expect(digest.read_minutes).toBe(buildFixtureDigest(4).digest.read_minutes);
    expect(parseDigestFile(serializeDigestFile(digest))).toEqual(digest);
  });

  it("treats an empty why as no why", () => {
    const fixture = makeFixture(3);
    const digest = buildDigest({
      selected: fixture.selected,
      written: fixture.written.map((w) => ({ ...w, why: "" })),
      window: WINDOW,
      kind: "regular",
      now: NOW,
      coverPicker: () => COVER,
      allocateId: () => "2026-10-07",
      audio: null,
    });
    for (const item of digest.items) expect(item).not.toHaveProperty("why");
  });
});

describe("digest ids", () => {
  it("takes the date, then -2, -3 for further digests the same day", () => {
    expect(nextDigestId("2026-10-07", "regular", new Set())).toBe("2026-10-07");
    expect(nextDigestId("2026-10-07", "on-demand", new Set(["2026-10-07"]))).toBe("2026-10-07-2");
    expect(nextDigestId("2026-10-07", "on-demand", new Set(["2026-10-07", "2026-10-07-2"]))).toBe(
      "2026-10-07-3",
    );
  });

  it("gives a weekly pass the -weekly id, then falls back to a sequence number", () => {
    expect(nextDigestId("2026-10-11", "weekly", new Set(["2026-10-11"]))).toBe("2026-10-11-weekly");
    expect(nextDigestId("2026-10-11", "weekly", new Set(["2026-10-11", "2026-10-11-weekly"]))).toBe(
      "2026-10-11-2",
    );
  });

  it("starts a weekly with a numeric suffix when its own id is taken, never the plain date", () => {
    expect(nextDigestId("2026-10-11", "weekly", new Set(["2026-10-11-weekly"]))).toBe(
      "2026-10-11-2",
    );
  });

  it("uses the id the fetch reserved while it is free, then the next free one on that date", () => {
    const taken = new Set<string>();
    const allocate = createIdAllocator(taken, "2026-10-06");
    expect(allocate({ date: "2026-10-07", kind: "regular" })).toBe("2026-10-06");
    expect(allocate({ date: "2026-10-07", kind: "regular" })).toBe("2026-10-06-2");
    const weekly = createIdAllocator(new Set(["2026-10-11-weekly"]), "2026-10-11-weekly");
    expect(weekly({ date: "2026-10-12", kind: "weekly" })).toBe("2026-10-11-2");
  });

  it("ignores a reserved id that is not a valid digest id", () => {
    const allocate = createIdAllocator(new Set(), "not-an-id");
    expect(allocate({ date: "2026-10-07", kind: "regular" })).toBe("2026-10-07");
  });

  it("takes the digest date from the allocated id", () => {
    const { digest } = buildFixtureDigest(4, { allocateId: () => "2026-10-06-2" });
    expect(digest.id).toBe("2026-10-06-2");
    expect(digest.date).toBe("2026-10-06");
  });

  it("records the ids it hands out", () => {
    const allocate = createIdAllocator(new Set());
    expect(allocate({ date: "2026-10-07", kind: "regular" })).toBe("2026-10-07");
    expect(allocate({ date: "2026-10-07", kind: "regular" })).toBe("2026-10-07-2");
  });

  it("reads taken ids from the month directory", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "Digests", "2026", "10"), { recursive: true });
    await writeFile(join(root, "Digests", "2026", "10", "2026-10-07.md"), "x");
    await writeFile(join(root, "Digests", "2026", "10", "2026-10-07.audio.json"), "{}");
    await writeFile(join(root, "Digests", "2026", "10", "2026-10-11-weekly.md"), "x");
    expect(await listTakenIds(root, "2026-10-07")).toEqual(
      new Set(["2026-10-07", "2026-10-11-weekly"]),
    );
    expect(await listTakenIds(root, "2026-11-01")).toEqual(new Set());
  });
});

describe("writeDigestFile", () => {
  it("creates directories and writes a file that parses back to the same digest", async () => {
    const root = await tempRoot();
    const { digest } = buildFixtureDigest(8);
    const written = await writeDigestFile(root, digest);
    expect(written.relPath).toBe("Digests/2026/10/2026-10-07.md");
    const text = await readFile(written.path, "utf8");
    expect(text.startsWith("---\n")).toBe(true);
    expect(parseDigestFile(text)).toEqual(digest);
  });

  it("refuses to overwrite an existing digest and leaves it untouched", async () => {
    const root = await tempRoot();
    const { digest } = buildFixtureDigest(5);
    const { path } = await writeDigestFile(root, digest);
    const before = await readFile(path, "utf8");
    const other = buildFixtureDigest(6).digest;
    await expect(writeDigestFile(root, other)).rejects.toThrow(
      /already exists: Digests\/2026\/10\/2026-10-07\.md/,
    );
    expect(await readFile(path, "utf8")).toBe(before);
  });
});

describe("fallback cover picker", () => {
  const input = (id: string) => ({
    digestId: id,
    date: "2026-10-07",
    kind: "regular" as const,
    items: buildFixtureDigest(4).digest.items,
  });

  it("is deterministic and returns a valid cover", () => {
    const pick = createFallbackCoverPicker({ palettes: ["dusk", "ink", "moss"] });
    const a = pick(input("2026-10-07"));
    expect(pick(input("2026-10-07"))).toEqual(a);
    expect(COVER_TEMPLATES).toContain(a.template);
    expect(["dusk", "ink", "moss"]).toContain(a.palette);
    expect(Number.isInteger(a.seed) && a.seed >= 0).toBe(true);
  });

  it("does not repeat the previous cover", () => {
    const first = createFallbackCoverPicker({ palettes: ["dusk"] })(input("2026-10-07"));
    const next = createFallbackCoverPicker({ palettes: ["dusk"], last: first })(
      input("2026-10-07"),
    );
    expect(`${next.template}/${next.palette}`).not.toBe(`${first.template}/${first.palette}`);
  });

  it("reads palette ids from tokens/covers.json, or falls back to dusk", async () => {
    const root = await tempRoot();
    expect(await loadCoverPalettes(root)).toEqual(["dusk"]);
    await mkdir(join(root, "tokens"), { recursive: true });
    await writeFile(
      join(root, "tokens", "covers.json"),
      JSON.stringify({ $schema: "x", palettes: { ink: {}, moss: {} } }),
    );
    expect(await loadCoverPalettes(root)).toEqual(["ink", "moss"]);
    await writeFile(
      join(root, "tokens", "covers.json"),
      JSON.stringify({ $description: "d", sand: {}, sea: {} }),
    );
    expect(await loadCoverPalettes(root)).toEqual(["sand", "sea"]);
    await writeFile(join(root, "tokens", "covers.json"), "not json");
    expect(await loadCoverPalettes(root)).toEqual(["dusk"]);
  });
});
