import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { categoryIsOff, homeSectionFor, topicSectionTitles, zonedDate } from "@singularity/core";
import { type CommandRun, secretsFromEnv } from "../context.js";
import {
  linkSourceIds,
  loadLastRun,
  loadPool,
  loadSources,
  readJsonIfExists,
  sourceNameMap,
} from "../curate/inputs.js";
import { emit } from "../curate/output.js";
import { fromRoot, resolveRunLocation } from "../curate/runDir.js";
import { Selection } from "../curate/selectionFile.js";
import { describeError } from "../llm/errors.js";
import { buildDigest, type CoverPicker } from "../render/buildDigest.js";
import { createFallbackCoverPicker, loadCoverPalettes } from "../render/coverPicker.js";
import { createIdAllocator, listTakenIds } from "../render/digestId.js";
import { writeDigestFile } from "../render/writeDigestFile.js";
import { loadScheduleZone } from "../schedule/store.js";
import type { SelectedItem } from "../score/types.js";
import { loadTopics } from "../topics/store.js";
import { validateDigest } from "../validate/validateDigest.js";
import { createLinter } from "../voice/lint.js";
import { loadVoice } from "../voice/voice.js";
import { writtenText } from "../write/text.js";

export const RENDER_USAGE =
  "Usage: singularity render [--run <id>] [--selection <path>] [--pool <path>] [--dry-run]";

export interface RenderDeps {
  /** The cover package's picker. Defaults to a deterministic stand-in. */
  coverPicker?: CoverPicker;
}

/**
 * `singularity render`: turn a run's `selection.json` into `Digests/YYYY/MM/<id>.md`. It rebuilds
 * the items from the pool, assigns sections and Top picks, computes read and listen times,
 * validates the result with the same checks as `singularity validate`, and writes the file without
 * ever overwriting. The digest takes the id `singularity fetch` allocated for the run when it is
 * still free, otherwise the next free suffix. The audio script is built later by `singularity audio`
 * from the digest fields. Exit codes: 0 rendered or nothing to render, 1 failure, 2 usage error.
 */
export function makeRenderCommand(deps: RenderDeps = {}): CommandRun {
  return async (argv, ctx) => {
    let values: { run?: string; selection?: string; pool?: string; "dry-run"?: boolean };
    try {
      values = parseArgs({
        args: argv,
        allowPositionals: false,
        strict: true,
        options: {
          run: { type: "string" },
          selection: { type: "string" },
          pool: { type: "string" },
          "dry-run": { type: "boolean" },
        },
      }).values;
    } catch (error) {
      ctx.log.error(
        `${error instanceof Error ? error.message : "Invalid arguments."} ${RENDER_USAGE}`,
      );
      return 2;
    }

    try {
      const { root, log } = ctx;
      const now = ctx.now();
      // A selection path alone names the run: its folder holds the pool too.
      const location =
        values.selection && !values.run && !values.pool
          ? {
              runDir: dirname(fromRoot(root, values.selection)),
              poolPath: join(dirname(fromRoot(root, values.selection)), "pool.json"),
            }
          : await resolveRunLocation(
              root,
              { run: values.run, pool: values.pool },
              "selection.json",
            );
      const selectionPath = values.selection
        ? fromRoot(root, values.selection)
        : join(location.runDir, "selection.json");

      const rawSelection = await readJsonIfExists(selectionPath, "selection.json");
      if (rawSelection === null) {
        log.error(
          `selection.json not found at ${selectionPath}. Run \`singularity curate\` first.`,
        );
        return 1;
      }
      const parsed = Selection.safeParse(rawSelection);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        log.error(
          `selection.json is invalid: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim(),
        );
        return 1;
      }
      const selection = parsed.data;
      if (selection.outcome === "nothing" || selection.items.length === 0) {
        emit(ctx, ["Nothing cleared the bar."], { outcome: "nothing" });
        return 0;
      }

      const topics = await loadTopics(root);
      const loaded = await loadPool(location.poolPath);
      const pool = new Map(loaded.items.map((item) => [item.id, item]));
      const selected: SelectedItem[] = [];
      for (const entry of selection.items) {
        const item = pool.get(entry.id);
        if (!item) {
          log.error(
            `The selection names ${entry.id}, which is not in the pool at ${location.poolPath}.`,
          );
          return 1;
        }
        const home = homeSectionFor(topics, entry.category, item.source_type);
        if (home === null || categoryIsOff(topics, entry.category)) {
          log.error(`The category ${entry.category} of ${entry.id} never publishes.`);
          return 1;
        }
        selected.push({ item, category: entry.category, home, section: home, score: entry.score });
      }

      const sources = await loadSources(root);
      const linter = createLinter(await loadVoice(root));
      const lastRun = await loadLastRun(root);
      const coverPicker =
        deps.coverPicker ??
        createFallbackCoverPicker({
          palettes: await loadCoverPalettes(root),
          ...(lastRun.last_cover ? { last: lastRun.last_cover } : {}),
        });
      const preferredId = loaded.meta.id;
      const zone = await loadScheduleZone(root);
      const taken = await listTakenIds(root, (preferredId ?? zonedDate(now, zone)).slice(0, 10));

      const digest = buildDigest({
        zone,
        selected,
        written: selection.items.map((i) => ({ id: i.id, ...writtenText(i) })),
        window: selection.window,
        kind: selection.kind,
        now,
        coverPicker,
        allocateId: createIdAllocator(taken, preferredId),
        // Nothing an agent session wrote counts as grounded, whatever the file claims.
        verified: selection.mode === "agent" ? false : selection.verified,
        audio: null,
        sourceNames: sourceNameMap(sources),
        linkSources: linkSourceIds(sources),
        ...(topics ? { sectionTitles: topicSectionTitles(topics) } : {}),
      });

      const report = validateDigest(digest, { pool: [...pool.values()], sources, linter, topics });
      if (!report.ok) {
        log.error(`The digest failed validation with ${report.errors} errors; nothing was written`);
        emit(
          ctx,
          report.issues.map((i) => `${i.severity}: ${i.itemId ? `${i.itemId}: ` : ""}${i.message}`),
          { outcome: "invalid", issues: report.issues },
        );
        return 1;
      }

      const summary = {
        digest_id: digest.id,
        items: digest.items.length,
        read_minutes: digest.read_minutes,
        listen_minutes: digest.listen_minutes,
        verified: digest.verified,
      };
      if (values["dry-run"]) {
        emit(ctx, [`Dry run: ${digest.id}, ${summary.items} items. Nothing written.`], {
          outcome: "dry-run",
          ...summary,
        });
        return 0;
      }
      const written = await writeDigestFile(root, digest);
      emit(ctx, [`Wrote ${written.relPath} (${summary.items} items).`], {
        outcome: "rendered",
        path: written.relPath,
        ...summary,
      });
      return 0;
    } catch (error) {
      ctx.log.error(`render failed: ${describeError(error, secretsFromEnv(ctx.env))}`);
      return 1;
    }
  };
}

export const run: CommandRun = makeRenderCommand();
