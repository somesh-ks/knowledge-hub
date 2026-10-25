import { type Digest, type Item, VOICE_LIMITS } from "@singularity/core";
import { buildSpokenText, SpokenTextTooLongError } from "../audio/spokenText.js";
import {
  linkSourceIds,
  loadPreferences,
  loadSources,
  readJsonIfExists,
  sourceNameMap,
} from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import { Selection, WrittenFile } from "../curate/selectionFile.js";
import { describeError } from "../llm/errors.js";
import { loadSectionPlan } from "../score/sectionPlan.js";
import { readLastRun } from "../state/store.js";
import { loadTopics } from "../topics/store.js";
import { type GroundedItem, groundAndRepair } from "../validate/groundingRepair.js";
import { validateDigest } from "../validate/validateDigest.js";
import { createLinter } from "../voice/lint.js";
import { loadVoice } from "../voice/voice.js";
import { writtenText } from "../write/text.js";
import type { SourceMaterial } from "../write/types.js";
import { MaterialsFile, ReserveFile, readArtifact } from "./artifacts.js";
import { makeCoverPicker } from "./cover.js";
import { digestFromSelection } from "./digestFromSelection.js";
import { StageFailure } from "./errors.js";
import { loadPassPool } from "./passPool.js";
import { markStage, type Plan, passFile, requireStage } from "./plan.js";
import { STORY_CHARS, sparesOverLength, toldChars, withSpares } from "./scheduleSize.js";
import type { PassReport, RunDeps, StageReport } from "./types.js";
import { writeFinalists } from "./writeStage.js";

type SelectionItem = Selection["items"][number];

/** The stories a pass airs after validation and the length trim, and their narration's length. */
interface Fitted {
  survivors: GroundedItem[];
  spare: Set<string>;
  /** Narration characters of `survivors`; 0 below the floor, where nothing airs. */
  chars: number;
}

/** The pass's reserve, or none: a pass written before reserves existed, or not sized. */
async function readReserve(path: string): Promise<ReserveFile> {
  const parsed = ReserveFile.safeParse(await readJsonIfExists(path, "reserve.json"));
  return parsed.success ? parsed.data : ReserveFile.parse({ version: 1, items: [] });
}

