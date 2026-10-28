import { STAGES } from "./types.js";

export const RUN_USAGE = `Usage: singularity run [--mode scheduled|on-demand|weekly] [--force] [--since <iso>]
                    [--dry-run] [--no-push] [--feedback <text>] [--topics <ids>] [--replace <id>] [--length <minutes>] [--delete <id>] [--record-failed] [--stage ${STAGES.join("|")}] [--run <id>]

Runs the pipeline: gate, fetch, judge, write, validate, commit. With --stage it runs one stage,
as a workflow step does; stages hand work to each other through .cache/run/. Without it every
stage runs in order and stops cleanly when the gate says nothing is due.

  --mode      scheduled (default) obeys the every-second-day gate and adds the weekly pass on
              Sundays; on-demand ignores the gate and never shifts the regular cadence; weekly
              runs the weekly pass alone.
  --force     ignore the gate in scheduled mode.
  --since     start the fetch window at this ISO date or time (any pass).
  --dry-run   run every stage but write nothing under state/ or Digests/ and commit nothing; the
              digest preview lands in .cache/run/<id>/digest-preview.md.
  --no-push   commit locally and skip the push.
  --feedback  write stage: what to improve, 1 to 500 characters; the writer applies it to wording and
              emphasis only (Regenerate).
  --topics    write stage: comma-separated topic ids this run covers; every other topic is left out
              of this run only (Regenerate on a briefing). The saved schedule is not changed.
  --replace   gate: make digest <id> again over its own window and, once the new one is published,
              remove the old one in the same commit (Regenerate on a briefing).
  --length    gate: size this run to 3, 5, 10 or 15 minutes in place of the schedule's (Regenerate's
              Length); the plan keeps it for the stages after.
  --delete    remove digest <id> and its narration timeline in one commit; no stage runs.
  --record-failed
              the job died before the commit stage (run.yml): record "failed" in state/last-run.json
              for each kind the gate planned (or would plan), and commit it; never for a dry run, a
              replacement or an on-demand run. No stage runs.
  --run       commit stage only: adopt this agent-mode run directory (.cache/run/<id>).
  --json      print one JSON document on stdout. gate: { due, reason, mode, passes, dry_run };
              commit: { outcome, digests, deploy, items }; a failed stage: { outcome: "failed",
              stage, error }.

Exit codes: 0 published, nothing or gated; 1 a stage failed (state is untouched); 2 usage.

Agent mode (no model keys; a Claude Code session curates by hand):
  1. singularity fetch --json                       pool in .cache/run/<id>/pool.json
  2. singularity extract --ids <a,b,c>              full text for the items you want to write about
  3. write .cache/run/<id>/agent-selection.json  against the schema from the next command
  4. singularity curate --mode agent [--kind on-demand]
                                                 writes selection-schema.json first, then validates
                                                 your file; --kind on-demand keeps the regular cadence
  5. singularity run --stage commit                 builds the digest, updates state, commits and pushes
     (add --dry-run to preview, --no-push to keep the commit local)`;
