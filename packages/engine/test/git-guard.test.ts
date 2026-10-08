import { serializeDigestFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALLOWLISTS,
  assertPathsAllowed,
  findDigestContentViolations,
  findViolations,
  GuardViolationError,
  isPathAllowed,
  parsePorcelain,
  readChangedPaths,
} from "../src/git/guard.js";
import { createGitRunner } from "../src/git/runGit.js";
import { digestFor, makeItem, must } from "./audio-fixtures.js";
import type { RepoPair } from "./git-testRepo.js";
import { createRepoPair, git, put, SEED_DIGEST_ID, SEED_DIGEST_PATH } from "./git-testRepo.js";

describe("ALLOWLISTS", () => {
  it("names the four commands and their paths", () => {
    expect(ALLOWLISTS).toEqual({
      run: ["Digests/", "state/"],
      publish: ["Digests/**/*.audio.json", "Digests/**/*.md", "state/usage.json"],
      learn: ["config/preferences.json"],
      config: [
        "config/topics.json",
        "config/sources.user.json",
        "config/queries.json",
        "config/preferences.json",
        "state/source-candidates.json",
      ],
    });
  });

  it.each([
    ["config/topics.json", true],
    ["config/sources.user.json", true],
    ["config/queries.json", true],
    ["config/preferences.json", true],
    ["state/source-candidates.json", true],
    ["config/sources.json", false],
    ["config/sources.md", false],
    ["config/voice.md", false],
    ["state/seen.json", false],
    ["Digests/2026/10/2026-10-07.md", false],
    ["package.json", false],
    [".github/workflows/config.yml", false],
  ])("config: %s -> %s", (path, expected) => {
    expect(isPathAllowed(path, ALLOWLISTS.config)).toBe(expected);
  });
});

describe("isPathAllowed", () => {
  it.each([
    ["Digests/2026/10/2026-10-07.md", true],
    ["Digests/2026/10/2026-10-07.audio.json", true],
    ["state/seen.json", true],
    ["state/runs/2026-10-07.json", true],
    ["config/preferences.json", false],
    ["package.json", false],
    ["Digests", false],
    ["DigestsX/a.md", false],
    ["docs/Digests/a.md", false],
    ["statefile.json", false],
  ])("run: %s -> %s", (path, expected) => {
    expect(isPathAllowed(path, ALLOWLISTS.run)).toBe(expected);
  });

  it.each([
    ["Digests/2026/10/2026-10-07.audio.json", true],
    ["Digests/2026/10/2026-10-07.md", true],
    ["Digests/2026/10/2026-10-07-weekly.md", true],
    ["Digests/x.md", true],
    ["state/usage.json", true],
    ["state/seen.json", false],
    ["state/judgments.json", false],
    ["state/last-run.json", false],
    ["state/usage.json.bak", false],
    ["Digests/2026/10/2026-10-07.audio.json.bak", false],
    ["Digests/2026/10/2026-10-07.json", false],
    ["Digests/2026/10/notes.txt", false],
    ["config/preferences.json", false],
    [".github/workflows/run.yml", false],
  ])("publish: %s -> %s", (path, expected) => {
    expect(isPathAllowed(path, ALLOWLISTS.publish)).toBe(expected);
  });

  it.each([
    ["config/preferences.json", true],
    ["config/sources.json", false],
    ["config/voice.md", false],
    ["Digests/2026/10/2026-10-07.md", false],
    ["state/usage.json", false],
  ])("learn: %s -> %s", (path, expected) => {
    expect(isPathAllowed(path, ALLOWLISTS.learn)).toBe(expected);
  });

  it("matches ** across directories and * within one segment", () => {
    expect(isPathAllowed("a/b/c/d.txt", ["a/**/d.txt"])).toBe(true);
    expect(isPathAllowed("a/d.txt", ["a/**/d.txt"])).toBe(true);
    expect(isPathAllowed("a/b/c.txt", ["a/*.txt"])).toBe(false);
    expect(isPathAllowed("a/c.txt", ["a/*.txt"])).toBe(true);
    expect(isPathAllowed("a/b?.txt", ["a/b?.txt"])).toBe(true);
  });

  it("treats regular expression characters in a pattern literally", () => {
    expect(isPathAllowed("state/usage.json", ["state/usage.json"])).toBe(true);
    expect(isPathAllowed("state/usageXjson", ["state/usage.json"])).toBe(false);
    expect(isPathAllowed("state/a+b.json", ["state/a+b.json"])).toBe(true);
  });

  it("rejects paths that escape the repository", () => {
    expect(isPathAllowed("Digests/../config/preferences.json", ALLOWLISTS.run)).toBe(false);
    expect(isPathAllowed("../state/seen.json", ALLOWLISTS.run)).toBe(false);
    expect(isPathAllowed("/state/seen.json", ALLOWLISTS.run)).toBe(false);
    expect(isPathAllowed("C:/state/seen.json", ALLOWLISTS.run)).toBe(false);
    expect(isPathAllowed("", ALLOWLISTS.run)).toBe(false);
  });

  it("normalizes a leading ./", () => {
    expect(isPathAllowed("./state/seen.json", ALLOWLISTS.run)).toBe(true);
  });

  it("rejects any path containing a backslash, which is a literal file name character in git", () => {
    expect(isPathAllowed("Digests\\2026\\10\\x.md", ALLOWLISTS.run)).toBe(false);
    expect(isPathAllowed("Digests\\2026\\10\\x.md", ALLOWLISTS.publish)).toBe(false);
    expect(isPathAllowed("state/a\\b.json", ALLOWLISTS.run)).toBe(false);
    expect(findViolations(["Digests\\x.md"], ALLOWLISTS.publish)).toEqual(["Digests\\x.md"]);
  });
});

