#!/usr/bin/env node
/**
 * Production smoke run for live content (plan section 20, criterion 10).
 *
 * Does a create, a regenerate and a delete of one throwaway test episode through the real
 * /api/podcast route, checks each surface after each step, cleans up, and confirms /build.json is
 * unchanged, so no step needed a deploy.
 *
 * The OWNER runs it, on demand, after a merge. Never in CI, never by an agent.
 *
 * Usage:
 *   node scripts/smokeLive.mjs --create-body smoke-body.json            dry run (the default)
 *   node scripts/smokeLive.mjs --create-body smoke-body.json --apply    does it against production
 *
 * Options:
 *   --site <url>         the site (default https://news.someshks.work)
 *   --create-body <file> JSON for the create request: the same body the Create sheet posts to
 *                        /api/podcast for a short Catch up episode on a throwaway topic
 *   --apply              really send the requests; without it the plan is only printed
 *   --wait <seconds>     how long to wait for each step to show (default 600)
 *
 * Exit 0 when every check passed, 1 otherwise. A failure still tries to delete the test episode.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const SITE = value("--site", "https://news.someshks.work").replace(/\/$/, "");
const APPLY = flag("--apply");
const WAIT_MS = Number(value("--wait", "600")) * 1000;
const bodyFile = value("--create-body", "");

const PLAN = [
  "1. GET /build.json and keep it.",
  "2. POST /api/podcast with --create-body; wait until /latest.json or the Library names the new episode.",
  "3. Check /e/<id> opens, the Library lists it, and its cover and audio URLs carry a version.",
  "4. POST /api/podcast {action: regenerate, id}; wait until its audio URL changes; check the id is unchanged.",
  "5. POST /api/podcast {action: delete, id}; within 60 s check /e/<id> says it was removed (404) and the Library no longer lists it.",
  "6. GET /build.json again and compare with step 1: it must be identical (no deploy happened).",
];

if (!APPLY) {
  console.log(`smokeLive (dry run) against ${SITE}. Nothing is sent. With --apply it would:`);
  for (const line of PLAN) console.log(`  ${line}`);
  process.exit(0);
}
if (!bodyFile) {
  console.error("smokeLive: --create-body <file> is required with --apply");
  process.exit(1);
}

const createBody = JSON.parse(readFileSync(bodyFile, "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function post(body) {
  const response = await fetch(`${SITE}/api/podcast`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const text = async (path) => {
  const response = await fetch(`${SITE}${path}?smoke=${Date.now()}`, { cache: "no-store" });
  return { status: response.status, body: await response.text() };
};
async function until(label, probe) {
  const limit = Date.now() + WAIT_MS;
  while (Date.now() < limit) {
    const found = await probe().catch(() => null);
    if (found) return found;
    await sleep(10_000);
  }
  check(label, false, "timed out");
  return null;
}

let id = null;
const buildBefore = await text("/build.json");
try {
  // Read before the create request, so a fast episode cannot already be in the baseline.
  const before = new Set((await text("/library")).body.match(/\/e\/ep-[\w-]+/g) ?? []);
  const created = await post(createBody);
  check(
    "create accepted",
    created.status === 200 || created.status === 202,
    `status ${created.status}`,
  );
  const fresh = await until("new episode reaches the Library", async () => {
    const found = ((await text("/library")).body.match(/\/e\/ep-[\w-]+/g) ?? []).find(
      (href) => !before.has(href),
    );
    return found ?? null;
  });
  if (fresh) {
    id = fresh.replace("/e/", "");
    const page = await text(`/e/${id}`);
    check("episode page opens", page.status === 200);
    const versions = page.body.match(/covers\/[\w-]+-512\.webp\?v=\w+/g) ?? [];
    check("cover address is versioned", versions.length > 0);
    const audioOf = (html) => (html.match(/https:[^"'\s]+\/audio\/[^"'\s]+\.mp3/) ?? [])[0] ?? null;
    const audioBefore = audioOf(page.body);

    const again = await post({ action: "regenerate", id });
    check(
      "regenerate accepted",
      again.status === 200 || again.status === 202,
      `status ${again.status}`,
    );
    const changed = await until("regenerated audio has a new URL", async () => {
      const now = audioOf((await text(`/e/${id}`)).body);
      return now && now !== audioBefore ? now : null;
    });
    check("regenerated episode keeps its id and URL", changed !== null || audioBefore === null);
  }
} finally {
  if (id) {
    const removed = await post({ action: "delete", id });
    check(
      "delete accepted",
      removed.status === 200 || removed.status === 202,
      `status ${removed.status}`,
    );
    await sleep(60_000);
    check("removed episode page says so", (await text(`/e/${id}`)).status === 404);
    check("Library no longer lists it", !(await text("/library")).body.includes(`/e/${id}`));
  }
  const buildAfter = await text("/build.json");
  check(
    "/build.json unchanged (no deploy)",
    buildBefore.status === 200 && buildAfter.status === 200 && buildAfter.body === buildBefore.body,
  );
}
process.exit(results.every(Boolean) ? 0 : 1);
