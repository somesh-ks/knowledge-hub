import {
  type AutoAdjust,
  activeFitTopics,
  adjustmentAt,
  type Category,
  type Item,
  offCategories,
  type Preferences,
  type ScheduleFile,
  type SourceStatsFile,
  sourceShift,
  VOICE_LIMITS,
} from "@singularity/core";
import { isThinText } from "../alexandria/alexandria.js";
import { MAX_SPOKEN_CHARS } from "../audio/spokenText.js";
import type { ApiRuntime } from "../curate/apiRuntime.js";
import {
  loadPool,
  loadPreferences,
  loadSources,
  readJsonIfExists,
  sourceNameMap,
} from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import type { DropStage, Selection, WrittenFile } from "../curate/selectionFile.js";
import type { ExtractedText } from "../extract/extractText.js";
import type { RunMode } from "../gate/decideRun.js";
import { mapConcurrent } from "../llm/concurrency.js";
import { createFileProfileStore, OWNER_ID } from "../profile/profile.js";
import { TASTE_LIMITS, type TasteProfile, tasteProfile } from "../profile/tasteFit.js";
import type { Taste } from "../profile/tasteNote.js";
import {
  tasteHeadlines,
  type VotePreferences,
  votePreferences,
  voteReportLine,
} from "../profile/votes.js";
import { loadSchedule } from "../schedule/store.js";
import { isReleaseStory, RELEASE_SECTION } from "../score/releaseNotes.js";
import { scoreItem } from "../score/scoreItem.js";
import {
  applyFormatMix,
  applyTopics,
  type SourceFacts,
  sourceFactsMap,
  type TopicLayer,
} from "../score/scoreTopics.js";
import { loadSectionPlan } from "../score/sectionPlan.js";
import { assignSections, capFor, compareCandidates, selectItems } from "../score/selectItems.js";
import { withSourceAdjustment, withVoteWeight } from "../score/sourceAdjust.js";
import type { ScoredItem, SelectedItem } from "../score/types.js";
import { readSeen, readSourceStats } from "../state/store.js";
import { loadTopics } from "../topics/store.js";
import { writerCategory } from "../topics/writerCategory.js";
import { createLinter, type Linter } from "../voice/lint.js";
import { loadVoice } from "../voice/voice.js";
import { enforceVoice } from "../write/enforceVoice.js";
import { type WrittenText, writtenText } from "../write/text.js";
import type { SourceMaterial } from "../write/types.js";
import { JudgedFile, type MaterialsFile, readArtifact } from "./artifacts.js";
import { StageFailure } from "./errors.js";
import {
  activeGeneralFrom,
  countGeneral,
  type GeneralCounts,
  GeneralJudgedFile,
  GeneralPoolFile,
  mergeGeneralCounts,
} from "./generalNews.js";
import { generalCandidates, generalIdsFor } from "./generalScope.js";
import { mostlyFailed } from "./judgeStage.js";
import { markStage, type Plan, type PlanPass, passFile, requireStage } from "./plan.js";
import {
  charsForMinutes,
  lengthMinutesFor,
  lookbackHoursFor,
  overNarrationLimit,
  storiesForMinutes,
  WRITE_MAX,
  withSpares,
} from "./scheduleSize.js";
import { countSample, mergeSampleCounts, readSampleFiles } from "./scoreSample.js";
import { countSources } from "./sourceCounts.js";
import type { PassReport, RunDeps, StageReport } from "./types.js";

const EXTRACT_CONCURRENCY = 4;

