import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AudioTimeline,
  type Digest,
  type DigestKind,
  type LastRunFile,
  SECTIONS,
  serializeDigestFile,
} from "@dispatch/core";
import { pickCover } from "@dispatch/cover";
import { FIXTURE_ITEM_SETS, toDigestItems } from "./fixtureContent";

/**
 * Writes the three fixture digests the e2e tests and the visual review use. They are generated with
 * core's serializer so they can never drift from the real file format, and they sit under
 * apps/web/src/fixtures/. The site reads them only when DISPATCH_FIXTURES=1.
 *
 * Run: npx tsx apps/web/scripts/buildFixtures.ts
 */

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "fixtures");
const AUDIO_URL = "https://fixtures.dispatch.invalid/audio.wav";
/** Each item gets this long in the fixture audio file. The file is synthesized at build time. */
export const FIXTURE_ITEM_MS = 3000;

interface FixtureSpec {
  id: string;
  date: string;
  kind: DigestKind;
  generatedAt: string;
  windowFrom: string;
  itemSet: keyof typeof FIXTURE_ITEM_SETS;
  readMinutes: number;
  listenMinutes: number;
  withAudio: boolean;
  previous?: { template: string; palette: string };
}

const SPECS: readonly FixtureSpec[] = [
  {
    id: "2026-10-07",
    date: "2026-10-07",
    kind: "regular",
    generatedAt: "2026-10-07T05:20:00.000Z",
    windowFrom: "2026-10-05T05:10:00.000Z",
    itemSet: "today",
    readMinutes: 2,
    listenMinutes: 4,
    withAudio: true,
  },
  {
    id: "2026-10-05",
    date: "2026-10-05",
    kind: "regular",
    generatedAt: "2026-10-05T05:18:00.000Z",
    windowFrom: "2026-10-03T05:10:00.000Z",
    itemSet: "earlier",
    readMinutes: 2,
    listenMinutes: 3,
    withAudio: false,
  },
  {
    id: "2026-10-04-weekly",
    date: "2026-10-04",
    kind: "weekly",
    generatedAt: "2026-10-04T06:02:00.000Z",
    windowFrom: "2026-09-27T05:00:00.000Z",
    itemSet: "weekly",
    readMinutes: 4,
    listenMinutes: 8,
    withAudio: false,
  },
];

function buildDigest(spec: FixtureSpec): Digest {
  const items = toDigestItems(FIXTURE_ITEM_SETS[spec.itemSet], spec.generatedAt);
  const leadCategory = items[0]?.category;
  const cover = pickCover({
    id: spec.id,
    date: spec.date,
    kind: spec.kind,
    // Fixture stories only use the built-in categories, which is what the picker weighs.
    lead_category: leadCategory as Parameters<typeof pickCover>[0]["lead_category"],
    previous: spec.previous,
  });
  const durationMs = items.length * FIXTURE_ITEM_MS;
  return {
    id: spec.id,
    date: spec.date,
    kind: spec.kind,
    verified: true,
    generated_at: spec.generatedAt,
    window: { from: spec.windowFrom, to: spec.generatedAt },
    read_minutes: spec.readMinutes,
    listen_minutes: spec.listenMinutes,
    audio: spec.withAudio ? { url: AUDIO_URL, duration_ms: durationMs } : null,
    cover,
    items,
  };
}

function buildTimeline(digest: Digest): AudioTimeline {
  // Narration order is section order, then the digest's own order.
  const ordered = SECTIONS.flatMap((section) =>
    digest.items.filter((item) => item.section === section),
  );
  const items = ordered.map((item, index) => ({
    id: item.id,
    section: item.section,
    start_ms: index * FIXTURE_ITEM_MS,
    end_ms: (index + 1) * FIXTURE_ITEM_MS,
  }));
  const sections = SECTIONS.flatMap((slug) => {
    const first = items.find((item) => item.section === slug);
    return first ? [{ slug, start_ms: first.start_ms }] : [];
  });
  return {
    digest: digest.id,
    voice: "fixture",
    model: "fixture",
    timeline: "marks",
    duration_ms: items.length * FIXTURE_ITEM_MS,
    text_chars: ordered.reduce((sum, item) => sum + item.summary.length, 0),
    items,
    sections,
  };
}

rmSync(join(OUT, "digests"), { recursive: true, force: true });
for (const spec of SPECS) {
  const digest = buildDigest(spec);
  const [year, month] = spec.date.split("-");
  const directory = join(OUT, "digests", year ?? "", month ?? "");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${digest.id}.md`), serializeDigestFile(digest));
  if (spec.withAudio) {
    const timeline = buildTimeline(digest);
    writeFileSync(
      join(directory, `${digest.id}.audio.json`),
      `${JSON.stringify(timeline, null, 2)}\n`,
    );
  }
}

const lastRun: LastRunFile = {
  version: 1,
  regular: {
    at: "2026-10-07T05:20:00.000Z",
    outcome: "published",
    digest_id: "2026-10-07",
    items: 12,
  },
  weekly: {
    at: "2026-10-04T06:02:00.000Z",
    outcome: "published",
    digest_id: "2026-10-04-weekly",
    items: 14,
  },
};
mkdirSync(join(OUT, "state"), { recursive: true });
writeFileSync(join(OUT, "state", "last-run.json"), `${JSON.stringify(lastRun, null, 2)}\n`);
console.log(`Wrote ${SPECS.length} fixture digests to ${OUT}`);