describe("parsePorcelain", () => {
  it("parses the NUL-separated form with modified, deleted and untracked files", () => {
    const out = " M state/usage.json\0D  state/seen.json\0?? Digests/2026/10/new.md\0";
    expect(parsePorcelain(out)).toEqual([
      { status: " M", path: "state/usage.json" },
      { status: "D ", path: "state/seen.json" },
      { status: "??", path: "Digests/2026/10/new.md" },
    ]);
  });

  it("reads a rename in the NUL form, new path first", () => {
    expect(parsePorcelain("R  Digests/b.md\0Digests/a.md\0 M state/usage.json\0")).toEqual([
      { status: "R ", path: "Digests/b.md", originalPath: "Digests/a.md" },
      { status: " M", path: "state/usage.json" },
    ]);
  });

  it("reads a rename in the line form", () => {
    expect(parsePorcelain("R  Digests/a.md -> Digests/b.md\n M state/usage.json\n")).toEqual([
      { status: "R ", path: "Digests/b.md", originalPath: "Digests/a.md" },
      { status: " M", path: "state/usage.json" },
    ]);
  });

  it("unquotes paths with spaces and octal-escaped UTF-8 in the line form", () => {
    expect(parsePorcelain('?? "config/with space.json"\n?? "config/\\303\\274n.txt"\n')).toEqual([
      { status: "??", path: "config/with space.json" },
      { status: "??", path: "config/\u00FCn.txt" },
    ]);
  });

  it("unquotes escaped quotes, tabs and backslashes", () => {
    expect(parsePorcelain('?? "a\\"b\\tc\\\\d"\n')).toEqual([{ status: "??", path: 'a"b\tc\\d' }]);
  });

  it("reads a copy like a rename", () => {
    expect(parsePorcelain("C  b.md\0a.md\0")).toEqual([
      { status: "C ", path: "b.md", originalPath: "a.md" },
    ]);
  });

  it("returns nothing for empty output", () => {
    expect(parsePorcelain("")).toEqual([]);
    expect(parsePorcelain("\n")).toEqual([]);
  });
});

