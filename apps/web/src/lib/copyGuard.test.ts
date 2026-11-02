import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Bug this prevents (owner, 2026-11-02): a change made offline said "Couldn't reach the site. Not
 * saved yet." and another page said "The server crashed ... Its log on Vercel has the error." Copy
 * written one message at a time drifts into server talk. This scans every string the app can show and
 * fails on the phrases that read as a machine talking (D331). Say what happened to the person's thing,
 * then what happens next; a change made offline is kept and sent later, and is said as good news.
 */

const SRC = join(import.meta.dirname, "..");
const BANNED: [RegExp, string][] = [
  [/\bcould not\b/i, 'say "Couldn\'t"'],
  [/\bcannot\b/i, 'say "can\'t"'],
  [/not saved yet/i, 'say what happens next: "Will save with your next change"'],
  [/reach the site/i, 'say "No connection" and when to try again'],
  [
    /the server (crashed|turned|ran into|answered)/i,
    "no server talk: say what happened to the change",
  ],
  [/\b(vercel|github)\b/i, "no host names in what a reader sees"],
  [/check your connection/i, 'say "Try again when you\'re back online"'],
  [/on the server/i, "no server talk"],
  [/failed to\b/i, 'say what did not happen: "Couldn\'t ..."'],
  [/something went wrong|an error occurred|unexpected error/i, "say what did not happen"],
];

/** Files that hold no reader copy: tests, the worker's logs, the API's machine codes, dev tools. */
const SKIP = [
  /\.test\./,
  /\/e2e\//,
  /\/testing\//,
  /\/dev\//,
  /\/pages\/api\//,
  /\/types\//,
  /designCatalogue/,
  /\/design-system\//,
];
/** The server's own words reach a reader only through these (a refusal's reason, a busy page, a share link). */
const SERVER_COPY = [/\/server\/(share|contentRepo|configEdit)\.ts$/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|astro)$/.test(name) ? [path] : [];
  });
}

/** String literals on one line, comments and developer-facing throws left out. */
function literals(line: string): string[] {
  const code = line.trim();
  if (/^(\/\/|\/\*|\*|\{\/\*)/.test(code)) return [];
  if (/(throw new|new Error\(|console\.|Error\()/.test(code)) return [];
  return [...code.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
}

describe("reader copy", () => {
  it("says nothing in a machine's voice", () => {
    const found: string[] = [];
    for (const file of files(SRC)) {
      if (SKIP.some((skip) => skip.test(file))) continue;
      if (/\/server\//.test(file) && !SERVER_COPY.some((ok) => ok.test(file))) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const text of literals(line)) {
            // A header, a URL or a package name is not a sentence a reader sees.
            if (!/\s/.test(text.trim())) continue;
            for (const [pattern, fix] of BANNED) {
              if (pattern.test(text))
                found.push(`${relative(SRC, file)}:${index + 1} "${text}" (${fix})`);
            }
          }
        });
    }
    expect(found).toEqual([]);
  });
});
