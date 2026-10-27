import {
  defaultStructure,
  type Episode,
  episodeRelPath,
  isGeneralTopicId,
  normalizeTopicIds,
  type PodcastRequest,
  type StructureBlock,
  scaleStructure,
  serializeEpisodeFile,
  storedStructure,
} from "@singularity/core";
import type { Logger } from "../context.js";
import { createHttpClient, type HttpClient } from "../http.js";
import { createFileProfileStore, OWNER_ID } from "../profile/profile.js";
import { tasteHeadlines } from "../profile/votes.js";
import { loadStructureFile } from "../structure/store.js";
import {
  allocateEpisodeId,
  buildEpisode,
  pickEpisodeCover,
  topicLabel,
  writeEpisodeFile,
} from "./episode.js";
import { type GeneralSelection, selectGeneralStories } from "./general.js";
import { planPodcast } from "./plan.js";
import { discussionHostNames } from "./prompt.js";
import { generateScript, type ScriptResult } from "./script.js";
import { joinNames, type Selection, selectStories } from "./select.js";
import { type ArtifactStore, EPISODE_STAGE_IDS, type EpisodeStageId } from "./stages.js";
import type { StreamPublisher } from "./stream.js";
import { airsUnder, fitStories, type ScriptShape, shapeStories } from "./structure.js";
import { PodcastError, type PodcastStory, type ScriptTurn, type ScriptWriter } from "./types.js";

export interface GenerateInput {
  root: string;
  request: PodcastRequest;
  now: Date;
  /** Built after the cheap checks pass, so a missing key never hides a request or selection error. */
  makeWriter: () => ScriptWriter;
  /** Reads the news feeds of a general episode. Defaults to the engine's HTTP client. */
  http?: HttpClient;
  log?: Logger;
  /** Run everything but write no file; the episode Markdown comes back in `markdown`. */
  dryRun?: boolean;
  /** Regeneration: the episode being replaced and what the listener wants changed. */
  replaces?: string;
  feedback?: string;
  /** Where each finished stage is saved and looked for first; absent, every stage runs in memory. */
  store?: ArtifactStore | null;
  /** Run one stage and stop (its steps before it must have saved theirs). Absent: all of them. */
  only?: EpisodeStageId | undefined;
  /** Called as a stage starts, so a failure can name it. */
  onStage?: (stage: EpisodeStageId) => void;
  /**
   * Called once the stories are chosen and the episode id is known, before the script is written.
   * The publisher it returns is given the opening and then the whole script as they are ready.
   */
  makeStream?: (info: {
    id: string;
    request: PodcastRequest;
    stories: readonly PodcastStory[];
  }) => StreamPublisher | null;
}

export interface GenerateResult {
  episode: Episode;
  /** Where the file went, or would go in a dry run. */
  relPath: string;
  /** The episode file text; set in a dry run only. */
  markdown?: string;
  matched: number;
  digests: number;
  /** Chosen topics that had no story in the window; the episode is built from the others. */
  empty_topics: string[];
  /** Feed reads when the request has general topics; absent for a briefing-only one. */
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

/**
 * Share `max` stories between the briefing group and the general group in proportion to how many
 * topics each has, at least one each when both have topics. Pure, so a test can pin it.
 */
export function storyShares(max: number, briefing: number, general: number): [number, number] {
  if (general === 0) return [max, 0];
  if (briefing === 0) return [0, max];
  const first = Math.min(max - 1, Math.max(1, Math.round((max * briefing) / (briefing + general))));
  return [first, max - first];
}

/**
 * Merge two ranked groups into one best-first list. Each group gets its share of `max`; a group
 * that falls short hands its unused room to the other. The groups alternate, so the strongest
 * story of each leads and neither crowds the other out of the opening.
 */
export function mergeGroups<T>(
  briefing: readonly T[],
  general: readonly T[],
  max: number,
  shares: readonly [number, number],
): T[] {
  const [shareA, shareG] = shares;
  let takeA = Math.min(briefing.length, shareA);
  let takeG = Math.min(general.length, shareG);
  const spare = max - takeA - takeG;
  if (spare > 0) {
    const extraA = Math.min(briefing.length - takeA, spare);
    takeA += extraA;
    takeG += Math.min(general.length - takeG, spare - extraA);
  }
  const a = briefing.slice(0, takeA);
  const b = general.slice(0, takeG);
  const merged: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x !== undefined) merged.push(x);
    if (y !== undefined) merged.push(y);
  }
  return merged;
}