interface PassContext {
  deps: RunDeps;
  runtime: ApiRuntime;
  linter: Linter;
  preferences: Preferences;
  sourceNames: Record<string, string>;
  /** Each source's format and lean, for the type mix and perspective. */
  sourceFacts: Record<string, SourceFacts>;
  /** Enabled custom topics, scored against the fits the judge stage recorded. */
  customTopics: ReturnType<typeof activeFitTopics>;
  /** Sections a scheduled regular briefing covers; null for every section and for other modes. */
  /** Built-in categories set never to publish. */
  offCategories: readonly string[];
  /** Topics the scheduled daily briefing leaves out. */
  skipTopics: readonly string[];
  /** Regenerate: the topics chosen for this run alone. Every other topic is left out of every pass. */
  onlyTopics: ReadonlySet<string> | null;
  /** Minutes the scheduled podcast runs, which sizes the regular briefing; null for other modes. */
  /** Topics the weekly pass leaves out, from the schedule in every mode. */
  weeklySkipTopics: readonly string[];
  /** 30-day per-source counters, for the small score adjustment from each source's pass rate. */
  sourceStats: SourceStatsFile;
  /** What votes added to sources (core/autoAdjust.ts). */
  autoAdjust: AutoAdjust;
  /** The owner's votes as source and domain preferences, and the headlines the writer is told of. */
  votePrefs: VotePreferences;
  taste: Taste;
  /** What the owner liked and disliked, for Jev's taste check; null below its minimum of signals. */
  tasteProfile: TasteProfile | null;
  /** The general news topics that are switched on, for the pass level of their feeds' counters. */
  generalTopics: ReturnType<typeof activeGeneralFrom>;
  /** The schedule and run mode, which say what general topics each pass publishes. */
  schedule: ScheduleFile;
  mode: RunMode;
  /** The minutes this run was asked to be, in place of the schedule's; undefined for none. */
  asked: number | undefined;
  /** What the owner asked to improve, for the writer prompt. */
  feedback: string | undefined;
}

/**
 * Score and select from the judge's answers, extract full text for the finalists, write the
 * headline and summary with the routed writer, and give each failing field one rewrite. Fewer
 * than three survivors is the "nothing" outcome, never padded; an extraction or writing outage
 * fails the stage instead. Items already chosen for an earlier pass of the same run are withheld,
 * so the weekly digest never repeats the regular one published minutes before it.
 */
export async function writeStage(
  deps: RunDeps,
  plan: Plan,
  feedback?: string,
  chosenTopics?: readonly string[],
): Promise<StageReport> {
  const runtime = await deps.runtime();
  const linter = createLinter(await loadVoice(deps.root));
  const [preferences, sources] = await Promise.all([
    loadPreferences(deps.root),
    loadSources(deps.root),
  ]);
  const profile = await createFileProfileStore(deps.root).read(OWNER_ID);
  const topics = await loadTopics(deps.root);
  const votePrefs = votePreferences(profile.votes, deps.now());
  const taste = tasteHeadlines(profile.votes);
  const fullSchedule = await loadSchedule(deps.root);
  const schedule = plan.mode === "scheduled" ? fullSchedule : null;
  const context: PassContext = {
    deps,
    runtime,
    linter,
    preferences,
    sourceNames: sourceNameMap(sources),
    sourceFacts: sourceFactsMap(sources),
    customTopics: activeFitTopics(topics),
    offCategories: offCategories(topics),
    skipTopics: schedule?.skip_topics ?? [],
    onlyTopics: chosenTopics && chosenTopics.length > 0 ? new Set(chosenTopics) : null,
    weeklySkipTopics: fullSchedule.weekly.skip_topics,
    sourceStats: await readSourceStats(deps.root),
    votePrefs,
    autoAdjust: profile.auto_adjust,
    taste,
    tasteProfile: tasteProfile(profile),
    generalTopics: activeGeneralFrom(topics),
    schedule: fullSchedule,
    mode: plan.mode,
    asked: plan.length_minutes,
    feedback,
  };

  const claimed = new Set<string>();
  const passes: PassReport[] = [];
  for (const pass of plan.passes) {
    await requireStage(deps.root, pass, "judge", "writing");
    const { report, kept } = await writePass(context, pass, claimed);
    for (const id of kept) claimed.add(id);
    passes.push(report);
  }
  return {
    stage: "write",
    ok: true,
    dry_run: plan.dry_run,
    passes,
    votes: voteReportLine(profile.votes, votePrefs, taste),
  };
}

interface PassResult {
  report: PassReport;
  /** Ids the pass wrote, spares included: a later pass of the run leaves them all. */
  kept: string[];
}

