import type { Topic, TopicsFile } from "@dispatch/core";
import type { ApiRuntime } from "../curate/apiRuntime.js";
import { readJsonIfExists } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import { GENERAL_QUESTIONS_HASH, type GeneralRequest } from "../judge/generalJudge.js";
import { topicHash } from "../judge/topicQuestions.js";
import {
  activeGeneralFrom,
  applyCeiling,
  GENERAL_JUDGE_CEILING,
  GeneralJudgedFile,
  GeneralPoolFile,
} from "./generalNews.js";
import type { PlanPass } from "./plan.js";
import { passFile } from "./plan.js";
import type { RunDeps } from "./types.js";

type Entry = GeneralJudgedFile["entries"][number];

async function readPrevious(path: string, model: string): Promise<Map<string, Entry>> {
  try {
    const parsed = GeneralJudgedFile.safeParse(await readJsonIfExists(path, "general-judged.json"));
    if (!parsed.success) return new Map();
    const { judge, entries } = parsed.data;
    if (judge.model !== model || judge.questions_hash !== GENERAL_QUESTIONS_HASH) return new Map();
    return new Map(entries.map((entry) => [entry.item_id, entry]));
  } catch {
    return new Map();
  }
}

/** True when an earlier attempt already asked this story everything this attempt would. */
function answers(entry: Entry | undefined, topics: readonly Topic[]): entry is Entry {
  return (
    entry !== undefined &&
    entry.flags !== undefined &&
    topics.every(
      (topic) => entry.fits[topic.id] !== undefined && entry.hashes[topic.id] === topicHash(topic),
    )
  );
}

/**
 * Judge every story of a pass's general news feeds (D66), written beside the pool in
 * `general-judged.json`. Each story is asked its general topics' fit questions and the two trust
 * flag questions, in one Jev request, and never the briefing's category questions. The stories are
 * not in the pool, so the write stage cannot score, select or write them: they feed a source's
 * score and, later, episodes, and nothing else. Stories over GENERAL_JUDGE_CEILING wait (the least
 * widely carried first), and answers an earlier attempt of the same pass saved are not asked again.
 *
 * Returns the report keys for the judge stage, or null when the pass has no general stories file.
 * A story Jev cannot answer is left unjudged and counts for nothing; it never fails the stage.
 */
export async function judgeGeneral(
  deps: RunDeps,
  pass: PlanPass,
  runtime: ApiRuntime,
  topicsFile: TopicsFile | null,
): Promise<Record<string, number> | null> {
  const raw = await readJsonIfExists(passFile(deps.root, pass.id, "general.json"), "general.json");
  if (raw === null) return null;
  const parsed = GeneralPoolFile.safeParse(raw);
  if (!parsed.success) {
    deps.log.warn("general.json is invalid; the general stories are skipped", { pass: pass.id });
    return null;
  }
  const pool = parsed.data;
  const judge = runtime.generalJudge ?? null;
  if (judge === null) {
    deps.log.warn(
      "General news stories are set but TYPESAFE_API_KEY is not; they are skipped this run",
      { stories: pool.items.length },
    );
    return { general_pool: pool.items.length, general_judged: 0, general_skipped: 1 };
  }

  const topics = activeGeneralFrom(topicsFile);
  const requests: GeneralRequest[] = [];
  for (const item of pool.items) {
    const own = topics.filter((topic) => item.topic_ids?.includes(topic.id) === true);
    if (own.length > 0) requests.push({ item, topics: own });
  }
  const checked = new Set(pool.checked ?? []);
  const { kept, over } = applyCeiling(
    requests.map((request) => request.item),
    GENERAL_JUDGE_CEILING,
    (item) => (pool.carriers[item.id] ?? [item.source_id]).every((id) => checked.has(id)),
  );
  const inScope = new Set(kept.map((item) => item.id));
  if (over > 0) {
    deps.log.warn("The general stories are over the safety ceiling; the least carried wait", {
      pass: pass.id,
      ceiling: GENERAL_JUDGE_CEILING,
      stories: requests.length,
      left_out: over,
    });
  }

  const path = passFile(deps.root, pass.id, "general-judged.json");
  const previous = await readPrevious(path, judge.model);
  const wanted = requests.filter((request) => inScope.has(request.item.id));
  const reused = new Map<string, Entry>();
  const asked: GeneralRequest[] = [];
  for (const request of wanted) {
    const entry = previous.get(request.item.id);
    if (answers(entry, request.topics)) reused.set(request.item.id, entry);
    else asked.push(request);
  }
  const fresh = asked.length > 0 ? await judge.judge(asked) : [];

  const fresher = new Map<string, Entry>();
  for (const answer of fresh) {
    const fits: Entry["fits"] = {};
    const hashes: Entry["hashes"] = {};
    for (const fit of answer.fits) {
      fits[fit.topic_id] = fit.fit;
      hashes[fit.topic_id] = fit.topic_hash;
    }
    if (Object.keys(fits).length === 0) continue;
    fresher.set(answer.item.id, {
      item_id: answer.item.id,
      ...(answer.flags ? { flags: answer.flags } : {}),
      fits,
      hashes,
    });
  }
  const entries = wanted.flatMap(
    (request) => reused.get(request.item.id) ?? fresher.get(request.item.id) ?? [],
  );
  const judgedIds = new Set(entries.map((entry) => entry.item_id));
  const unjudged = wanted.filter((r) => !judgedIds.has(r.item.id)).map((r) => r.item.id);
  const file: GeneralJudgedFile = {
    version: 1,
    judge: { model: judge.model, questions_hash: GENERAL_QUESTIONS_HASH },
    entries,
    unjudged,
    counts: {
      pool: pool.items.length,
      over_ceiling: over,
      reused: reused.size,
      requests: asked.length,
      judged: entries.length,
      unjudged: unjudged.length,
    },
  };
  await writeJson(path, file);
  if (unjudged.length > 0) {
    deps.log.warn("Jev could not judge some general stories", {
      pass: pass.id,
      stories: unjudged.length,
    });
  }
  return {
    general_pool: pool.items.length,
    general_judged: entries.length,
    general_reused: reused.size,
    general_requests: asked.length,
    general_unjudged: unjudged.length,
    general_over_ceiling: over,
  };
}