/**
 * Pick the stories. A request names briefing ids (sections of published digests) and general topic
 * ids (news feeds), under either audience. Briefing ids read the digests, general ids read the
 * feeds, and a mixed request reads both and merges them. One group finding nothing is a warning;
 * both finding nothing fails.
 */
async function select(
  input: GenerateInput,
  budget: ReturnType<typeof planPodcast>,
  blocks: readonly StructureBlock[] | null,
): Promise<Selected> {
  const topicIds = input.request.topic_ids;
  const generalIds = topicIds.filter(isGeneralTopicId);
  const briefingIds = topicIds.filter((id) => !isGeneralTopicId(id));
  const sub = (ids: string[], minStories?: number) => ({
    plan: { ...budget, request: { ...input.request, topic_ids: ids } },
    minStories,
  });
  const mixed = generalIds.length > 0 && briefingIds.length > 0;
  const fromBriefings = async (): Promise<Selection> => {
    const { plan, minStories } = sub(briefingIds, mixed ? 1 : undefined);
    return selectStories(
      input.root,
      plan,
      input.now,
      input.log,
      minStories,
      blocks ? (story) => airsUnder(blocks, story) : undefined,
    );
  };
  const fromFeeds = async (): Promise<GeneralSelection> => {
    const { plan, minStories } = sub(generalIds, mixed ? 1 : undefined);
    return selectGeneralStories({
      root: input.root,
      plan,
      now: input.now,
      http: input.http ?? createHttpClient(),
      log: input.log,
      minStories,
      // Beside briefing topics the feeds hold no opening of their own: each topic gets a slot.
      ...(mixed ? { leaders: 0 } : {}),
    });
  };
  const feedCounts = (g: GeneralSelection) => ({ ok: g.feeds_ok, failed: g.feeds_failed });

  if (!mixed) {
    if (generalIds.length > 0) {
      const general = await fromFeeds();
      return {
        stories: general.stories,
        matched: general.matched,
        digests: 0,
        empty_topics: general.empty_topics,
        feeds: feedCounts(general),
      };
    }
    const selection = await fromBriefings();
    return {
      stories: selection.stories,
      matched: selection.matched,
      digests: selection.digests,
      empty_topics: selection.empty_topics,
    };
  }

  // A group that finds nothing is not a failure while the other has stories.
  const attempt = async <T>(run: () => Promise<T>, ids: string[]): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof PodcastError)) throw error;
      input.log?.warn("No stories for some chosen topics", { topics: ids, reason: error.message });
      return null;
    }
  };
  const [briefing, general] = await Promise.all([
    attempt(fromBriefings, briefingIds),
    attempt(fromFeeds, generalIds),
  ]);
  if (!briefing && !general) {
    throw new PodcastError(
      `No stories in ${joinNames(topicIds.map(topicLabel))} in the last ${input.request.window_days} days.`,
    );
  }
  const max = Math.max(2, budget.max_stories);
  const stories = mergeGroups(
    briefing?.stories ?? [],
    general?.stories ?? [],
    max,
    storyShares(max, briefingIds.length, generalIds.length),
  );
  if (stories.length < 2) {
    throw new PodcastError(
      `Only ${stories.length} ${stories.length === 1 ? "story matches" : "stories match"} ${topicIds.join(", ")} in the last ${input.request.window_days} days; an episode needs at least 2. Try a longer window or more topics.`,
    );
  }
  const empty = new Set([
    ...(briefing ? briefing.empty_topics : briefingIds),
    ...(general ? general.empty_topics : generalIds),
  ]);
  return {
    stories,
    matched: (briefing?.matched ?? 0) + (general?.matched ?? 0),
    digests: briefing?.digests ?? 0,
    empty_topics: topicIds.filter((id) => empty.has(id)),
    ...(general ? { feeds: feedCounts(general) } : {}),
  };
}

/**
 * The request as the episode is written and stored. A discussion carries the names its script uses:
 * the request's own (a regeneration keeps the stored ones), or the neutral pair when it has none, so
 * the transcript can show who speaks. A readout or headlines has one unnamed host and carries none.
 */