describe("findViolations and assertPathsAllowed", () => {
  it("finds nothing when every path is allowed", () => {
    const changed = parsePorcelain(" M state/usage.json\0?? Digests/2026/10/x.md\0");
    expect(findViolations(changed, ALLOWLISTS.run)).toEqual([]);
    expect(() => assertPathsAllowed(changed, ALLOWLISTS.run)).not.toThrow();
  });

  it("lists each path outside the allowlist once", () => {
    const changed = parsePorcelain(
      " M config/preferences.json\0 M package.json\0 M package.json\0 M state/seen.json\0",
    );
    expect(findViolations(changed, ALLOWLISTS.run)).toEqual([
      "config/preferences.json",
      "package.json",
    ]);
  });

  it("counts both ends of a rename", () => {
    const out = parsePorcelain("R  Digests/a.md\0config/preferences.json\0");
    expect(findViolations(out, ALLOWLISTS.run)).toEqual(["config/preferences.json"]);
    const inbound = parsePorcelain("R  config/preferences.json\0Digests/a.md\0");
    expect(findViolations(inbound, ALLOWLISTS.run)).toEqual(["config/preferences.json"]);
  });

  it("accepts plain path strings as well", () => {
    expect(findViolations(["state/seen.json", ".env"], ALLOWLISTS.run)).toEqual([".env"]);
  });

  it("throws a GuardViolationError that names the offending paths", () => {
    const changed = parsePorcelain(" M .env\0 M state/seen.json\0");
    try {
      assertPathsAllowed(changed, ALLOWLISTS.run);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(GuardViolationError);
      expect((error as GuardViolationError).offending).toEqual([".env"]);
      expect((error as GuardViolationError).message).toContain(".env");
    }
  });

  it("applies each command's own list", () => {
    const changed = parsePorcelain(" M state/seen.json\0");
    expect(() => assertPathsAllowed(changed, ALLOWLISTS.run)).not.toThrow();
    expect(() => assertPathsAllowed(changed, ALLOWLISTS.publish)).toThrow(GuardViolationError);
    expect(() => assertPathsAllowed(changed, ALLOWLISTS.learn)).toThrow(GuardViolationError);
  });
});

describe("against a real repository", () => {
  let pair: RepoPair;
  beforeEach(async () => {
    pair = await createRepoPair();
  });
  afterEach(async () => {
    await pair.cleanup();
  });

  it("reports nothing for a clean tree", async () => {
    expect(await readChangedPaths(createGitRunner(pair.a))).toEqual([]);
  });

  it("reports modified, staged, deleted and untracked files, each untracked file on its own line", async () => {
    await put(pair.a, "state/usage.json", "{}\n");
    await put(pair.a, "config/preferences.json", '{"x":1}\n');
    git(pair.a, "add", "config/preferences.json");
    git(pair.a, "rm", "-q", "state/seen.json");
    await put(pair.a, "newdir/deep/file.txt", "x");
    await put(pair.a, "newdir/other.txt", "x");
    const changed = await readChangedPaths(createGitRunner(pair.a));
    expect(changed.map((entry) => entry.path).sort()).toEqual([
      "config/preferences.json",
      "newdir/deep/file.txt",
      "newdir/other.txt",
      "state/seen.json",
      "state/usage.json",
    ]);
    expect(findViolations(changed, ALLOWLISTS.run).sort()).toEqual([
      "config/preferences.json",
      "newdir/deep/file.txt",
      "newdir/other.txt",
    ]);
  });

  it("sees a rename as one entry with both paths", async () => {
    git(pair.a, "mv", SEED_DIGEST_PATH, "Digests/2026/10/renamed.md");
    const changed = await readChangedPaths(createGitRunner(pair.a));
    expect(changed).toEqual([
      { status: "R ", path: "Digests/2026/10/renamed.md", originalPath: SEED_DIGEST_PATH },
    ]);
  });

  it("returns unusual file names unquoted", async () => {
    await put(pair.a, "state/with space.json", "{}");
    await put(pair.a, "state/\u00FCn\u00EFcode.json", "{}");
    const paths = (await readChangedPaths(createGitRunner(pair.a)))
      .map((entry) => entry.path)
      .sort();
    expect(paths).toEqual(["state/with space.json", "state/\u00FCn\u00EFcode.json"]);
  });
});

