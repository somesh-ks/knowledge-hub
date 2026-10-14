import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PodcastCommand, parseEpisodeFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePodcastCommand } from "../src/commands/podcast.js";
import { parseCommand } from "../src/podcast/actions.js";
import { scriptUserMessage } from "../src/podcast/prompt.js";
import { InvalidRequestError } from "../src/podcast/types.js";
import { captureStdout, makeContext } from "./curate-helpers.js";
import { commitAll, createRepoPair, git, type RepoPair } from "./git-testRepo.js";
import {
  dayAgo,
  FakeScriptWriter,
  makeDigest,
  NOW,
  REQUEST,
  writeDigest,
} from "./podcast-fixtures.js";

const OLD_ID = "ep-20261008-0913";
const OLD_PATH = `Podcasts/2026/10/${OLD_ID}.md`;
const OTHER_PATH = "Podcasts/2026/10/ep-20261008-0914.md";
const LATER = new Date(NOW.getTime() + 3_600_000);
const NEW_ID = "ep-20261008-1013";
const NEW_PATH = `Podcasts/2026/10/${NEW_ID}.md`;

describe("PodcastCommand", () => {
  it("reads a request with no action as a new episode", () => {
    expect(PodcastCommand.parse(REQUEST)).toEqual({ action: "create", request: REQUEST });
  });

  it("reads a delete", () => {
    expect(PodcastCommand.parse({ action: "delete", id: OLD_ID })).toEqual({
      action: "delete",
      id: OLD_ID,
    });
  });

  it("reads a regenerate and cleans the feedback", () => {
    const parsed = PodcastCommand.parse({
      action: "regenerate",
      id: OLD_ID,
      feedback: "  shorter\u0000intro\nplease \u007f ",
    });
    expect(parsed).toEqual({
      action: "regenerate",
      id: OLD_ID,
      feedback: "shorter intro please",
    });
  });

  it.each([
    ["a bad id", { action: "delete", id: "ep-1" }],
    ["an unknown action", { action: "rename", id: OLD_ID }],
    ["empty feedback", { action: "regenerate", id: OLD_ID, feedback: "  \n " }],
    ["feedback over 500", { action: "regenerate", id: OLD_ID, feedback: "x".repeat(501) }],
    ["an empty topic list", { action: "regenerate", id: OLD_ID, topic_ids: [] }],
    ["an extra field", { action: "delete", id: OLD_ID, force: true }],
  ])("rejects %s", (_name, value) => {
    expect(PodcastCommand.safeParse(value).success).toBe(false);
  });

  it("accepts feedback of exactly 500 characters", () => {
    expect(
      PodcastCommand.safeParse({ action: "regenerate", id: OLD_ID, feedback: "x".repeat(500) })
        .success,
    ).toBe(true);
  });

  it("parseCommand names what is wrong", () => {
    expect(() => parseCommand("{nope")).toThrow(InvalidRequestError);
    expect(() => parseCommand(JSON.stringify({ action: "delete", id: "x" }))).toThrow(/id/);
  });
});

describe("the feedback paragraph", () => {
  it("is wrapped as untrusted text and absent without feedback", () => {
    const input = { request: REQUEST, stories: [], budget_chars: 4000 };
    expect(scriptUserMessage(input, "BND", [])).not.toContain("listener asked");
    const text = scriptUserMessage({ ...input, feedback: "more on design" }, "BND", []);
    expect(text).toContain(
      "The listener asked for these changes to the previous version:\n<<<SOURCE-BND",
    );
    expect(text).toContain("more on design");
  });
});