export function withHostNames(request: PodcastRequest): PodcastRequest {
  const { host_names: _names, ...rest } = request;
  return request.format === "discussion"
    ? { ...rest, host_names: discussionHostNames(request) }
    : rest;
}

/**
 * The structure's shape before the stories are known, to size the episode: any deep block may
 * take the deep dives the length has room for.
 */
function planningShape(blocks: readonly StructureBlock[]): ScriptShape {
  const { shape } = shapeStories([], blocks);
  const anyDeep = blocks.some(
    (block) => (block.type === "section" || block.type === "top_picks") && block.depth === "deep",
  );
  return { ...shape, deep: anyDeep ? Array.from({ length: 99 }, (_, i) => String(i)) : [] };
}

/** What the select stage leaves for the later ones. */
export interface SelectArtifact extends Selected {
  id: string;
  budget_chars: number;
  shape: ScriptShape | null;
}

/** What the script stage leaves. */
export interface ScriptArtifact {
  turns: ScriptTurn[];
  script: Omit<ScriptResult, "turns">;
}

/** What the cover stage leaves. */
export interface CoverArtifact {
  cover: Episode["cover"];
}

export interface StageOutcome {
  /** The episode id, fixed by the select stage. */
  id: string;
  /** The stages this call ran; one a saved artifact stood in for is not listed. */
  ran: EpisodeStageId[];
  /** Milliseconds per stage, those of earlier steps of the run included. */
  durations: Record<string, number>;
  /** Set once the publish stage has run. */
  result?: GenerateResult;
}

/**
 * Plan, select, cover, script and write one episode file, one stage at a time. Each finished stage
 * is saved in `input.store` and skipped when its artifact is already there (a rerun, `resume_from`).
 * With `only`, the stages before it must have artifacts, and the call stops after it: that is how
 * each step of podcast.yml runs its own stage. It does not commit.
 */