function nothingSelection(pass: PlanPass): Selection {
  return {
    version: 1,
    kind: pass.kind,
    mode: "api",
    outcome: "nothing",
    verified: false,
    window: pass.window,
    items: [],
  };
}

async function writePass(
  context: PassContext,
  pass: PlanPass,
  claimed: ReadonlySet<string>,
): Promise<PassResult> {
  const {
    deps,
    runtime,
    linter,
    preferences,
    sourceNames,
    customTopics,
    offCategories: off,
    skipTopics,
    onlyTopics,
    weeklySkipTopics,
    sourceStats,
    votePrefs,
    autoAdjust,
  } = context;
  const file = (name: string): string => passFile(deps.root, pass.id, name);
  const sectionPlan = await loadSectionPlan(deps.root, pass.kind, context.asked);
  const pool = await loadPool(file("pool.json"));
  const judged = await readArtifact(file("judged.json"), "judged.json", JudgedFile);
  const byId = new Map(pool.items.map((item) => [item.id, item]));

  const dropped: WrittenFile["dropped"] = [];
  const drop = (id: string, stage: DropStage, reason: string): void => {
    dropped.push({ id, stage, reason });
  };
  for (const id of judged.unjudged) drop(id, "judge", "no judgment");

  const layer: TopicLayer = {
    topics: customTopics,
    fits: judged.topic_fits ?? {},
    sources: context.sourceFacts,
  };
  const base: ScoredItem[] = [];
  for (const entry of judged.entries) {
    const item = byId.get(entry.item_id);
    if (!item) continue;
    if (claimed.has(item.id)) {
      drop(item.id, "select", "written for an earlier digest of this run");
      continue;
    }
    base.push(
      withSourceAdjustment(
        applyFormatMix(
          applyTopics(scoreItem(entry, preferences, item), layer),
          preferences.format_mix,
          context.sourceFacts,
        ),
        sourceStats,
        sourceShift(adjustmentAt(autoAdjust.sources[item.source_id], deps.now())),
      ),
    );
  }
  // Jev's taste check, for the strongest candidates only: the change matters near the cut.
  const tasteFits =
    context.tasteProfile && runtime.tasteFitter
      ? await runtime.tasteFitter.fit(
          [...base]
            .sort((a, b) => b.score - a.score)
            .slice(0, TASTE_LIMITS.max_items)
            .map((candidate) => candidate.item),
          context.tasteProfile,
        )
      : new Map<string, number>();
  if (tasteFits.size > 0)
    deps.log.info("taste check", {
      pass: pass.id,
      answered: tasteFits.size,
      model: runtime.tasteFitter?.model,
    });
  const scored = base.map((candidate) =>
    withVoteWeight(candidate, votePrefs, tasteFits.get(candidate.item.id)),
  );

  // The general topics this pass publishes (not in its podcast's skip list) add their judged
  // stories as candidates of sections of their own. They are judged already (judgeGeneral).
  const generalScored = (
    await generalCandidates({
      poolPath: file("general.json"),
      judgedPath: file("general-judged.json"),
      topics: context.generalTopics,
      formatMix: preferences.format_mix,
      sources: context.sourceFacts,
      publish: onlyTopics
        ? context.generalTopics.map((topic) => topic.id).filter((id) => onlyTopics.has(id))
        : generalIdsFor(context.schedule, pass.kind, context.mode),
      inPool: new Set(byId.keys()),
      seen: (await readSeen(deps.root)).items,
      now: deps.now(),
      model: runtime.judge.model,
    })
  ).filter((candidate) => {
    if (!claimed.has(candidate.item.id)) return true;
    drop(candidate.item.id, "select", "written for an earlier digest of this run");
    return false;
  });

  // The owner's chosen length sizes the scheduled regular briefing, and the weekly pass takes
  // the weekly podcast's own length. Such a briefing also writes spares, so a story dropped after
  // selection does not come off the length; validation airs as many as fill it.
  // The same rule sizes the judge's pool in the fetch stage (fetchStage.ts).
  const lengthOf = lengthMinutesFor(context.schedule, pass.kind, context.mode, context.asked);
  const wanted =
    lengthOf === null
      ? undefined
      : storiesForMinutes(lengthOf, VOICE_LIMITS.items.floor, VOICE_LIMITS.items.hardMax);
  const selectArgs = {
    scored: [...scored, ...generalScored],
    kind: pass.kind,
    floor: VOICE_LIMITS.items.floor,
    offCategories: off,
    // The scheduled regular briefing leaves out the daily podcast's skipped topics and the weekly
    // pass its own; an episode made on request covers everything it was asked for.
    skipTopics:
      pass.kind === "regular" ? skipTopics : pass.kind === "weekly" ? weeklySkipTopics : [],
    // Regenerate with chosen topics: a candidate stays only when its category is one of them.
    ...(onlyTopics ? { onlyTopics: [...onlyTopics] } : {}),
    plan: sectionPlan,
    // The owner's lookback for this podcast (Daily or Weekly settings); Auto has none.
    lookbackHours: lookbackHoursFor(context.schedule, pass.kind, context.mode),
    now: deps.now(),
  };
  const chosen = selectItems({
    ...selectArgs,
    cap: wanted === undefined ? capFor(pass.kind) : WRITE_MAX,
    total: wanted === undefined ? VOICE_LIMITS.items.hardMax : withSpares(wanted),
  });
  for (const d of chosen.dropped) drop(d.id, "select", `${d.reason} (score ${d.score})`);

  // Per-source counters for state/source-stats.json, applied at commit. "Passed" is every judged
  // item that cleared the eligibility rules and the score bar, whether or not the cap kept it.
  // "Asked" is every judged item the judge asked the flag questions (a topic-only item stands in
  // with a neutral judgment and was not), and "flagged" every asked item it called hype or
  // sponsored: together they measure the source's trust.
  const notAsked = new Set(judged.neutral_ids ?? []);
  const notPassed = new Set(
    chosen.dropped
      .filter(
        (d) =>
          d.reason === "no_category" ||
          d.reason === "never_publish" ||
          d.reason === "below_threshold",
      )
      .map((d) => d.id),
  );
  // The general news stories were judged apart from the pool (judgeGeneral): their feeds' counters
  // join here, with `covered` standing where a briefing's `published` stands for other sources.
  // The weekly pass counts none: its stories were counted in the daily passes that judged them.
  const general =
    pass.kind === "weekly" ? {} : await readGeneralCounts(file, context.generalTopics);
  // Items judged for the score alone (D70) count for their sources too, marked as sampled.
  const sampleFiles = await readSampleFiles(file("sample.json"), file("sample-judged.json"));
  const sample = sampleFiles.sample
    ? countSample({
        sample: sampleFiles.sample,
        judged: sampleFiles.judged,
        preferences,
        offCategories: off,
      })
    : {};
  await writeJson(file("source-counts.json"), {
    version: 1,
    sources: mergeSampleCounts(
      mergeGeneralCounts(
        countSources({
          fetchedBySource: pool.fetchedBySource,
          poolSourceIds: new Map(pool.items.map((item) => [item.id, item.source_id])),
          judgedIds: scored.map((s) => s.item.id),
          asked: new Map(
            scored.filter((s) => !notAsked.has(s.item.id)).map((s) => [s.item.id, s.entry.flags]),
          ),
          passedIds: new Set(scored.map((s) => s.item.id).filter((id) => !notPassed.has(id))),
        }),
        general,
      ),
      sample,
    ),
  });

  /** Persist the pass's outputs and the stage marker. `survivors` empty means "nothing". */
  const finish = async (
    survivors: Array<{
      id: string;
      category: Selection["items"][number]["category"];
      score: number;
    }>,
    texts: Map<string, WrittenText>,
    entries: WrittenFile["items"],
    materials: MaterialsFile["items"],
  ): Promise<PassResult> => {
    const selection: Selection =
      survivors.length === 0
        ? {
            ...nothingSelection(pass),
            // Validation refills a sized pass from its reserve even when writing left too few.
            ...(lengthOf === null ? {} : { length_chars: charsForMinutes(lengthOf) }),
          }
        : {
            ...nothingSelection(pass),
            outcome: "selected",
            ...(lengthOf === null ? {} : { length_chars: charsForMinutes(lengthOf) }),
            items: survivors.map((s) => ({
              ...s,
              ...writtenText(texts.get(s.id) as WrittenText),
            })),
          };
    await writeJson(file("selection.json"), selection);
    await writeJson(file("written.json"), { version: 1, items: entries, dropped });
    await writeJson(file("materials.json"), { version: 1, items: materials });
    const outcome = survivors.length === 0 ? "nothing" : "selected";
    await markStage(deps.root, pass, "write", { at: deps.now().toISOString(), outcome });
    return {
      // A later pass of the run (a weekly on the same day shares the pool) loses every story this
      // one wrote: which spares air is known only once validation measures the narration, and
      // releasing them by an estimate let a forced Sunday run air four daily stories in its weekly.
      kept: survivors.map((s) => s.id),
      report: {
        id: pass.id,
        kind: pass.kind,
        outcome,
        qualifying: chosen.qualifying,
        selected: chosen.selected.length,
        written: entries.length,
        items: survivors.length,
        ...writeLosses(chosen.selected, dropped),
      },
    };
  };

  if (chosen.outcome === "nothing") {
    deps.log.info("Nothing cleared the bar", { pass: pass.id, qualifying: chosen.qualifying });
    await writeJson(file("reserve.json"), { version: 1, items: [] });
    return finish([], new Map(), [], []);
  }

  // The writer prompt still takes a built-in category. A custom topic's story gets the nearest
  // one the judge found for it, because the prompt text comes from the source, not the label.
  const topCategoryOf = new Map(scored.map((s) => [s.item.id, s.topCategory]));
  const writerCategoryOf = (sel: { item: Item; category: string }): Category =>
    writerCategory(sel.category, topCategoryOf.get(sel.item.id));
  // The section each story would air in, for the owner's prompt of that block (D182). Writing can
  // drop a Top pick and promote the next story, which then keeps the prompt of its own section.
  const sectionOf = new Map(
    assignSections(chosen.selected, sectionPlan).map((sel) => [sel.item.id, sel.section]),
  );
  const { materials, methods, writeResult, voice } = await writeFinalists({
    runtime,
    linter,
    finalists: chosen.selected.map((sel) => ({
      item: sel.item,
      category: writerCategoryOf(sel),
      prompt: sectionPlan.prompt(sectionOf.get(sel.item.id) ?? sel.home),
    })),
    sourceNames,
    feedback: context.feedback,
    taste: context.taste,
    drop,
  });

  // A sized briefing keeps the next stories selection would have taken, best first, so
  // validation can write replacements when grounding cuts it short of its length (refill).
  const reserve =
    wanted === undefined
      ? []
      : reserveAfter(
          chosen.selected,
          selectItems({
            ...selectArgs,
            // The structure's story counts shape what the first selection airs; they must not
            // empty the reserve. The 2026-10-27 daily's counts held selection to 8 stories, the
            // same counts held the reserve to none, and a briefing grounding cut to 3 stayed 79 s.
            plan: { ...sectionPlan, limit: () => null },
            cap: withSpares(wanted) * 2,
            total: withSpares(wanted) * 2,
          }).selected,
        ).map((sel) => ({
          id: sel.item.id,
          category: sel.category,
          score: sel.score,
          writer_category: writerCategoryOf(sel),
          // A replacement comes after the Top picks, so it airs in its own section.
          section: isReleaseStory(sel) ? RELEASE_SECTION : sel.home,
        }));
  await writeJson(file("reserve.json"), {
    version: 1,
    ...(context.feedback === undefined ? {} : { feedback: context.feedback }),
    taste: { liked: [...context.taste.liked], disliked: [...context.taste.disliked] },
    items: reserve,
  });

  const keptIds = new Set(voice.passed.map((p) => p.item.id));
  // One narration request carries the whole episode, so the stories must fit it together. A
  // sized briefing's spares are cut to its length after grounding (validateStage), and no length
  // reaches the request's limit, so cutting them here would only cut the spares grounding needs.
  const told = voice.passed.map((p) => ({
    id: p.item.id,
    score: chosen.selected.find((sel) => sel.item.id === p.item.id)?.score ?? 0,
    chars: (p.item.spoken ?? `${p.item.headline} ${p.item.summary}`).length,
  }));
  for (const id of lengthOf === null ? overNarrationLimit(told, MAX_SPOKEN_CHARS) : []) {
    keptIds.delete(id);
    drop(id, "voice", "the episode's narration would run past one request");
  }
  const survivors = assignSections(
    chosen.selected.filter((sel) => keptIds.has(sel.item.id)),
    sectionPlan,
  );
  if (survivors.length < VOICE_LIMITS.items.floor) {
    // Extraction and writing failures are infrastructure; voice drops are editorial.
    const infra = chosen.selected.length - materials.size + writeResult.failed.length;
    if (mostlyFailed(infra, chosen.selected.length)) {
      throw new StageFailure(
        `${pass.id}: ${infra} of ${chosen.selected.length} finalists could not be extracted or written. That looks like an outage, not a quiet day.`,
      );
    }
    deps.log.info("Too few items survived writing", { pass: pass.id, survivors: survivors.length });
    return finish([], new Map(), [], []);
  }

  const passed = new Map(voice.passed.map((p) => [p.item.id, p]));
  const texts = new Map(voice.passed.map((p) => [p.item.id, writtenText(p.item)]));
  const entries: WrittenFile["items"] = survivors.map((sel) => {
    const text = writtenText(texts.get(sel.item.id) as WrittenText);
    const method = methods.get(sel.item.id);
    return {
      id: sel.item.id,
      ...text,
      ...(method ? { extract_method: method } : {}),
      rewritten_fields: passed.get(sel.item.id)?.rewrittenFields ?? [],
      verified: false,
      grounding: [],
    };
  });
  return finish(
    survivors.map((sel) => ({ id: sel.item.id, category: sel.category, score: sel.score })),
    texts,
    entries,
    survivors.map((sel) => materials.get(sel.item.id) as SourceMaterial),
  );
}

