// The record's guard: budgets, links, the decisions Index and closure conditions, so the docs an agent
// reads first stay small and true without anyone remembering to keep them so.
//
// Usage: node scripts/docsCheck.mjs [--warn]   (--warn prints the problems and exits 0)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Bytes. Read-first is what every session reads: AGENTS.md and state.md.
export const BUDGETS = {
  "AGENTS.md": 7_000,
  "docs/state.md": 12_000,
  "docs/learnings.md": 25_000,
  "docs/specs/README.md": 4_000,
};
export const SPEC_BUDGET = 8_000;
// What every session reads: AGENTS.md and state.md. The Index is searched, never read whole, so it has
// a budget of its own (D283).
export const READ_FIRST_BUDGET = 20_000;
export const INDEX_BUDGET = 40_000;
// Folders with an index of their own, left out of the docs README check.
const OWN_INDEX = ["decisions/", "history/", "ledger/", "prototype/", "specs/"];

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return markdownFiles(full);
    return name.endsWith(".md") ? [full] : [];
  });
}

export function decisionsIndex(text) {
  const start = text.indexOf("## Index");
  const end = text.indexOf("\n## D", start);
  return start < 0 ? "" : text.slice(start, end < 0 ? undefined : end);
}

export function checkDocs(root) {
  const fails = [];
  const at = (rel) => join(root, rel);
  const size = (rel) => Buffer.byteLength(read(at(rel)));

  for (const [rel, max] of Object.entries(BUDGETS)) {
    if (existsSync(at(rel)) && size(rel) > max)
      fails.push(`${rel}: ${size(rel)} bytes, budget ${max}`);
  }
  for (const file of markdownFiles(at("docs/specs"))) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (rel !== "docs/specs/README.md" && size(rel) > SPEC_BUDGET) {
      fails.push(`${rel}: ${size(rel)} bytes, budget ${SPEC_BUDGET}`);
    }
  }

  // The Index lives in docs/decisions/README.md; the entries are spread over the area files beside it.
  const decisionsDir = at("docs/decisions");
  const readmePath = join(decisionsDir, "README.md");
  const index = existsSync(readmePath) ? decisionsIndex(read(readmePath)) : "";
  const entryFiles = markdownFiles(decisionsDir).filter((file) => file !== readmePath);
  const decisions = entryFiles.map(read).join("\n");
  const readFirst = ["AGENTS.md", "docs/state.md"]
    .filter((rel) => existsSync(at(rel)))
    .reduce((sum, rel) => sum + size(rel), 0);
  if (readFirst > READ_FIRST_BUDGET)
    fails.push(`read-first: ${readFirst} bytes, budget ${READ_FIRST_BUDGET}`);
  if (Buffer.byteLength(index) > INDEX_BUDGET)
    fails.push(`decisions Index: ${Buffer.byteLength(index)} bytes, budget ${INDEX_BUDGET}`);

  // Every Index row has an entry and every entry a row; a supersession names a decision that exists.
  const rows = new Set([...index.matchAll(/^\| (D\d+) \|/gm)].map((m) => m[1]));
  const entries = new Set([...decisions.matchAll(/^## (D\d+):/gm)].map((m) => m[1]));
  for (const id of rows)
    if (!entries.has(id)) fails.push(`docs/decisions/README.md: Index row ${id} has no entry`);
  for (const id of entries)
    if (!rows.has(id)) fails.push(`docs/decisions/README.md: ${id} has no Index row`);
  const superseded = new Map(
    [...`${index}\n${decisions}`.matchAll(/superseded by (D\d+)/gi)].map((m) => [m[0], m[1]]),
  );
  for (const [phrase, id] of superseded) {
    if (!entries.has(id))
      fails.push(`docs/decisions: "${phrase}" names a decision that does not exist`);
  }

  // A row that "replaces Dn" retires Dn: agents grep the status column, so Dn must say it is superseded.
  // The text before the status column is the description, which may say "superseded" about a part.
  const rowText = new Map([...index.matchAll(/^\| (D\d+) \|(.*)$/gm)].map((m) => [m[1], m[2]]));
  const statusOf = (text) => text.slice(text.lastIndexOf("|", text.length - 2) + 1);
  for (const [id, text] of rowText) {
    for (const phrase of statusOf(text).matchAll(/replaces ((?:D\d+(?:, and |, | and )?)+)/gi)) {
      for (const old of phrase[1].match(/D\d+/g) ?? []) {
        if (!rowText.has(old) && !entries.has(old)) {
          fails.push(`docs/decisions/README.md: ${id} replaces ${old}, which does not exist`);
        } else if (
          rowText.has(old) &&
          !/^\s*superseded by\b/i.test(statusOf(rowText.get(old) ?? ""))
        ) {
          fails.push(
            `docs/decisions/README.md: ${id} replaces ${old}, but ${old}'s row is not "superseded by ${id}"`,
          );
        }
      }
    }
  }

  // An open item says what closes it, so a stale note can be told from a real question.
  if (existsSync(at("docs/state.md"))) {
    const state = read(at("docs/state.md"));
    const section = state.match(/^## [^\n]*unverified[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/im);
    for (const line of (section?.[1] ?? "").split("\n")) {
      if (line.startsWith("- ") && !/closed when:/i.test(line)) {
        fails.push(`docs/state.md: unverified item without "closed when:": ${line.slice(2, 70)}`);
      }
    }
  }

  const docs = markdownFiles(at("docs"));
  for (const file of [at("AGENTS.md"), ...docs].filter(existsSync)) {
    const text = read(file)
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]*`/g, "");
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = decodeURIComponent(m[1].split("#")[0]);
      if (!target || /^[a-z]+:/i.test(target)) continue;
      if (!existsSync(resolve(dirname(file), target))) {
        fails.push(`${relative(root, file).replace(/\\/g, "/")}: broken link ${m[1]}`);
      }
    }
  }

  // A doc that names a repo file in backticks goes stale silently when the file moves, so the read-first docs
  // and the specs must name only files that exist (history notes are a record and may name gone files).
  const named = ["AGENTS.md", "docs/state.md", "docs/learnings.md"]
    .map(at)
    .concat(markdownFiles(at("docs/specs")));
  // The owner's config is in the config store, not in git (D296): its paths are named, never present.
  const configPaths = (() => {
    const source = at("packages/engine/src/store/configPaths.ts");
    if (!existsSync(source)) return new Set();
    const block = read(source).match(/CONFIG_DOCUMENT_PATHS = \[([\s\S]*?)\] as const/);
    return new Set([...(block?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((each) => each[1]));
  })();
  for (const file of named.filter(existsSync)) {
    for (const m of read(file).matchAll(
      /`((?:apps|packages|scripts|docs|config|\.github|\.claude)\/[\w./-]+\.\w+)`/g,
    )) {
      if (!existsSync(at(m[1])) && !configPaths.has(m[1]))
        fails.push(`${relative(root, file).replace(/\\/g, "/")}: names a missing file ${m[1]}`);
    }
  }

  if (existsSync(at("docs/README.md"))) {
    const map = read(at("docs/README.md"));
    for (const file of docs) {
      const rel = relative(at("docs"), file).replace(/\\/g, "/");
      if (rel === "README.md" || OWN_INDEX.some((dir) => rel.startsWith(dir))) continue;
      if (!map.includes(`(${rel})`)) fails.push(`docs/README.md: does not list ${rel}`);
    }
  }

  return { fails, readFirst };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { fails, readFirst } = checkDocs(root);
  for (const fail of fails) console.log(`FAIL  ${fail}`);
  console.log(
    `read-first: ${(readFirst / 1000).toFixed(1)} KB, about ${Math.round(readFirst / 4000)}k tokens (budget ${READ_FIRST_BUDGET / 1000} KB)`,
  );
  console.log(fails.length ? `docs check: ${fails.length} problem(s)` : "docs check passed");
  process.exit(fails.length && !process.argv.includes("--warn") ? 1 : 0);
}