export async function runEpisodeStages(raw: GenerateInput): Promise<StageOutcome> {
  // A stored request may name a topic that has since been renamed: `technology` reads `tech`. The
  // hosts' names are settled here too, so the writer and the episode file see the same ones.
  const input: GenerateInput = {
    ...raw,
    request: withHostNames({
      ...raw.request,
      topic_ids: normalizeTopicIds(raw.request.topic_ids),
    }),
  };
  const { store, only } = input;
  const durations: Record<string, number> = {};
  const ran: EpisodeStageId[] = [];
  if (store) Object.assign(durations, (await store.read("timings")) ?? {});

  const run = async <T>(id: EpisodeStageId, fn: () => Promise<T>, keep = true): Promise<T> => {
    const saved = keep && store ? ((await store.read(id)) as T | null) : null;
    if (saved !== null) {
      input.log?.info("Stage skipped: its saved result is used", { stage: id });
      return saved;
    }
    // The cover needs only the selection id, so a resume that lacks it makes it here.
    if (only && id !== "cover" && EPISODE_STAGE_IDS.indexOf(id) < EPISODE_STAGE_IDS.indexOf(only)) {
      throw new PodcastError(`The ${id} stage has not run, so ${only} has nothing to work from.`);
    }
    input.onStage?.(id);
    const started = Date.now();
    const value = await fn();
    durations[id] = Date.now() - started;
    ran.push(id);
    if (store) {
      if (keep) await store.write(id, value);
      await store.write("timings", durations);
    }
    return value;
  };
  const outcome = (id: string, result?: GenerateResult): StageOutcome => ({
    id,
    ran,
    durations,
    ...(result ? { result } : {}),
  });

  // The Catch up structure (D170), or null while the owner never edited it: today's shape exactly.
  // A block prompt (D182) set on the defaults runs the defaults as a structure, so it is read.
  const file = await loadStructureFile(input.root);
  const prompts = file?.prompts ?? {};
  const stored = storedStructure(file);
  // One structure serves every podcast; its counts are sized to this episode's length.
  const blocks = stored
    ? scaleStructure(stored, input.request.length_minutes)
    : Object.keys(prompts).length > 0
      ? defaultStructure("catch_up")
      : null;

  const selection = await run<SelectArtifact>("select", async () => {
    const plan = planPodcast(input.request, blocks ? planningShape(blocks) : null);
    // With a structure, a block's count caps its stories after the ranking has filled the slots, so
    // half as many again are chosen and fitStories cuts them back to the slots by rank.
    const wide = blocks
      ? { ...plan, max_stories: plan.max_stories + Math.ceil(plan.max_stories / 2) }
      : plan;
    const picked = await select(input, wide, blocks);
    const shaped = blocks ? fitStories(picked.stories, blocks, prompts, plan.max_stories) : null;
    const chosen = shaped ? { ...picked, stories: shaped.stories } : picked;
    input.log?.info("Selected stories", {
      stories: chosen.stories.length,
      matched: chosen.matched,
      budget_chars: plan.budget_chars,
      ...(chosen.empty_topics.length > 0 ? { empty_topics: chosen.empty_topics } : {}),
    });
    // The id is settled before the script, so a listener can be told what to wait for.
    return {
      ...chosen,
      id: await allocateEpisodeId(input.root, input.now),
      budget_chars: plan.budget_chars,
      shape: shaped ? shaped.shape : null,
    };
  });

  // Chosen from the id alone, in the select step itself: ready before the script is written, and it
  // never waits on the voices. The Cover art step then finds it saved (or makes it on a resume).
  const { cover } = await run<CoverArtifact>("cover", async () => ({
    cover: await pickEpisodeCover(input.root, selection.id),
  }));
  if (only === "select" || only === "cover") return outcome(selection.id);

  // The live copy of the script: made once per process, by the first stage that needs it.
  let stream: StreamPublisher | null | undefined;
  const streamFor = (): StreamPublisher | null => {
    if (stream === undefined) {
      stream = input.dryRun
        ? null
        : (input.makeStream?.({
            id: selection.id,
            request: input.request,
            stories: selection.stories,
          }) ?? null);
    }
    return stream;
  };
  const scripted = await run<ScriptArtifact>("script", async () => {
    const live = streamFor();
    const { turns, ...script } = await generateScript({
      writer: input.makeWriter(),
      request: input.request,
      stories: selection.stories,
      budget_chars: selection.budget_chars,
      ...(input.feedback ? { feedback: input.feedback } : {}),
      ...(selection.shape ? { shape: selection.shape } : {}),
      taste: tasteHeadlines((await createFileProfileStore(input.root).read(OWNER_ID)).votes),
      ...(input.log ? { log: input.log } : {}),
      ...(live ? { onOpening: (opening: readonly ScriptTurn[]) => live.opening(opening) } : {}),
    });
    // The whole script goes out now, not after the commit: the listener hears it while it is pushed.
    // Not awaited; the publisher writes in order, and a failure to write is its own to report.
    void live?.script(turns);
    return { turns, script };
  });
  if (only === "script") return outcome(selection.id);

  const result = await run(
    "publish",
    async () => {
      // A script made by an earlier step or run has not reached this process's live copy yet.
      if (stream === undefined) void streamFor()?.script(scripted.turns);
      const episode = await buildEpisode({
        root: input.root,
        id: selection.id,
        now: input.now,
        request: input.request,
        stories: selection.stories,
        turns: scripted.turns,
        cover,
        ...(input.replaces ? { replaces: input.replaces } : {}),
        ...(input.feedback ? { feedback: input.feedback } : {}),
      });
      const relPath = input.dryRun
        ? episodeRelPath(selection.id)
        : (await writeEpisodeFile(input.root, episode)).relPath;
      return {
        episode,
        relPath,
        ...(input.dryRun ? { markdown: serializeEpisodeFile(episode) } : {}),
        matched: selection.matched,
        digests: selection.digests,
        empty_topics: selection.empty_topics,
        ...(selection.feeds ? { feeds: selection.feeds } : {}),
        script: scripted.script,
      } satisfies GenerateResult;
    },
    false,
  );
  return outcome(selection.id, result);
}

/** Plan, select, script, check and write one episode file, all in this process. It does not commit. */
export async function generateEpisode(raw: GenerateInput): Promise<GenerateResult> {
  const { result } = await runEpisodeStages({ ...raw, only: undefined });
  if (!result) throw new PodcastError("The episode was not written.");
  return result;
}