/**
 * Counters for the general stories a pass judged, or none when it read no general feed or the
 * judge stage skipped them. A missing or unreadable file only means no counters.
 */
async function readGeneralCounts(
  file: (name: string) => string,
  topics: PassContext["generalTopics"],
): Promise<GeneralCounts> {
  try {
    const pool = GeneralPoolFile.safeParse(
      await readJsonIfExists(file("general.json"), "general.json"),
    );
    const judged = GeneralJudgedFile.safeParse(
      await readJsonIfExists(file("general-judged.json"), "general-judged.json"),
    );
    if (!pool.success || !judged.success) return {};
    return countGeneral({ pool: pool.data, judged: judged.data, topics });
  } catch {
    return {};
  }
}

/**
 * A finalist to write: the item, the built-in category its writer prompt is told, and the owner's
 * prompt for its block when there is one (D182).
 */
export interface Finalist {
  item: Item;
  category: Category;
  prompt?: string | undefined;
}

/**
 * Extract, write and voice-check finalists: the write stage's selection, and validation's
 * replacements (refill). A finalist with no readable source cannot be written, so it drops; every
 * drop is reported through `drop`, in the order the stages lose them.
 */
export async function writeFinalists(args: {
  runtime: ApiRuntime;
  linter: Linter;
  finalists: readonly Finalist[];
  sourceNames: Record<string, string>;
  feedback: string | undefined;
  taste: Taste;
  /** Headlines the episode already airs, which the writer sees beside the finalists'. */
  airing?: readonly string[];
  drop: (id: string, stage: DropStage, reason: string) => void;
}): Promise<{
  materials: Map<string, SourceMaterial>;
  methods: Map<string, string>;
  writeResult: Awaited<ReturnType<ApiRuntime["writer"]["write"]>>;
  voice: Awaited<ReturnType<typeof enforceVoice>>;
}> {
  const { runtime, drop } = args;
  const extracted = await mapConcurrent(args.finalists, EXTRACT_CONCURRENCY, async (sel) => ({
    sel,
    text: await enrichThin(runtime, sel.item, await extractSafely(runtime, sel.item)),
  }));
  const materials = new Map<string, SourceMaterial>();
  const methods = new Map<string, string>();
  for (const { sel, text } of extracted) {
    if (!text) {
      drop(sel.item.id, "extract", "no readable source text");
      continue;
    }
    methods.set(sel.item.id, text.method);
    materials.set(sel.item.id, {
      id: sel.item.id,
      title: sel.item.title,
      source: args.sourceNames[sel.item.source_id] ?? sel.item.source_id,
      ...(sel.item.author ? { author: sel.item.author } : {}),
      category: sel.category,
      text: text.text,
      ...(sel.prompt === undefined ? {} : { prompt: sel.prompt }),
    });
  }

  const writeResult = await runtime.writer.write(
    [...materials.values()],
    args.feedback,
    args.taste,
    args.airing ?? [],
  );
  for (const failure of writeResult.failed) drop(failure.id, "write", failure.reason);
  const voice = await enforceVoice({
    written: writeResult.written,
    materials,
    writer: runtime.writer,
    linter: args.linter,
  });
  for (const d of voice.dropped) {
    drop(d.id, "voice", d.violations.map((v) => v.message).join(" ") || "no source material");
  }
  return { materials, methods, writeResult, voice };
}