describe("findDigestContentViolations", () => {
  let pair: RepoPair;
  beforeEach(async () => {
    pair = await createRepoPair();
  });
  afterEach(async () => {
    await pair.cleanup();
  });

  const check = async () => {
    const run = createGitRunner(pair.a);
    return findDigestContentViolations({ root: pair.a, run, changed: await readChangedPaths(run) });
  };

  const withAudio = () => ({
    ...digestFor(SEED_DIGEST_ID),
    audio: {
      url: "https://store.public.blob.vercel-storage.com/audio/2026-10-05.mp3",
      duration_ms: 240_000,
    },
  });

  it("accepts a rewrite of the audio field alone", async () => {
    await put(pair.a, SEED_DIGEST_PATH, serializeDigestFile(withAudio()));
    expect(await check()).toEqual([]);
  });

  it("accepts a staged audio rewrite", async () => {
    await put(pair.a, SEED_DIGEST_PATH, serializeDigestFile(withAudio()));
    git(pair.a, "add", SEED_DIGEST_PATH);
    expect(await check()).toEqual([]);
  });

  it("flags an edit that changes anything besides audio", async () => {
    const digest = withAudio();
    digest.items[0] = { ...must(digest.items[0]), headline: "A different headline" };
    await put(pair.a, SEED_DIGEST_PATH, serializeDigestFile(digest));
    expect(await check()).toEqual([`${SEED_DIGEST_PATH} (changes more than the audio field)`]);
  });

  it("flags a changed score, kind or item list", async () => {
    const digest = withAudio();
    digest.items = [...digest.items, makeItem(9)];
    await put(pair.a, SEED_DIGEST_PATH, serializeDigestFile(digest));
    expect(await check()).toHaveLength(1);
  });

  it("flags a new digest file", async () => {
    await put(
      pair.a,
      "Digests/2026/10/2026-10-07.md",
      serializeDigestFile(digestFor("2026-10-07")),
    );
    expect(await check()).toEqual([
      "Digests/2026/10/2026-10-07.md (a digest may be edited, not added, removed or renamed)",
    ]);
  });

  it("flags a deleted or renamed digest", async () => {
    git(pair.a, "mv", SEED_DIGEST_PATH, "Digests/2026/10/2026-10-06.md");
    expect(await check()).toHaveLength(1);
  });

  it("flags a digest renamed to a name the path rules would otherwise accept", async () => {
    git(pair.a, "mv", SEED_DIGEST_PATH, "Digests/2026/10/2026-10-05.audio.json");
    expect(await check()).toEqual([
      `${SEED_DIGEST_PATH} (a digest may be edited, not added, removed or renamed)`,
    ]);
  });

  it("flags a deleted digest", async () => {
    git(pair.a, "rm", "-q", SEED_DIGEST_PATH);
    expect(await check()).toEqual([
      `${SEED_DIGEST_PATH} (a digest may be edited, not added, removed or renamed)`,
    ]);
  });

  it("flags a digest file that no longer parses", async () => {
    await put(pair.a, SEED_DIGEST_PATH, "not a digest");
    expect(await check()).toEqual([`${SEED_DIGEST_PATH} (could not be compared with HEAD)`]);
  });

  it("ignores changes that are not digests", async () => {
    await put(pair.a, "state/usage.json", "{}\n");
    await put(pair.a, "Digests/2026/10/2026-10-05.audio.json", "{}\n");
    expect(await check()).toEqual([]);
  });

  it("is clean when nothing changed", async () => {
    expect(await check()).toEqual([]);
  });
});
