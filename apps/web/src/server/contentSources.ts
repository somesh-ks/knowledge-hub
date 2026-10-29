import {
  audioTimelineRelPath,
  CostFile,
  type CostRecord,
  digestRelPath,
  PriceTable,
} from "@singularity/core";
import { configStoreUrl } from "@singularity/engine/config-paths";
import { type ContentRepoDeps, loadStoreFiles } from "./contentRepo";
import { bundledCostRecords, bundledPrices } from "./costSource";
import { bundledDigestIds, bundledDigests } from "./digestSource";
import { bundledEpisodeIds, bundledEpisodes } from "./episodeSource";
import type { DigestSource, EpisodeBundle } from "./narrate";
import { bundledStateFile } from "./stateSource";

/**
 * The briefings and episodes as the API routes read them (D173): from the content repository, so
 * Play, Regenerate and Delete work on content newer than the last deploy. When the store cannot
 * answer (not configured, unreachable), a read falls back to this build's bundled copy, which is
 * what the routes read before. When it answers, it is the only answer: a deleted briefing is gone.
 *
 * The cost report reads the engine's ledger and price table the same way. The schedule, for the
 * voice Play narrates a briefing in, is read from the settings store (D149).
 */

const runtime = (): ContentRepoDeps => ({ env: process.env, fetch, now: Date.now });

/** The store's text at a repository path; undefined when the store cannot answer. */
async function storeRead(path: string, deps: ContentRepoDeps): Promise<string | null | undefined> {
  try {
    const files = await loadStoreFiles(deps);
    return files ? await files.read(path) : undefined;
  } catch (error) {
    console.error(
      `[content] store read failed, using the build's copy: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return undefined;
  }
}

/** The store's paths under a directory; undefined when the store cannot answer. */
async function storeList(directory: string, deps: ContentRepoDeps): Promise<string[] | undefined> {
  try {
    const files = await loadStoreFiles(deps);
    return files ? await files.list(directory) : undefined;
  } catch (error) {
    console.error(
      `[content] store list failed, using the build's copy: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return undefined;
  }
}

const idOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");

/** The ids of the `.md` files under a directory, newest first. */
const markdownIds = (paths: readonly string[]): string[] =>
  paths
    .filter((path) => path.endsWith(".md"))
    .map(idOf)
    .sort()
    .reverse();

/** How long an instance keeps the stored schedule: a voice edit reaches Play within this. */
export const SCHEDULE_TTL_MS = 30_000;
/** Play waits on this read, and Neon can be waking from idle. */
const SCHEDULE_TIMEOUT_MS = 2_500;

let heldSchedule: { at: number; value: Promise<unknown> } | null = null;

/** Forget the held schedule. For tests. */
export function resetStoredSchedule(): void {
  heldSchedule = null;
}

/**
 * config/schedule.json as the settings store holds it (D149), parsed: a voice saved on the Voice
 * page is in the store at once and in the build only after a deploy. Undefined when the store is
 * off, holds no schedule or does not answer in time, so the build's copy stands in.
 */
async function storedSchedule(deps: ContentRepoDeps): Promise<unknown> {
  const storeUrl = configStoreUrl(deps.env);
  if (storeUrl === null) return undefined;
  if (heldSchedule && deps.now() - heldSchedule.at < SCHEDULE_TTL_MS) return heldSchedule.value;
  const value = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("no answer in time")), SCHEDULE_TIMEOUT_MS);
      });
      const read = (deps.readStoredSchedule ?? defaultReadStoredSchedule)(storeUrl);
      const text = await Promise.race([read, late]);
      return text === null ? undefined : (JSON.parse(text) as unknown);
    } catch (error) {
      console.error(
        `[content] stored schedule unreadable, using the build's: ${error instanceof Error ? error.message : "unknown"}`,
      );
      // Not held, so the next Play asks again.
      heldSchedule = null;
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  })();
  heldSchedule = { at: deps.now(), value };
  return value;
}

const defaultReadStoredSchedule = async (storeUrl: string): Promise<string | null> => {
  // Loaded only with the store on, so the function never loads the driver while it is off.
  const { readStoredSchedule } = await import("./configStore");
  return readStoredSchedule(storeUrl, {});
};

