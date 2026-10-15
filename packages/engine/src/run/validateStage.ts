import { VOICE_LIMITS, withGeneralTopics } from "@dispatch/core";
import { linkSourceIds, loadSources, sourceNameMap } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import { Selection, WrittenFile } from "../curate/selectionFile.js";
import { readLastRun } from "../state/store.js";
import { loadTopicsFile } from "../topics/store.js";
import { type GroundedItem, groundAndRepair } from "../validate/groundingRepair.js";
import { validateDigest } from "../validate/validateDigest.js";
import { createLinter } from "../voice/lint.js";
import { loadVoice } from "../voice/voice.js";
import { writtenText } from "../write/text.js";
import type { SourceMaterial } from "../write/types.js";
import { MaterialsFile, readArtifact } from "./artifacts.js";
import { makeCoverPicker } from "./cover.js";
import { digestFromSelection } from "./digestFromSelection.js";
import { StageFailure } from "./errors.js";
import { loadPassPool } from "./passPool.js";
import { markStage, type Plan, passFile, requireStage } from "./plan.js";
import { sparesOverLength } from "./scheduleSize.js";
import type { PassReport, RunDeps, StageReport } from "./types.js";

type SelectionItem = Selection["items"][number];

interface ValidateDrop {
  id: string;
  reason: string;
}

/**
 * The grounding check and the final validation. Every summary sentence (and a why sentence, when
 * an item has one) is checked against its source text with Jev; an unsupported sentence gets one rewrite and one more check,
 * then the item drops. `verified` is true only when the grounder ran and every kept item passed
 * every check; without a Jev key the digest is kept and marked unverified. The surviving items
 * are then rendered as a digest and run through `validateDigest`: any item with an error drops,
 * and the floor of three is checked again, so the commit stage only ever sees a publishable
 * selection.
 */
