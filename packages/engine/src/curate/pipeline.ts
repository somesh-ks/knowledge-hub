import {
  type DigestKind,
  type Item,
  type JudgmentsFile,
  type Preferences,
  VOICE_LIMITS,
} from "@singularity/core";
import { type AuthorityMatcher, withAuthority } from "../authority/authority.js";
import { type CommunityFile, withCommunity } from "../community/community.js";
import type { Logger } from "../context.js";
import type { ExtractedText } from "../extract/extractText.js";
import { judgeWithCache } from "../judge/cache.js";
import type { Judge } from "../judge/types.js";
import { mapConcurrent } from "../llm/concurrency.js";
import { withCreator } from "../score/creator.js";
import { scoreItem } from "../score/scoreItem.js";
import { assignSections, capFor, selectItems } from "../score/selectItems.js";
import type { ScoredItem, SelectedItem } from "../score/types.js";
import { writerCategory } from "../topics/writerCategory.js";
import type { Grounder } from "../validate/grounding.js";
import { groundAndRepair } from "../validate/groundingRepair.js";
import type { Linter } from "../voice/lint.js";
import { enforceVoice } from "../write/enforceVoice.js";
import { type WrittenText, writtenText } from "../write/text.js";
import type { SourceMaterial, Writer } from "../write/types.js";
import type { DropStage, Selection, WrittenFile } from "./selectionFile.js";
import type { DigestWindow } from "./window.js";

export interface CurateDeps {
  judge: Judge;
  writer: Writer;
  /** Null skips the grounding check; the selection is then marked unverified. */
  grounder: Grounder | null;
  linter: Linter;
  /** Full text for a finalist, or null when none could be found. */
  extract: (item: Item) => Promise<ExtractedText | null>;
  log: Logger;
  now: () => Date;
}

export interface CurateInput {
  pool: readonly Item[];
  preferences: Preferences;
  judgments: JudgmentsFile;
  kind: DigestKind;
  window: DigestWindow;
  /** Display names by source id. */
  sourceNames?: Readonly<Record<string, string>>;
  threshold?: number;
  /** Built-in categories set never to publish. */
  offCategories?: readonly string[];
  /** The owner's vetted publishers (D234). */
  authority?: AuthorityMatcher;
  community?: CommunityFile;
}

export interface CurateCounts {
  pool: number;
  judged: number;
  cacheHits: number;
  cacheMisses: number;
  unjudged: number;
  qualifying: number;
  selected: number;
  extracted: number;
  written: number;
  voiceDropped: number;
  groundingDropped: number;
  final: number;
}

export interface CurateResult {
  /**
   * "failed" means the run could not judge or write enough items to say anything about the day,
   * so it must not be recorded as a quiet day: that would advance the fetch window and lose items.
   */
  outcome: "selected" | "nothing" | "failed";
  /** Null when the run failed: there is nothing safe to render. */
  selection: Selection | null;
  /** Why the run failed, in one sentence. Only set when outcome is "failed". */
  failure?: string;
  written: WrittenFile;
  /** The cache with this run's new judgments merged in. The caller persists it. */
  judgments: JudgmentsFile;
  counts: CurateCounts;
  /** Items that cleared the bar but were cut by the cap, for the run log. */
  scoredTop: Array<{ id: string; score: number }>;
}

const EXTRACT_CONCURRENCY = 4;

/** At least this share of a stage's inputs failing for infrastructure reasons is an outage. */
const OUTAGE_SHARE = 0.5;

function mostlyFailed(failed: number, total: number): boolean {
  return total > 0 && failed / total >= OUTAGE_SHARE;
}

function nothing(
  input: CurateInput,
  counts: CurateCounts,
  written: WrittenFile,
  judgments: JudgmentsFile,
): CurateResult {
  return {
    outcome: "nothing",
    selection: {
      version: 1,
      kind: input.kind,
      mode: "api",
      outcome: "nothing",
      verified: false,
      window: input.window,
      items: [],
    },
    written,
    judgments,
    counts,
    scoredTop: [],
  };
}

