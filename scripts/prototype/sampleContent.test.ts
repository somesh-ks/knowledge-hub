import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ARCHIVE,
  buildTimeline,
  clockHtml,
  formatClock,
  groupArchive,
  ITEMS,
  longDate,
  wordCount,
} from "./sampleContent.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function voiceLists(): { words: string[]; patterns: RegExp[] } {
  const text = readFileSync(resolve(ROOT, "config/voice.md"), "utf8");
  const section = (title: string): string[] => {
    const start = text.indexOf(`## ${title}`);
    const rest = text.slice(start + title.length + 3);
    const end = rest.search(/\n## /);
    return (end === -1 ? rest : rest.slice(0, end))
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim());
  };
  return {
    words: section("Banned words"),
    patterns: section("Banned patterns").map((pattern) => new RegExp(pattern, "i")),
  };
}

const sentences = (text: string): number => text.split(/(?<=[.])\s+/).filter(Boolean).length;

describe("sample content follows config/voice.md", () => {
  const { words, patterns } = voiceLists();

  it("loads the banned lists", () => {
    expect(words.length).toBeGreaterThan(20);
    expect(patterns.length).toBeGreaterThan(3);
  });

  it.each(ITEMS)("keeps $id within the limits", (item) => {
    expect(wordCount(item.headline)).toBeLessThanOrEqual(12);
    expect(wordCount(item.summary)).toBeLessThanOrEqual(35);
    expect(sentences(item.summary)).toBeLessThanOrEqual(2);
    expect(wordCount(item.why)).toBeLessThanOrEqual(18);
    expect(sentences(item.why)).toBe(1);
  });

  it.each(ITEMS)("avoids banned words and patterns in $id", (item) => {
    const fields = [item.headline, item.summary, item.why];
    for (const field of fields) {
      for (const word of words) expect(field.toLowerCase(), word).not.toContain(word.toLowerCase());
      for (const pattern of patterns) expect(field, String(pattern)).not.toMatch(pattern);
    }
  });

  it("has unique 12-hex ids across the six sections in order", () => {
    expect(new Set(ITEMS.map((item) => item.id)).size).toBe(ITEMS.length);
    for (const item of ITEMS) expect(item.id).toMatch(/^[0-9a-f]{12}$/);
    expect([...new Set(ITEMS.map((item) => item.section))]).toEqual([
      "top",
      "ui-craft",
      "ai",
      "research",
      "launches",
      "watch",
    ]);
    expect(ITEMS.length).toBeLessThanOrEqual(12);
  });
});

describe("timeline", () => {
  const timeline = buildTimeline();

  it("starts at zero, never overlaps and ends at the duration", () => {
    expect(timeline.items[0]?.startSec).toBe(0);
    timeline.items.forEach((item, index) => {
      expect(item.endSec).toBeGreaterThan(item.startSec);
      const next = timeline.items[index + 1];
      if (next) expect(next.startSec).toBeCloseTo(item.endSec, 6);
    });
    expect(timeline.items.at(-1)?.endSec).toBeCloseTo(timeline.durationSec, 0);
  });

  it("lists each section once, starting at its first item", () => {
    expect(timeline.sections).toHaveLength(6);
    for (const section of timeline.sections) {
      expect(timeline.items[section.firstIndex]?.section).toBe(section.slug);
    }
  });

  it("lands near the build plan's four minutes of listening", () => {
    expect(timeline.durationSec).toBeGreaterThan(150);
    expect(timeline.durationSec).toBeLessThan(300);
  });
});

describe("dates, clocks and archive", () => {
  it("formats the voice's date form", () => {
    expect(longDate("2026-10-07")).toBe("Wednesday 7 October");
    expect(longDate("2026-10-04-weekly")).toBe("Sunday 4 October");
  });

  it("formats clocks", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(212)).toBe("3:32");
    expect(clockHtml(65)).toBe('1<span class="colon">:</span>05');
  });

  it("groups the archive by year then month, newest first", () => {
    const years = groupArchive();
    expect(years.map((year) => year.year)).toEqual(["2026", "2025"]);
    expect(years[0]?.months.map((month) => month.label)).toEqual([
      "October",
      "September",
      "August",
    ]);
    expect(years.flatMap((year) => year.months).flatMap((month) => month.entries)).toHaveLength(
      ARCHIVE.length,
    );
    expect(
      ARCHIVE.filter((entry) => entry.kind === "weekly").every((entry) =>
        entry.id.endsWith("-weekly"),
      ),
    ).toBe(true);
  });
});

describe("house rules for authored files", () => {
  // Built from code points so this file does not contain the characters it forbids.
  const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

  const roots = [
    "docs/design",
    "scripts",
    "packages/sound/src",
    "apps/web/src/styles",
    "tokens",
    "docs/prototype/sound-lab.html",
    "docs/prototype/ui-prototype.html",
  ];

  function files(path: string): string[] {
    const full = resolve(ROOT, path);
    const stats = statSync(full);
    if (stats.isFile()) return [full];
    return readdirSync(full).flatMap((name) => {
      if (name === "node_modules" || name === "screenshots") return [];
      return files(join(path, name));
    });
  }

  it("contains no em dashes or en dashes", () => {
    const offenders: string[] = [];
    for (const file of roots.flatMap(files)) {
      if (!/\.(ts|css|json|md|html)$/.test(file)) continue;
      // Generated pages inline fonts as base64, which cannot contain these characters.
      const text = readFileSync(file, "utf8");
      if (DASHES.test(text)) offenders.push(file.replace(ROOT, ""));
    }
    expect(offenders).toEqual([]);
  });
});
