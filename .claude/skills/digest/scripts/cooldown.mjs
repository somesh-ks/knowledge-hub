#!/usr/bin/env node
// Decides whether a new on-demand dispatch of run.yml may start. Reads the JSON that
//   gh run list -R somesh-ks/knowledge-hub --workflow run.yml --branch main --limit 30 \
//     --json databaseId,status,conclusion,createdAt,event,url
// prints on stdin, applies the same limits as the site's Generate button
// (apps/web/src/server/limits.ts), and prints one line.
//
// Usage: gh run list ... | node cooldown.mjs [--in-progress-only] [--now <iso>]
// Exit codes: 0 clear, 3 refused (reason on stdout), 2 usage error or unreadable input.

import { readFileSync } from "node:fs";

const HOUR = 3_600_000;
const COOLDOWN_MS = 6 * HOUR; // one workflow_dispatch run per 6 hours
const DAY_MS = 24 * HOUR;
const DAILY_CAP = 3; // three per 24 hours
const STALE_IN_PROGRESS_MS = 12 * HOUR; // an older "running" run is a stuck record, not a live run
const MAX_RUNS = 30;
const LIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

function fail(message) {
  console.error(`cooldown: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { inProgressOnly: false, now: Date.now() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--in-progress-only") options.inProgressOnly = true;
    else if (arg === "--now") {
      options.now = Date.parse(argv[i + 1] ?? "");
      i += 1;
      if (Number.isNaN(options.now)) fail("--now needs an ISO date-time");
    } else fail(`unknown argument ${arg}`);
  }
  return options;
}

function readRuns() {
  if (process.stdin.isTTY) fail("pipe the output of gh run list --json into this script");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    fail("stdin is empty or not JSON; is gh installed and logged in?");
  }
  if (!Array.isArray(parsed)) fail("expected a JSON array from gh run list");
  return parsed.slice(0, MAX_RUNS).flatMap((run) => {
    const created = Date.parse(run?.createdAt ?? "");
    return Number.isNaN(created) ? [] : [{ ...run, created }];
  });
}

function span(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function refuse(line) {
  console.log(line);
  process.exit(3);
}

const options = parseArgs(process.argv.slice(2));
const { now } = options;
const runs = readRuns();

const live = runs.find(
  (run) => LIVE.has(run.status) && now - run.created < STALE_IN_PROGRESS_MS,
);
if (live) {
  refuse(
    `in progress: run ${live.databaseId} started ${span(now - live.created)} ago ${live.url ?? ""}`.trim(),
  );
}
if (options.inProgressOnly) {
  console.log("clear: no run in progress");
  process.exit(0);
}

// Same arithmetic as evaluateLimits in apps/web/src/server/limits.ts.
const recent = runs
  .filter((run) => run.event === "workflow_dispatch" && now - run.created < DAY_MS)
  .map((run) => run.created)
  .sort((a, b) => a - b);
const newest = recent.at(-1);
const cooldownEnds = newest !== undefined && now - newest < COOLDOWN_MS ? newest + COOLDOWN_MS : 0;
const excess = recent.length - (DAILY_CAP - 1);
const capEnds = excess > 0 ? (recent[excess - 1] ?? 0) + DAY_MS : 0;
const releasedAt = Math.max(cooldownEnds, capEnds);

if (releasedAt === 0) {
  console.log(`clear: ${recent.length} of ${DAILY_CAP} dispatches used in the last 24 hours`);
  process.exit(0);
}
const wait = span(releasedAt - now);
if (capEnds > cooldownEnds) {
  refuse(`daily cap: ${recent.length} dispatches in the last 24 hours, next allowed in ${wait}`);
}
refuse(
  `cooldown: last dispatch ${span(now - (newest ?? now))} ago, one per 6 hours, next allowed in ${wait}`,
);
