#!/usr/bin/env node
// Builds a minimal preferences patch for `singularity learn --apply` from explicit edits, keeps it
// inside the learn bounds, and writes it to the OS temp directory (never into the repository).
// The CLI stays the authority: `learn --apply <patch> --dry-run` shows what will really change.
//
// Usage:
//   node make-patch.mjs --input "<sentence>" [--weight <category>=<+/-delta>]...
//     [--add-keyword <text>]... [--remove-keyword <text>]... [--add-author <text>]...
//     [--remove-author <text>]... [--add-disliked <text>]... [--remove-disliked <text>]...
//     [--prefs <path>] [--out <path>]
// Weights apply in the order given, so list the most important first.
// Exit codes: 0 patch written, 1 nothing left to change (no file written), 2 usage error.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Mirrors LEARN_LIMITS (core, preferences.ts) and the patch schema (engine, learn/patch.ts).
// If those change, change these constants with them.
const STOPS = [0, 0.5, 0.7, 0.85, 0.95]; // Off, Less, Normal, More, Most
const MAX_MOVES = 3;
const MAX_INPUT = 500;
const MAX_LIST = 10;

// name, field in preferences.json, patch field suffix, longest entry
const LISTS = [
  { name: "keyword", field: "preferred_keywords", suffix: "keywords", maxText: 60 },
  { name: "author", field: "preferred_authors", suffix: "authors", maxText: 60 },
  { name: "disliked", field: "disliked_patterns", suffix: "disliked", maxText: 80 },
];
// Adding to one of these when the other holds the same text is a contradiction.
const OPPOSITE = { keyword: "disliked_patterns", disliked: "preferred_keywords" };
const MAX_NOTES = 20;

const notes = [];
const note = (line) => {
  if (notes.length < MAX_NOTES) notes.push(line);
};

function fail(message) {
  console.error(`make-patch: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { input: undefined, weights: [], edits: {}, prefs: "config/preferences.json" };
  for (const { name } of LISTS) options.edits[`add-${name}`] = [];
  for (const { name } of LISTS) options.edits[`remove-${name}`] = [];
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag?.startsWith("--") || value === undefined) fail(`${flag ?? "argument"} needs a value`);
    const key = flag.slice(2);
    if (key === "input") options.input = value.trim();
    else if (key === "prefs") options.prefs = value;
    else if (key === "out") options.out = value;
    else if (key === "weight") {
      const [category, raw] = value.split("=");
      const delta = Number(raw);
      if (!category || !raw || !Number.isFinite(delta)) {
        fail(`--weight needs <category>=<number>, got "${value}"`);
      }
      options.weights.push([category, delta]);
    } else if (key in options.edits) options.edits[key].push(value.trim());
    else fail(`unknown argument ${flag}`);
  }
  if (!options.input) fail("--input needs the user's sentence");
  if (options.input.length > MAX_INPUT) fail(`--input is over ${MAX_INPUT} characters`);
  return options;
}

const round2 = (n) => Math.round(n * 100) / 100;
const truncate2 = (n) => (Math.sign(n) * Math.floor(Math.abs(n) * 100 + 1e-9)) / 100;
const signed = (n) => `${n > 0 ? "+" : ""}${n.toFixed(2)}`;
const norm = (text) => text.trim().toLowerCase();

const options = parseArgs(process.argv.slice(2));
let prefs;
try {
  prefs = JSON.parse(readFileSync(resolve(options.prefs), "utf8"));
} catch {
  fail(`cannot read ${options.prefs}; run from the repository root or pass --prefs`);
}

// Weights: validate, then move each one whole stop in the direction of its sign, up to MAX_MOVES.
const nearest = (w) => STOPS.reduce((best, stop, i) => (Math.abs(stop - w) < Math.abs(STOPS[best] - w) ? i : best), 0);
const weightDeltas = {};
for (const [category, wanted] of options.weights) {
  const before = prefs.weights?.[category];
  if (typeof before !== "number") {
    fail(`unknown category "${category}"; use a key of weights in ${options.prefs}`);
  }
  if (category in weightDeltas) fail(`--weight ${category} given twice`);
  const direction = Math.sign(wanted);
  const at = nearest(before);
  if (direction === 0 || STOPS[at + direction] === undefined) {
    note(`skipped: ${category} cannot move from ${before}`);
    continue;
  }
  if (Object.keys(weightDeltas).length >= MAX_MOVES) {
    note(`deferred: ${category}, ${MAX_MOVES} moves per call`);
    continue;
  }
  weightDeltas[category] = direction;
}

// Lists: drop no-ops and contradictions, enforce the CLI's length and size limits.
const patch = { input: options.input, weight_deltas: weightDeltas };
let listEdits = 0;
for (const { name, field, suffix, maxText } of LISTS) {
  const have = new Set((prefs[field] ?? []).map(norm));
  const opposite = new Set((OPPOSITE[name] ? (prefs[OPPOSITE[name]] ?? []) : []).map(norm));
  const removing = options.edits[`remove-${name}`];
  const add = [];
  for (const text of options.edits[`add-${name}`]) {
    if (removing.some((entry) => norm(entry) === norm(text))) fail(`"${text}" is both added and removed`);
    if (have.has(norm(text))) note(`skipped: ${name} "${text}" is already present`);
    else if (text.length > maxText) note(`skipped: ${name} "${text.slice(0, 20)}..." is over ${maxText} characters`);
    else if (opposite.has(norm(text))) note(`skipped: ${name} "${text}" contradicts an existing entry, remove that first`);
    else add.push(text);
  }
  const remove = removing.filter((text) => {
    if (!have.has(norm(text))) note(`skipped: ${name} "${text}" is not present, nothing to remove`);
    return have.has(norm(text));
  });
  if (add.length > MAX_LIST || remove.length > MAX_LIST) note(`deferred: ${name} edits past ${MAX_LIST} per list`);
  patch[`add_${suffix}`] = add.slice(0, MAX_LIST);
  patch[`remove_${suffix}`] = remove.slice(0, MAX_LIST);
  listEdits += patch[`add_${suffix}`].length + patch[`remove_${suffix}`].length;
}

for (const line of notes) console.log(line);
if (Object.keys(weightDeltas).length + listEdits === 0) {
  console.log("nothing left to change: every requested edit was skipped or already in place");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const out = resolve(options.out ?? join(tmpdir(), `singularity-learn-${stamp}.json`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(patch, null, 2)}\n`, "utf8");
const moved = Object.entries(weightDeltas).map(([category, d]) => `${category} ${d > 0 ? "up" : "down"} one stop`);
console.log(`weights: ${moved.join(", ") || "none"} (${moved.length} of ${MAX_MOVES} moves)`);
console.log(`patch: ${out}`);