/** How many reasons the stage JSON names; the rest are in written.json. */
const LOSS_REASONS = 5;

/**
 * What writing cost the selection, by stage, for the stage JSON: the 2026-10-24 replacement
 * selected 25 and wrote 12, and the reasons were only in the run's artifact, which the cloud
 * session cannot reach. The reasons most often given come first, each cut to a line.
 */
export function writeLosses(
  selected: readonly SelectedItem[],
  dropped: WrittenFile["dropped"],
): { lost?: Record<string, number>; lost_reasons?: Record<string, number> } {
  const ids = new Set(selected.map((sel) => sel.item.id));
  const lost: Record<string, number> = {};
  const reasons = new Map<string, number>();
  for (const d of dropped) {
    if (!ids.has(d.id) || (d.stage !== "extract" && d.stage !== "write" && d.stage !== "voice")) {
      continue;
    }
    lost[d.stage] = (lost[d.stage] ?? 0) + 1;
    const reason = `${d.stage}: ${d.reason.replace(/\s+/g, " ").slice(0, 100)}`;
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  if (Object.keys(lost).length === 0) return {};
  const top = [...reasons].sort((a, b) => b[1] - a[1]).slice(0, LOSS_REASONS);
  return { lost, lost_reasons: Object.fromEntries(top) };
}

/**
 * The stories a larger selection adds to the one that was written, best first. The larger
 * selection keeps the caps on topics and outlets; its own order is by section, so a refill that
 * took its first few would draw them all from the leading sections.
 */
export function reserveAfter(
  written: readonly SelectedItem[],
  larger: readonly SelectedItem[],
): SelectedItem[] {
  const taken = new Set(written.map((sel) => sel.item.id));
  return larger.filter((sel) => !taken.has(sel.item.id)).sort(compareCandidates);
}

async function extractSafely(runtime: ApiRuntime, item: Item): Promise<ExtractedText | null> {
  try {
    return await runtime.extract(item);
  } catch {
    return null;
  }
}

/**
 * A finalist whose text is still thin after every free and paid read gets sourced facts from
 * Alexandria, labelled with their provider, appended to its source text (so the grounding check
 * reads them too). Facts never replace text: a story with no readable text is still
 * dropped. Any failure leaves the text as it was.
 */
export async function enrichThin(
  runtime: Pick<ApiRuntime, "enrich">,
  item: Item,
  text: ExtractedText | null,
): Promise<ExtractedText | null> {
  // Facts only enrich text that was read, so a story with none is never paid for.
  if (!text || !runtime.enrich || !isThinText(text.text)) return text;
  try {
    const facts = await runtime.enrich(item);
    if (!facts) return text;
    return { ...text, text: `${text.text}\n\n${facts}` };
  } catch {
    return text;
  }
}
