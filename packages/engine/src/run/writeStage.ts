import { type Item, type Preferences, VOICE_LIMITS } from "@dispatch/core";
import type { ApiRuntime } from "../curate/apiRuntime.js";
import { loadPool, loadPreferences, loadSources, sourceNameMap } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import type { DropStage, Selection, WrittenFile } from "../curate/selectionFile.js";
import type { ExtractedText } from "../extract/extractText.js";
import { mapConcurrent } from "../llm/concurrency.js";
import { scoreItem } from "../score/scoreItem.js";
import { assignSections, capFor, selectItems } from "../score/selectItems.js";
import type { ScoredItem } from "../score/types.js";
import { createLinter, type Linter } from "../voice/lint.js";
import { loadVoice } from "../voice/voice.js";
import { enforceVoice } from "../write/enforceVoice.js";
import type { SourceMaterial } from "../write/types.js";
import { JudgedFile, type MaterialsFile, readArtifact } from "./artifacts.js";
import { StageFailure } from "./errors.js";
import { mostlyFailed } from "./judgeStage.js";
import { markStage, type Plan, type PlanPass, passFile, requireStage } from "./plan.js";
import type { PassReport, RunDeps, StageReport } from "./types.js";

const EXTRACT_CONCURRENCY = 4;

interface PassContext {
  deps: RunDeps;
  runtime: ApiRuntime;
  linter: Linter;
  preferences: Preferences;
  sourceNames: Record<string, string>;
}

/**
 * Score and select from the judge's answers, extract full text for the finalists, write
 * headline, summary and why with the Nebius writer, and give each failing field one rewrite. Fewer
 * than three survivors is the "nothing" outcome, never padded; an extraction or writing outage
 * fails the stage instead. Items already chosen for an earlier pass of the same run are withheld,
 * so the weekly digest never repeats the regular one published minutes before it.
 */
export async function writeStage(deps: RunDeps, plan: Plan): Promise<StageReport> {
  const runtime = await deps.runtime();
  const linter = createLinter(await loadVoice(deps.root));
  const [preferences, sources] = await Promise.all([
    loadPreferences(deps.root),
    loadSources(deps.root),
  ]);
  const context: PassContext = {
    deps,
    runtime,
    linter,
    preferences,
    sourceNames: sourceNameMap(sources),
  };

  const claimed = new Set<string>();
  const passes: PassReport[] = [];
  for (const pass of plan.passes) {
    await requireStage(deps.root, pass, "judge", "writing");
    const { report, kept } = await writePass(context, pass, claimed);
    for (const id of kept) claimed.add(id);
    passes.push(report);
  }
  return { stage: "write", ok: true, dry_run: plan.dry_run, passes };
}

interface PassResult {
  report: PassReport;
  /** Ids the pass will publish. */
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
  const { deps, runtime, linter, preferences, sourceNames } = context;
  const file = (name: string): string => passFile(deps.root, pass.id, name);
  const pool = await loadPool(file("pool.json"));
  const judged = await readArtifact(file("judged.json"), "judged.json", JudgedFile);
  const byId = new Map(pool.items.map((item) => [item.id, item]));

  const dropped: WrittenFile["dropped"] = [];
  const drop = (id: string, stage: DropStage, reason: string): void => {
    dropped.push({ id, stage, reason });
  };
  for (const id of judged.unjudged) drop(id, "judge", "no judgment");

  const scored: ScoredItem[] = [];
  for (const entry of judged.entries) {
    const item = byId.get(entry.item_id);
    if (!item) continue;
    if (claimed.has(item.id)) {
      drop(item.id, "select", "already chosen for an earlier digest of this run");
      continue;
    }
    scored.push(scoreItem(entry, preferences, item));
  }

  const chosen = selectItems({
    scored,
    kind: pass.kind,
    floor: VOICE_LIMITS.items.floor,
    cap: capFor(pass.kind),
    weights: preferences.weights,
  });
  for (const d of chosen.dropped) drop(d.id, "select", `${d.reason} (score ${d.score})`);

  /** Persist the pass's outputs and the stage marker. `survivors` empty means "nothing". */
  const finish = async (
    survivors: Array<{
      id: string;
      category: Selection["items"][number]["category"];
      score: number;
    }>,
    texts: Map<string, { headline: string; summary: string; why: string }>,
    entries: WrittenFile["items"],
    materials: MaterialsFile["items"],
  ): Promise<PassResult> => {
    const selection: Selection =
      survivors.length === 0
        ? nothingSelection(pass)
        : {
            ...nothingSelection(pass),
            outcome: "selected",
            items: survivors.map((s) => ({
              ...s,
              ...(texts.get(s.id) as { headline: string; summary: string; why: string }),
            })),
          };
    await writeJson(file("selection.json"), selection);
    await writeJson(file("written.json"), { version: 1, items: entries, dropped });
    await writeJson(file("materials.json"), { version: 1, items: materials });
    const outcome = survivors.length === 0 ? "nothing" : "selected";
    await markStage(deps.root, pass, "write", { at: deps.now().toISOString(), outcome });
    return {
      kept: survivors.map((s) => s.id),
      report: {
        id: pass.id,
        kind: pass.kind,
        outcome,
        qualifying: chosen.qualifying,
        selected: chosen.selected.length,
        written: entries.length,
        items: survivors.length,
      },
    };
  };

  if (chosen.outcome === "nothing") {
    deps.log.info("Nothing cleared the bar", { pass: pass.id, qualifying: chosen.qualifying });
    return finish([], new Map(), [], []);
  }

  // A finalist with no readable source cannot be written, so it drops.
  const extracted = await mapConcurrent(chosen.selected, EXTRACT_CONCURRENCY, async (sel) => ({
    sel,
    text: await extractSafely(runtime, sel.item),
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
      source: sourceNames[sel.item.source_id] ?? sel.item.source_id,
      ...(sel.item.author ? { author: sel.item.author } : {}),
      category: sel.category,
      text: text.text,
    });
  }

  const writeResult = await runtime.writer.write([...materials.values()]);
  for (const failure of writeResult.failed) drop(failure.id, "write", failure.reason);
  const voice = await enforceVoice({
    written: writeResult.written,
    materials,
    writer: runtime.writer,
    linter,
  });
  for (const d of voice.dropped) {
    drop(d.id, "voice", d.violations.map((v) => v.message).join(" ") || "no source material");
  }

  const keptIds = new Set(voice.passed.map((p) => p.item.id));
  const survivors = assignSections(chosen.selected.filter((sel) => keptIds.has(sel.item.id)));
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
  const texts = new Map(
    voice.passed.map((p) => [
      p.item.id,
      { headline: p.item.headline, summary: p.item.summary, why: p.item.why },
    ]),
  );
  const entries: WrittenFile["items"] = survivors.map((sel) => {
    const text = texts.get(sel.item.id) as { headline: string; summary: string; why: string };
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

async function extractSafely(runtime: ApiRuntime, item: Item): Promise<ExtractedText | null> {
  try {
    return await runtime.extract(item);
  } catch {
    return null;
  }
}
