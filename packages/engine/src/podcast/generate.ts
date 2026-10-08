import type { Episode, PodcastRequest } from "@dispatch/core";
import type { Logger } from "../context.js";
import { allocateEpisodeId, buildEpisode, writeEpisodeFile } from "./episode.js";
import { planPodcast } from "./plan.js";
import { generateScript, type ScriptResult } from "./script.js";
import { selectStories } from "./select.js";
import type { ScriptWriter } from "./types.js";

export interface GenerateInput {
  root: string;
  request: PodcastRequest;
  now: Date;
  /** Built after the cheap checks pass, so a missing key never hides a request or selection error. */
  makeWriter: () => ScriptWriter;
  log?: Logger;
}

export interface GenerateResult {
  episode: Episode;
  relPath: string;
  matched: number;
  digests: number;
  script: Omit<ScriptResult, "turns">;
}

/** Plan, select, script, check and write one episode file. It does not commit. */
export async function generateEpisode(input: GenerateInput): Promise<GenerateResult> {
  const plan = planPodcast(input.request);
  const selection = await selectStories(input.root, plan, input.now, input.log);
  input.log?.info("Selected stories", {
    stories: selection.stories.length,
    matched: selection.matched,
    budget_chars: plan.budget_chars,
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
  return { episode, relPath, matched: selection.matched, digests: selection.digests, script };
}