export async function validateStage(deps: RunDeps, plan: Plan): Promise<StageReport> {
  const runtime = await deps.runtime();
  const linter = createLinter(await loadVoice(deps.root));
  const [sources, lastRun] = await Promise.all([loadSources(deps.root), readLastRun(deps.root)]);
  const sourceNames = sourceNameMap(sources);
  const topics = withGeneralTopics(await loadTopicsFile(deps.root));
  const coverPicker = makeCoverPicker(deps.pickCover, lastRun.last_cover);
  if (runtime.grounder === null) {
    deps.log.warn("No grounding check ran: the digest will be marked unverified");
  }

  const passes: PassReport[] = [];
  for (const pass of plan.passes) {
    const state = await requireStage(deps.root, pass, "write", "validating");
    const file = (name: string): string => passFile(deps.root, pass.id, name);
    const at = deps.now().toISOString();
    if (state.write?.outcome === "nothing") {
      await markStage(deps.root, pass, "validate", {
        at,
        outcome: "nothing",
        verified: false,
        items: 0,
      });
      passes.push({ id: pass.id, kind: pass.kind, outcome: "nothing", verified: false, items: 0 });
      continue;
    }

    const selection = await readArtifact(file("selection.json"), "selection.json", Selection);
    const written = await readArtifact(file("written.json"), "written.json", WrittenFile);
    const materialsFile = await readArtifact(
      file("materials.json"),
      "materials.json",
      MaterialsFile,
    );
    const pool = await loadPassPool(file("pool.json"), file("general.json"));
    const materials = new Map<string, SourceMaterial>(materialsFile.items.map((m) => [m.id, m]));
    const entryOf = new Map<string, SelectionItem>(selection.items.map((e) => [e.id, e]));
    const asSelection = (items: readonly GroundedItem[]): Selection => ({
      ...selection,
      items: items.map((g) => {
        const { why: _why, ...entry } = entryOf.get(g.item.id) as SelectionItem;
        return { ...entry, ...writtenText(g.item) };
      }),
    });

    const grounding = await groundAndRepair({
      grounder: runtime.grounder,
      writer: runtime.writer,
      linter,
      items: selection.items.map((entry) => ({ id: entry.id, ...writtenText(entry) })),
      materials,
    });

    // validateDigest catches what the earlier stages cannot see in isolation. An error tied to an
    // item drops that item; an error about the digest as a whole fails the stage.
    let survivors: GroundedItem[] = grounding.kept;
    const validateDrops: ValidateDrop[] = [];
    let warnings = 0;
    while (survivors.length >= VOICE_LIMITS.items.floor) {
      const digest = digestFromSelection({
        selection: asSelection(survivors),
        pool: pool.items,
        sourceNames,
        linkSources: linkSourceIds(sources),
        now: deps.now(),
        coverPicker,
        allocateId: () => pass.id,
        verified: false,
        topics,
      });
      // Selection already held the pass to its length or its kind's cap, and this digest holds
      // only what selection chose, so the count check here is the digest's hard cap.
      const report = validateDigest(digest, {
        pool: pool.items,
        sources,
        linter,
        topics,
        cap: VOICE_LIMITS.items.hardMax,
      });
      warnings = report.warnings;
      const general = report.issues.find((i) => i.severity === "error" && !i.itemId);
      if (general) {
        throw new StageFailure(`${pass.id}: the digest fails validation: ${general.message}`);
      }
      const bad = new Map<string, string[]>();
      for (const issue of report.issues) {
        if (issue.severity === "error" && issue.itemId) {
          bad.set(issue.itemId, [...(bad.get(issue.itemId) ?? []), issue.message]);
        }
      }
      if (bad.size === 0) break;
      for (const [id, messages] of bad) validateDrops.push({ id, reason: messages.join(" ") });
      survivors = survivors.filter((g) => !bad.has(g.item.id));
    }

    // A briefing sized by the owner's length wrote spares: air the best `wanted` of the survivors.
    const spare = new Set(
      selection.wanted === undefined
        ? []
        : sparesOverLength(
            survivors.map((g) => entryOf.get(g.item.id) as SelectionItem),
            selection.wanted,
          ),
    );
    survivors = survivors.filter((g) => !spare.has(g.item.id));

    const outcome = survivors.length < VOICE_LIMITS.items.floor ? "nothing" : "selected";
    const finalists = outcome === "nothing" ? [] : survivors;
    const verified = finalists.length > 0 && finalists.every((g) => g.verified);

    await writeJson(
      file("selection.json"),
      outcome === "nothing"
        ? { ...selection, outcome: "nothing", verified: false, items: [] }
        : { ...asSelection(finalists), outcome: "selected", verified },
    );
    const rewritten = updatedWritten(written, finalists, grounding.dropped);
    await writeJson(file("written.json"), {
      ...rewritten,
      dropped: [
        ...rewritten.dropped,
        ...[...spare].map((id) => ({
          id,
          stage: "select" as const,
          reason: "a spare the briefing's length did not need",
        })),
      ],
    });
    await writeJson(file("validate-report.json"), {
      version: 1,
      id: pass.id,
      grounder: runtime.grounder !== null,
      verified,
      kept: finalists.length,
      grounding_dropped: grounding.dropped.length,
      validate_dropped: validateDrops,
      spares_unaired: [...spare],
      warnings,
    });
    await markStage(deps.root, pass, "validate", {
      at,
      outcome,
      verified,
      items: finalists.length,
    });
    if (outcome === "nothing")
      deps.log.info("Too few items survived validation", { pass: pass.id });
    passes.push({
      id: pass.id,
      kind: pass.kind,
      outcome,
      verified,
      items: finalists.length,
      grounding_dropped: grounding.dropped.length,
      validate_dropped: validateDrops.length,
    });
  }
  return { stage: "validate", ok: true, dry_run: plan.dry_run, passes };
}

/** written.json after grounding: final text, check results, and the items grounding dropped. */
function updatedWritten(
  written: WrittenFile,
  finalists: readonly GroundedItem[],
  dropped: Awaited<ReturnType<typeof groundAndRepair>>["dropped"],
): WrittenFile {
  const before = new Map(written.items.map((entry) => [entry.id, entry]));
  return {
    version: 1,
    items: finalists.map((g) => {
      const previous = before.get(g.item.id);
      return {
        id: g.item.id,
        ...writtenText(g.item),
        ...(previous?.extract_method ? { extract_method: previous.extract_method } : {}),
        rewritten_fields: [...(previous?.rewritten_fields ?? []), ...g.rewrittenFields],
        verified: g.verified,
        grounding: g.checks.map((c) => ({
          field: c.field,
          sentence: c.sentence,
          score: c.score,
          status: c.status,
        })),
      };
    }),
    dropped: [
      ...written.dropped,
      ...dropped.map((d) => ({
        id: d.id,
        stage: "grounding" as const,
        reason:
          d.reason === "voice"
            ? d.violations.map((v) => v.message).join(" ")
            : `unsupported: ${d.unsupported.map((s) => `"${s.sentence}"`).join(", ")}`,
      })),
    ],
  };
}