/** What the write stage records of a story beside its text, kept for a replacement too. */
type WrittenFacts = { extract_method?: string; rewritten_fields: string[] };

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
  const topics = await loadTopics(deps.root, await loadPreferences(deps.root));
  const coverPicker = makeCoverPicker(deps.pickCover, lastRun.last_cover);
  if (runtime.grounder === null) {
    deps.log.warn("No grounding check ran: the digest will be marked unverified");
  }

  // A story another pass of the run wrote never refills this one: the weekly of a Sunday run
  // shares the daily's pool.
  const takenElsewhere = new Set<string>();
  for (const pass of plan.passes) {
    const other = Selection.safeParse(
      await readJsonIfExists(passFile(deps.root, pass.id, "selection.json"), "selection.json"),
    );
    if (other.success) for (const entry of other.data.items) takenElsewhere.add(entry.id);
  }

  const passes: PassReport[] = [];
  for (const pass of plan.passes) {
    const state = await requireStage(deps.root, pass, "write", "validating");
    const file = (name: string): string => passFile(deps.root, pass.id, name);
    const at = deps.now().toISOString();
    const reserve = await readReserve(file("reserve.json"));
    // Writing can leave a sized pass under the floor; its reserve may still fill it. A re-run of
    // validate after that refill finds the refilled stories in the selection and checks them again.
    const unwritten =
      state.write?.outcome === "nothing" &&
      (await readJsonIfExists(file("selection.json"), "selection.json").then((raw) => {
        const saved = Selection.safeParse(raw).data;
        if (saved === undefined) return true;
        const refillable =
          !reserve.refilled && reserve.items.length > 0 && saved.length_chars !== undefined;
        return !refillable && saved.items.length === 0;
      }));
    if (unwritten) {
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
    const sectionPlan = await loadSectionPlan(deps.root, pass.kind);
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
    // A sized briefing writes spares past the digest's hard cap (WRITE_MAX), and a digest holds at
    // most that cap, so the loop validates the best stories that fit; one it drops makes room for
    // the next spare. What lies past the cap is a spare that could never air.
    const scoreOf = (g: GroundedItem): number => entryOf.get(g.item.id)?.score ?? 0;
    const validateDrops: ValidateDrop[] = [];
    let warnings = 0;
    const fit = (kept: readonly GroundedItem[]): Fitted => {
      let ranked: GroundedItem[] = [...kept].sort((a, b) => scoreOf(b) - scoreOf(a));
      let survivors: GroundedItem[] = ranked.slice(0, VOICE_LIMITS.items.hardMax);
      let validated: Digest | null = null;
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
          plan: sectionPlan,
        });
        // Selection already held the pass to its length or its kind's cap, and the window above
        // holds this digest to its hard cap, so the count check here is that cap.
        const report = validateDigest(digest, {
          pool: pool.items,
          sources,
          linter,
          topics,
          cap: VOICE_LIMITS.items.hardMax,
          plan: sectionPlan,
        });
        warnings = report.warnings;
        validated = digest;
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
        ranked = ranked.filter((g) => !bad.has(g.item.id));
        survivors = ranked.slice(0, VOICE_LIMITS.items.hardMax);
      }

      // A briefing sized by the owner's length wrote spares: air the best survivors that fill it.
      const measured = validated;
      const spare = new Set(
        selection.length_chars === undefined
          ? []
          : sparesOverLength(
              survivors.map((g) => ({
                ...(entryOf.get(g.item.id) as SelectionItem),
                chars: toldChars(writtenText(g.item)),
              })),
              selection.length_chars,
              VOICE_LIMITS.items.floor,
              // The narration these stories would make, as the audio stage builds it.
              measured === null ? undefined : (ids) => narrationLength(measured, ids),
            ),
      );
      for (const g of ranked.slice(VOICE_LIMITS.items.hardMax)) spare.add(g.item.id);
      const airing = survivors.filter((g) => !spare.has(g.item.id));
      const chars =
        measured === null || airing.length < VOICE_LIMITS.items.floor
          ? 0
          : narrationLength(measured, new Set(airing.map((g) => g.item.id)));
      return { survivors: airing, spare, chars };
    };

    let fitted = fit(grounding.kept);
    // Grounding and validation cut a sized briefing after its spares were counted: the 2026-10-24
    // daily wrote 14 for five minutes and aired 7 (3.0 minutes). One round writes replacements
    // from the stories selection would have taken next, then fits the briefing again. It is best
    // effort: a failure keeps the briefing that already validated.
    const refill: { written: number; kept: number; error?: string } = { written: 0, kept: 0 };
    const refillDrops: WrittenFile["dropped"] = [];
    const refillFacts = new Map<string, WrittenFacts>();
    let refillDone = false;
    const lengthChars = selection.length_chars;
    const room = VOICE_LIMITS.items.hardMax - fitted.survivors.length;
    if (lengthChars !== undefined && fitted.chars < lengthChars && room > 0 && !reserve.refilled) {
      const poolById = new Map(pool.items.map((item) => [item.id, item]));
      const missing = Math.ceil((lengthChars - fitted.chars) / STORY_CHARS);
      const candidates = reserve.items
        .filter((entry) => !takenElsewhere.has(entry.id) && poolById.has(entry.id))
        .slice(0, Math.min(withSpares(missing), room));
      if (candidates.length > 0) {
        // A refit that fails part way leaves its drops and warnings behind; the catch puts back
        // those of the briefing that stands.
        const dropsBefore = validateDrops.length;
        const warningsBefore = warnings;
        try {
          const {
            materials: fresh,
            methods,
            voice,
          } = await writeFinalists({
            runtime,
            linter,
            finalists: candidates.map((entry) => ({
              item: poolById.get(entry.id) as Item,
              category: entry.writer_category,
              prompt: sectionPlan.prompt(entry.section ?? entry.category),
            })),
            sourceNames,
            feedback: reserve.feedback,
            taste: reserve.taste,
            airing: fitted.survivors.map((g) => g.item.headline),
            drop: (id, stage, reason) => refillDrops.push({ id, stage, reason }),
          });
          for (const [id, material] of fresh) materials.set(id, material);
          for (const entry of candidates) {
            const passed = voice.passed.find((p) => p.item.id === entry.id);
            if (!passed) continue;
            entryOf.set(entry.id, {
              id: entry.id,
              category: entry.category,
              score: entry.score,
              ...writtenText(passed.item),
            });
            const method = methods.get(entry.id);
            refillFacts.set(entry.id, {
              ...(method ? { extract_method: method } : {}),
              rewritten_fields: passed.rewrittenFields,
            });
          }
          const extra = await groundAndRepair({
            grounder: runtime.grounder,
            writer: runtime.writer,
            linter,
            items: voice.passed.map((p) => p.item),
            materials,
          });
          const invalid = new Set(validateDrops.map((d) => d.id));
          const refitted = fit(
            [...grounding.kept, ...extra.kept].filter((g) => !invalid.has(g.item.id)),
          );
          grounding.kept.push(...extra.kept);
          grounding.dropped.push(...extra.dropped);
          fitted = refitted;
          const refilled = new Set(extra.kept.map((g) => g.item.id));
          refill.written = voice.passed.length;
          refill.kept = fitted.survivors.filter((g) => refilled.has(g.item.id)).length;
          refillDone = true;
          deps.log.info("Refilled the briefing after validation", { pass: pass.id, ...refill });
        } catch (error) {
          refill.error = describeError(error, deps.secrets);
          refillDrops.length = 0;
          refillFacts.clear();
          validateDrops.length = dropsBefore;
          warnings = warningsBefore;
          deps.log.warn("The refill failed; the validated stories stand", {
            pass: pass.id,
            reason: refill.error,
          });
        }
        // The replacements' source text is persisted with the rest, so a re-run of validate grounds
        // them against what they were written from.
        if (refillDone) {
          await writeJson(file("materials.json"), { version: 1, items: [...materials.values()] });
        }
      }
    }
    const { survivors, spare } = fitted;
    for (const g of survivors) takenElsewhere.add(g.item.id);

    const outcome = survivors.length < VOICE_LIMITS.items.floor ? "nothing" : "selected";
    const finalists = outcome === "nothing" ? [] : survivors;
    const verified = finalists.length > 0 && finalists.every((g) => g.verified);

    await writeJson(
      file("selection.json"),
      outcome === "nothing"
        ? { ...selection, outcome: "nothing", verified: false, items: [] }
        : { ...asSelection(finalists), outcome: "selected", verified },
    );
    const rewritten = updatedWritten(written, finalists, grounding.dropped, refillFacts);
    await writeJson(file("written.json"), {
      ...rewritten,
      dropped: [
        ...rewritten.dropped,
        ...refillDrops,
        ...[...spare].map((id) => ({
          id,
          stage: "select" as const,
          reason: "a spare the briefing's length did not need",
        })),
      ],
    });
    // Marked used last, once the selection holds the replacements: one round, and a run stopped
    // before this point refills again on a re-run.
    if (refillDone) await writeJson(file("reserve.json"), { ...reserve, refilled: true });
    await writeJson(file("validate-report.json"), {
      version: 1,
      id: pass.id,
      grounder: runtime.grounder !== null,
      verified,
      kept: finalists.length,
      grounding_dropped: grounding.dropped.length,
      validate_dropped: validateDrops,
      spares_unaired: [...spare],
      refill_written: refill.written,
      refill_kept: refill.kept,
      ...(refill.error ? { refill_error: refill.error } : {}),
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
      refill_written: refill.written,
      refill_kept: refill.kept,
      ...(refill.error ? { refill_error: refill.error } : {}),
    });
  }
  return { stage: "validate", ok: true, dry_run: plan.dry_run, passes };
}

/** written.json after grounding: final text, check results, and the items grounding dropped. */
function updatedWritten(
  written: WrittenFile,
  finalists: readonly GroundedItem[],
  dropped: Awaited<ReturnType<typeof groundAndRepair>>["dropped"],
  /** What the write stage would have recorded for each replacement validation wrote. */
  refilled: ReadonlyMap<string, WrittenFacts>,
): WrittenFile {
  const before = new Map<string, WrittenFacts>([
    ...written.items.map((entry) => [entry.id, entry] as const),
    ...refilled,
  ]);
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

/**
 * The length of the narration the audio stage would build from these stories of the digest. Past
 * the one-request limit buildSpokenText refuses, and its error carries the length: a weekly's
 * untrimmed spares can run past 19,000 characters before the trim brings them to the length.
 */
export function narrationLength(digest: Digest, ids: ReadonlySet<string>): number {
  try {
    return buildSpokenText({ ...digest, items: digest.items.filter((item) => ids.has(item.id)) })
      .text.length;
  } catch (error) {
    if (error instanceof SpokenTextTooLongError) return error.length;
    throw error;
  }
}
