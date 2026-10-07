import { join } from "node:path";
import { readDigestFiles } from "./digestFiles";
import { buildEntries, type DigestEntry } from "./digests";
import { buildEpisodeEntries, type EpisodeEntry, readEpisodeFiles } from "./episodes";
import { findRepoRoot } from "./repoRoot";
import { type LastRunSummary, readLastRun, showsNothingBanner } from "./runState";

/** Fixture digests point their audio here. It is replaced by a same-origin file at build time. */
export const FIXTURE_AUDIO_HOST = "fixtures.dispatch.invalid";
export const FIXTURE_AUDIO_PATH = "/fixtures/audio.wav";

export function usesFixtures(env: Record<string, string | undefined> = process.env): boolean {
  return env.DISPATCH_FIXTURES === "1";
}

export function rewriteFixtureAudioUrl(url: string): string {
  try {
    return new URL(url).hostname === FIXTURE_AUDIO_HOST ? FIXTURE_AUDIO_PATH : url;
  } catch {
    return url;
  }
}

export interface Site {
  /** Newest first. Empty when there are no digests, which the pages render as the empty state. */
  entries: DigestEntry[];
  /** Podcast episodes, newest first. Empty until Podcasts/ has a file. */
  episodes: EpisodeEntry[];
  lastRun: LastRunSummary;
  showNothingBanner: boolean;
  fixtures: boolean;
}

export interface LoadSiteOptions {
  root?: string;
  env?: Record<string, string | undefined>;
  warn?: (message: string) => void;
}

/**
 * Loads everything the pages need from the repository: digests from Digests/ (or the invented
 * fixtures when DISPATCH_FIXTURES=1) and the last run record. Fixtures are an explicit opt-in so a
 * production build can never show invented content.
 */
export async function loadSite(options: LoadSiteOptions = {}): Promise<Site> {
  const env = options.env ?? process.env;
  const warn = options.warn ?? ((message: string) => console.warn(`[dispatch] ${message}`));
  const root = options.root ?? findRepoRoot(process.cwd(), env);
  const fixtures = usesFixtures(env);
  const fixturesRoot = join(root, "apps", "web", "src", "fixtures");
  const digestsDir = fixtures ? join(fixturesRoot, "digests") : join(root, "Digests");

  const { sources, warnings } = await readDigestFiles(digestsDir);
  for (const message of warnings) warn(message);

  const entries = buildEntries(
    sources,
    { resolveAudioUrl: fixtures ? rewriteFixtureAudioUrl : undefined },
    warn,
  );
  const podcastsDir = fixtures ? join(fixturesRoot, "podcasts") : join(root, "Podcasts");
  const episodeFiles = await readEpisodeFiles(podcastsDir);
  for (const message of episodeFiles.warnings) warn(message);
  const episodes = buildEpisodeEntries(episodeFiles.episodes);
  const lastRun = await readLastRun(fixtures ? fixturesRoot : root);
  const latest = entries[0];
  return {
    entries,
    episodes,
    lastRun,
    showNothingBanner: showsNothingBanner(lastRun, latest?.digest.generated_at ?? null),
    fixtures,
  };
}

let cached: Promise<Site> | undefined;

/** One load per build, shared by every page and endpoint. */
export function getSite(): Promise<Site> {
  cached ??= loadSite();
  return cached;
}
