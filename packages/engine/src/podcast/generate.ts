import type { Episode, PodcastRequest } from "@dispatch/core";
import type { Logger } from "../context.js";
import { createHttpClient, type HttpClient } from "../http.js";
import { allocateEpisodeId, buildEpisode, writeEpisodeFile } from "./episode.js";
import { selectGeneralStories } from "./general.js";
import { planPodcast } from "./plan.js";
import { generateScript, type ScriptResult } from "./script.js";
import { selectStories } from "./select.js";
import type { PodcastStory, ScriptWriter } from "./types.js";

export interface GenerateInput {
  root: string;
  request: PodcastRequest;
  now: Date;
  /** Built after the cheap checks pass, so a missing key never hides a request or selection error. */
  makeWriter: () => ScriptWriter;
  /** Reads the news feeds of a general episode. Defaults to the engine's HTTP client. */
  http?: HttpClient;
  log?: Logger;
}

export interface GenerateResult {
  episode: Episode;
  relPath: string;
  matched: number;
  digests: number;
  /** Chosen topics that had no story in the window; the episode is built from the others. */
  empty_topics: string[];
  /** Feed reads of a general episode; absent for a briefing-based one. */
  feeds?: { ok: number; failed: number };
  script: Omit<ScriptResult, "turns">;
}

interface Selected {
  stories: PodcastStory[];
  matched: number;
  digests: number;
  empty_topics: string[];
  feeds?: { ok: number; failed: number };
}

/** A general request reads news feeds; any other reads published briefings, exactly as before. */
async function select(
  input: GenerateInput,
  budget: ReturnType<typeof planPodcast>,
): Promise<Selected> {
  if (input.request.audience === "general") {
    const general = await selectGeneralStories({
      root: input.root,
      plan: budget,
      now: input.now,
      http: input.http ?? createHttpClient(),
      log: input.log,
    });
    return {
      stories: general.stories,
      matched: general.matched,
      digests: 0,
      empty_topics: general.empty_topics,
      feeds: { ok: general.feeds_ok, failed: general.feeds_failed },
    };
  }
  const selection = await selectStories(input.root, budget, input.now, input.log);
  return {
    stories: selection.stories,
    matched: selection.matched,
    digests: selection.digests,
    empty_topics: selection.empty_topics,
  };
}

/** Plan, select, script, check and write one episode file. It does not commit. */
export async function generateEpisode(input: GenerateInput): Promise<GenerateResult> {
  const plan = planPodcast(input.request);
  const selection = await select(input, plan);
  input.log?.info("Selected stories", {
    stories: selection.stories.length,
    matched: selection.matched,
    budget_chars: plan.budget_chars,
    ...(selection.empty_topics.length > 0 ? { empty_topics: selection.empty_topics } : {}),
  });
  const { turns, ...script } = await generateScript({
    writer: input.makeWriter(),
    request: input.request,
    stories: selection.stories,
    budget_chars: plan.budget_chars,
    ...(input.log ? { log: input.log } : {}),
  });
  const id = await allocateEpisodeId(input.root, input.now);
  const episode = await buildEpisode({
    root: input.root,
    id,
    now: input.now,
    request: input.request,
    stories: selection.stories,
    turns,
  });
  const { relPath } = await writeEpisodeFile(input.root, episode);
  return {
    episode,
    relPath,
    matched: selection.matched,
    digests: selection.digests,
    empty_topics: selection.empty_topics,
    ...(selection.feeds ? { feeds: selection.feeds } : {}),
    script,
  };
}