/**
 * The API curator: judge (cached), score, select, extract, write, voice lint with one rewrite,
 * grounding with one rewrite. Every stage drops items instead of failing the run; only the
 * spend guard (BudgetExceededError) aborts it. Fewer than three survivors is the "nothing"
 * outcome, never padded.
 */
export async function curatePool(deps: CurateDeps, input: CurateInput): Promise<CurateResult> {
  const { log } = deps;
  const dropped: WrittenFile["dropped"] = [];
  const drop = (id: string, stage: DropStage, reason: string): void => {
    dropped.push({ id, stage, reason });
  };
  const byId = new Map(input.pool.map((item) => [item.id, item]));
  const counts: CurateCounts = {
    pool: input.pool.length,
    judged: 0,
    cacheHits: 0,
    cacheMisses: 0,
    unjudged: 0,
    qualifying: 0,
    selected: 0,
    extracted: 0,
    written: 0,
    voiceDropped: 0,
    groundingDropped: 0,
    final: 0,
  };

  if (input.pool.length === 0) {
    log.info("The pool is empty");
    return nothing(input, counts, { version: 1, items: [], dropped }, input.judgments);
  }

  const judged = await judgeWithCache(deps.judge, input.pool, input.judgments);
  counts.judged = judged.entries.length;
  counts.cacheHits = judged.hitCount;
  counts.cacheMisses = judged.missCount;
  counts.unjudged = judged.unjudged.length;
  for (const id of judged.unjudged) drop(id, "judge", "no judgment");
  log.info("Judged the pool", {
    items: counts.judged,
    cached: counts.cacheHits,
    unjudged: counts.unjudged,
  });

  const scored: ScoredItem[] = [];
  for (const entry of judged.entries) {
    const item = byId.get(entry.item_id);
    if (item)
      scored.push(
        withCommunity(
          withCreator(withAuthority(scoreItem(entry, input.preferences, item), input.authority)),
          input.community,
        ),
      );
  }

  const selection = selectItems({
    scored,
    kind: input.kind,
    floor: VOICE_LIMITS.items.floor,
    cap: capFor(input.kind),
    threshold: input.threshold,
    ...(input.offCategories ? { offCategories: input.offCategories } : {}),
  });
  counts.qualifying = selection.qualifying;
  counts.selected = selection.selected.length;
  for (const d of selection.dropped) drop(d.id, "select", `${d.reason} (score ${d.score})`);
  const scoredTop = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((s) => ({ id: s.item.id, score: s.score }));

  const finish = (
    outcome: "selected" | "nothing",
    kept: SelectedItem[],
    writtenFile: WrittenFile,
    verified: boolean,
    texts: Map<string, WrittenText>,
  ): CurateResult => {
    counts.final = kept.length;
    return {
      outcome,
      selection: {
        version: 1,
        kind: input.kind,
        mode: "api",
        outcome,
        verified: outcome === "selected" && verified,
        window: input.window,
        items:
          outcome === "selected"
            ? kept.map((sel) => {
                const text = writtenText(texts.get(sel.item.id) as WrittenText);
                return { id: sel.item.id, category: sel.category, score: sel.score, ...text };
              })
            : [],
      },
      written: writtenFile,
      judgments: judged.cache,
      counts,
      scoredTop,
    };
  };
  const empty: WrittenFile = { version: 1, items: [], dropped };
  const failed = (
    failure: string,
    c: CurateCounts,
    writtenFile: WrittenFile,
    cache: JudgmentsFile,
    top: CurateResult["scoredTop"],
  ): CurateResult => ({
    outcome: "failed",
    selection: null,
    failure,
    written: writtenFile,
    judgments: cache,
    counts: c,
    scoredTop: top,
  });

  if (selection.outcome === "nothing") {
    if (mostlyFailed(counts.unjudged, input.pool.length)) {
      const failure = `The judge answered ${counts.judged} of ${input.pool.length} items. That looks like an outage, not a quiet day.`;
      log.error(failure);
      return failed(failure, counts, empty, judged.cache, scoredTop);
    }
    log.info("Nothing cleared the bar", { qualifying: counts.qualifying });
    return finish("nothing", [], empty, false, new Map());
  }

  // Extract finalists' text. A finalist with no readable source cannot be written, so it drops.
  const extracted = await mapConcurrent(selection.selected, EXTRACT_CONCURRENCY, async (sel) => ({
    sel,
    text: await deps.extract(sel.item),
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
      source: input.sourceNames?.[sel.item.source_id] ?? sel.item.source_id,
      ...(sel.item.author ? { author: sel.item.author } : {}),
      category: writerCategory(sel.category, undefined),
      text: text.text,
      ...(sel.item.source_type === "youtube" && text.method !== "snippet" ? { spoken: true } : {}),
    });
  }
  counts.extracted = materials.size;

  const writeResult = await deps.writer.write([...materials.values()]);
  for (const failure of writeResult.failed) drop(failure.id, "write", failure.reason);
  counts.written = writeResult.written.length;

  const voice = await enforceVoice({
    written: writeResult.written,
    materials,
    writer: deps.writer,
    linter: deps.linter,
  });
  counts.voiceDropped = voice.dropped.length;
  for (const d of voice.dropped) {
    drop(d.id, "voice", d.violations.map((v) => v.message).join(" ") || "no source material");
  }

  const grounding = await groundAndRepair({
    grounder: deps.grounder,
    writer: deps.writer,
    linter: deps.linter,
    items: voice.passed.map((p) => p.item),
    materials,
  });
  counts.groundingDropped = grounding.dropped.length;
  for (const d of grounding.dropped) {
    const detail =
      d.reason === "voice"
        ? d.violations.map((v) => v.message).join(" ")
        : d.unsupported.map((s) => `"${s.sentence}"`).join(", ");
    drop(d.id, "grounding", `${d.reason}: ${detail}`);
  }

  const keptIds = new Set(grounding.kept.map((k) => k.item.id));
  const survivors = assignSections(selection.selected.filter((sel) => keptIds.has(sel.item.id)));
  const texts = new Map(grounding.kept.map((k) => [k.item.id, writtenText(k.item)]));

  const writtenFile: WrittenFile = {
    version: 1,
    items: grounding.kept.map((k) => ({
      id: k.item.id,
      ...writtenText(k.item),
      ...(methods.get(k.item.id) ? { extract_method: methods.get(k.item.id) as string } : {}),
      rewritten_fields: [
        ...(voice.passed.find((p) => p.item.id === k.item.id)?.rewrittenFields ?? []),
        ...k.rewrittenFields,
      ],
      verified: k.verified,
      grounding: k.checks.map((c) => ({
        field: c.field,
        sentence: c.sentence,
        score: c.score,
        status: c.status,
      })),
    })),
    dropped,
  };

  if (survivors.length < VOICE_LIMITS.items.floor) {
    // Extraction and writing failures are infrastructure; voice and grounding drops are editorial.
    const infra = selection.selected.length - materials.size + writeResult.failed.length;
    if (mostlyFailed(infra, selection.selected.length)) {
      const failure = `${infra} of ${selection.selected.length} finalists could not be extracted or written. That looks like an outage, not a quiet day.`;
      log.error(failure);
      return failed(failure, counts, { ...writtenFile, items: [] }, judged.cache, scoredTop);
    }
    log.info("Too few items survived writing and validation", { survivors: survivors.length });
    return finish("nothing", [], { ...writtenFile, items: [] }, false, new Map());
  }
  return finish("selected", survivors, writtenFile, grounding.verified, texts);
}