describe("dispatch podcast delete and regenerate", () => {
  let pair: RepoPair;
  let root: string;

  async function run(argv: string[], writer = new FakeScriptWriter()) {
    const { ctx, logs } = makeContext(root, { json: false });
    const command = makePodcastCommand({ makeWriter: () => writer });
    const { result, stdout } = await captureStdout(() => command(argv, ctx));
    return {
      code: result,
      stdout,
      writer,
      errors: logs.filter((l) => l.level === "error").map((l) => l.message),
    };
  }

  const act = (request: unknown): string[] => [
    "--request",
    JSON.stringify(request),
    "--now",
    LATER.toISOString(),
  ];

  beforeEach(async () => {
    pair = await createRepoPair({ seedDigest: false });
    root = pair.a;
    for (const days of [1, 2]) {
      const when = dayAgo(days);
      await writeDigest(
        root,
        makeDigest(when.id, when.at, [{ n: days * 10 }, { n: days * 10 + 1 }]),
      );
    }
    await commitAll(root, "chore: seed digests");
    // Two episodes exist; the tests below touch only the first.
    const seed = (request: unknown, at: Date): string[] => [
      "--request",
      JSON.stringify(request),
      "--now",
      at.toISOString(),
      "--no-push",
    ];
    await run(seed(REQUEST, NOW));
    await run(seed({ ...REQUEST, tone: "energetic" }, new Date(NOW.getTime() + 60_000)));
  });
  afterEach(async () => {
    await pair.cleanup();
  });

  it("delete removes only that file and commits it as chore(podcast)", async () => {
    const { code, stdout } = await run([...act({ action: "delete", id: OLD_ID }), "--no-push"]);
    expect(code).toBe(0);
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(OLD_ID);
    expect(existsSync(join(root, OLD_PATH))).toBe(false);
    expect(existsSync(join(root, OTHER_PATH))).toBe(true);
    expect(git(root, "log", "-1", "--format=%s")).toBe(`chore(podcast): remove ${OLD_ID}`);
    expect(git(root, "show", "--name-status", "--format=", "HEAD")).toBe(`D\t${OLD_PATH}`);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("delete of an unknown id fails with a plain message and changes nothing", async () => {
    const before = git(root, "rev-parse", "HEAD");
    const { code, errors } = await run([
      ...act({ action: "delete", id: "ep-20200101-0000" }),
      "--no-push",
    ]);
    expect(code).toBe(1);
    expect(errors.join(" ")).toMatch(/There is no episode ep-20200101-0000/);
    expect(git(root, "rev-parse", "HEAD")).toBe(before);
  });

  it("delete refuses to commit when something outside Podcasts/ changed", async () => {
    await writeFile(join(root, "notes.txt"), "stray");
    const { code, errors } = await run([...act({ action: "delete", id: OLD_ID }), "--no-push"]);
    expect(code).toBe(1);
    expect(errors.join(" ")).toMatch(/Commit refused \(guard\).*notes\.txt/);
  });

  it("regenerate replaces the episode in one commit and gives the writer the feedback", async () => {
    const { code, stdout, writer } = await run([
      ...act({ action: "regenerate", id: OLD_ID, feedback: "Less jargon, more on the planner" }),
      "--no-push",
    ]);
    expect(code).toBe(0);
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(NEW_ID);
    expect(writer.calls[0]?.input.feedback).toBe("Less jargon, more on the planner");
    expect(existsSync(join(root, OLD_PATH))).toBe(false);
    expect(git(root, "log", "-1", "--format=%s")).toBe(
      `feat(podcast): replace ${OLD_ID} with ${NEW_ID}`,
    );
    expect(
      git(root, "show", "--no-renames", "--name-status", "--format=", "HEAD").split("\n").sort(),
    ).toEqual([`A\t${NEW_PATH}`, `D\t${OLD_PATH}`].sort());
    const episode = parseEpisodeFile(await readFile(join(root, NEW_PATH), "utf8"));
    expect(episode.replaces).toBe(OLD_ID);
    expect(episode.feedback).toBe("Less jargon, more on the planner");
    expect(episode.request).toEqual(REQUEST);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("regenerate with chosen topics and no comments writes the new episode for those topics only", async () => {
    const { code, writer } = await run([
      ...act({ action: "regenerate", id: OLD_ID, topic_ids: ["ai"] }),
      "--no-push",
    ]);
    expect(code).toBe(0);
    expect(writer.calls[0]?.input.feedback).toBeUndefined();
    expect(writer.calls[0]?.input.request.topic_ids).toEqual(["ai"]);
    expect(existsSync(join(root, OLD_PATH))).toBe(false);
    const episode = parseEpisodeFile(await readFile(join(root, NEW_PATH), "utf8"));
    expect(episode.replaces).toBe(OLD_ID);
    expect(episode.request).toEqual({ ...REQUEST, topic_ids: ["ai"] });
  });

  it("a failed regenerate leaves the old file and commits nothing", async () => {
    const before = git(root, "rev-parse", "HEAD");
    const broken = new FakeScriptWriter(() => ({ nope: true }));
    const { code } = await run(
      [...act({ action: "regenerate", id: OLD_ID, feedback: "Change it" }), "--no-push"],
      broken,
    );
    expect(code).toBe(1);
    expect(existsSync(join(root, OLD_PATH))).toBe(true);
    expect(existsSync(join(root, NEW_PATH))).toBe(false);
    expect(git(root, "rev-parse", "HEAD")).toBe(before);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("regenerate of an unknown id fails before the writer is called", async () => {
    const { code, errors, writer } = await run([
      ...act({ action: "regenerate", id: "ep-20200101-0000", feedback: "x" }),
      "--no-push",
    ]);
    expect(code).toBe(1);
    expect(errors.join(" ")).toMatch(/There is no episode/);
    expect(writer.calls).toHaveLength(0);
  });

  it("dry runs change nothing", async () => {
    const before = git(root, "rev-parse", "HEAD");
    const del = await run([...act({ action: "delete", id: OLD_ID }), "--dry-run"]);
    expect(del.code).toBe(0);
    expect(JSON.parse(del.stdout)).toMatchObject({ action: "delete", would_remove: [OLD_PATH] });

    const regen = await run([
      ...act({ action: "regenerate", id: OLD_ID, feedback: "Shorter" }),
      "--dry-run",
    ]);
    expect(regen.code).toBe(0);
    expect(regen.writer.calls[0]?.input.feedback).toBe("Shorter");
    expect(JSON.parse(regen.stdout)).toMatchObject({
      replaces: OLD_ID,
      would_remove: [OLD_PATH],
    });
    expect(existsSync(join(root, OLD_PATH))).toBe(true);
    expect(existsSync(join(root, NEW_PATH))).toBe(false);
    expect(git(root, "rev-parse", "HEAD")).toBe(before);
    expect(git(root, "status", "--porcelain")).toBe("");
  });
});