export function contentDigests(deps: () => ContentRepoDeps = runtime): DigestSource {
  return {
    async readSchedule() {
      const stored = await storedSchedule(deps());
      return stored === undefined ? (bundledDigests.readSchedule?.() ?? null) : stored;
    },
    async readDigest(id) {
      const text = await storeRead(digestRelPath(id), deps());
      return text === undefined ? bundledDigests.readDigest(id) : text;
    },
    async readTimeline(id) {
      const text = await storeRead(audioTimelineRelPath(id), deps());
      if (text === undefined) return bundledDigests.readTimeline(id);
      if (text === null) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    },
  };
}

export function contentEpisodes(deps: () => ContentRepoDeps = runtime): EpisodeBundle {
  return {
    async readEpisode(id) {
      // An episode's folder follows when it was written, not its id, so it is found by its name.
      const paths = await storeList("Podcasts", deps());
      if (paths === undefined) return bundledEpisodes.readEpisode(id);
      const path = paths.find((candidate) => candidate.endsWith(`/${id}.md`));
      return path ? ((await storeRead(path, deps())) ?? null) : null;
    },
  };
}

/** The id of every briefing, newest first. */
export async function contentDigestIds(deps: () => ContentRepoDeps = runtime): Promise<string[]> {
  return (await contentDigestList(deps)).ids;
}

/** The id of every briefing, newest first, and whether the list is the store's (not the build's). */
export async function contentDigestList(
  deps: () => ContentRepoDeps = runtime,
): Promise<{ ids: string[]; stored: boolean }> {
  const paths = await storeList("Digests", deps());
  return paths === undefined
    ? { ids: bundledDigestIds(), stored: false }
    : { ids: markdownIds(paths), stored: true };
}

/** The id of every episode, newest first. */
export async function contentEpisodeIds(deps: () => ContentRepoDeps = runtime): Promise<string[]> {
  const paths = await storeList("Podcasts", deps());
  return paths === undefined ? bundledEpisodeIds() : markdownIds(paths);
}

/** The kind a briefing's front matter names, or null when there is no such briefing. */
export async function contentDigestKind(
  id: string,
  deps: () => ContentRepoDeps = runtime,
): Promise<string | null> {
  const text = await contentDigests(deps).readDigest(id);
  return text ? (/^kind:\s*(\S+)/m.exec(text)?.[1] ?? null) : null;
}

/** How many times a briefing was regenerated, from its front matter (D212); 0 when never or unknown. */
export async function contentDigestRegenerations(
  id: string,
  deps: () => ContentRepoDeps = runtime,
): Promise<number> {
  const text = await contentDigests(deps).readDigest(id);
  return text ? Number(/^regenerations:\s*(\d+)/m.exec(text)?.[1] ?? 0) : 0;
}

/** How many times an episode was regenerated, from its front matter (D212); 0 when never or unknown. */
export async function contentEpisodeRegenerations(
  id: string,
  deps: () => ContentRepoDeps = runtime,
): Promise<number> {
  const text = await contentEpisodes(deps).readEpisode(id);
  return text ? Number(/^regenerations:\s*(\d+)/m.exec(text)?.[1] ?? 0) : 0;
}

/** The engine's cost ledger, every month of it. */
export async function contentCostRecords(
  deps: () => ContentRepoDeps = runtime,
): Promise<CostRecord[]> {
  const paths = await storeList("state", deps());
  if (paths === undefined) return bundledCostRecords();
  const ledgers = paths.filter((path) => /\/costs-\d{4}-\d{2}\.json$/.test(path));
  const texts = await Promise.all(ledgers.map((path) => storeRead(path, deps())));
  return texts.flatMap((text) => {
    if (typeof text !== "string") return [];
    try {
      const parsed = CostFile.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data.records : [];
    } catch {
      return [];
    }
  });
}

/**
 * A state file the engine commits (state/last-run.json, state/source-health.json), as text: the
 * store's, or this build's when the store cannot answer (`stored` false). Null text: no such file.
 */
export async function contentStateFile(
  path: string,
  deps: () => ContentRepoDeps = runtime,
): Promise<{ text: string | null; stored: boolean }> {
  const text = await storeRead(path, deps());
  return text === undefined
    ? { text: bundledStateFile(path), stored: false }
    : { text, stored: true };
}

/** The price table the cost report uses, or null when there is none that parses. */
export async function contentPrices(
  deps: () => ContentRepoDeps = runtime,
): Promise<PriceTable | null> {
  const text = await storeRead("config/prices.json", deps());
  // A store synced before the table was mirrored has none yet: the build's copy stands in.
  if (text == null) return bundledPrices();
  try {
    const parsed = PriceTable.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
