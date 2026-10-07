import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  audioTimelineRelPath,
  digestRelPath,
  loadEnv,
  parseDigestFile,
  STATE_FILES,
} from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpeechifyError } from "../src/audio/speechify.js";
import { buildSpokenText } from "../src/audio/spokenText.js";
import type { AudioCommandDeps } from "../src/commands/audio.js";
import { createAudioCommand } from "../src/commands/audio.js";
import { createPublishCommand } from "../src/commands/publish.js";
import type {
  FakeBlob,
  FakeSpeech,
  FakeSpeechOptions,
  TempRoot,
  TestContext,
} from "./audio-fixtures.js";
import {
  digestFor,
  FAKE_BLOB_TOKEN,
  FAKE_SPEECHIFY_KEY,
  makeContext,
  makeDigest,
  makeFakeBlob,
  makeFakeSpeech,
  makeTempRoot,
  must,
  writeDigest,
} from "./audio-fixtures.js";
import type { RepoPair } from "./git-testRepo.js";
import { commitAll, createRepoPair, git, put } from "./git-testRepo.js";

interface Rig {
  deps: Partial<AudioCommandDeps>;
  out: string[];
  speech: FakeSpeech;
  blob: FakeBlob;
}

function rig(speechOptions: FakeSpeechOptions = {}, monthlyChars = 500_000): Rig {
  const out: string[] = [];
  const speech = makeFakeSpeech(speechOptions);
  const blob = makeFakeBlob();
  return {
    out,
    speech,
    blob,
    deps: {
      out: (text) => void out.push(text),
      monthlyChars: () => monthlyChars,
      createSpeech: () => speech,
      createBlob: () => blob,
    },
  };
}

const forbidden: Partial<AudioCommandDeps> = {
  createSpeech: () => {
    throw new Error("createSpeech must not be called");
  },
  createBlob: () => {
    throw new Error("createBlob must not be called");
  },
};

describe("dispatch audio", () => {
  let temp: TempRoot;
  let ctx: TestContext;
  beforeEach(async () => {
    temp = await makeTempRoot();
    ctx = makeContext(temp.root);
  });
  afterEach(async () => {
    await temp.cleanup();
  });

  describe("usage", () => {
    it("needs --digest", async () => {
      const r = rig();
      expect(await createAudioCommand(r.deps)([], ctx)).toBe(2);
      expect(
        ctx.log.lines.some((line) => line.level === "error" && line.message.includes("--digest")),
      ).toBe(true);
    });

    it("rejects an invalid digest id", async () => {
      expect(await createAudioCommand(rig().deps)(["--digest", "yesterday"], ctx)).toBe(2);
      expect(await createAudioCommand(rig().deps)(["--digest", "../x"], ctx)).toBe(2);
    });

    it("rejects unknown flags", async () => {
      expect(await createAudioCommand(rig().deps)(["--digest", "2026-10-07", "--loud"], ctx)).toBe(
        2,
      );
    });

    it("rejects stray positional arguments", async () => {
      expect(await createAudioCommand(rig().deps)(["--digest", "2026-10-07", "extra"], ctx)).toBe(
        2,
      );
    });
  });

  describe("--dry-run", () => {
    it("prints the spoken text, the character count and the budget without calling Speechify", async () => {
      const digest = makeDigest();
      await writeDigest(temp.root, digest);
      const out: string[] = [];
      const code = await createAudioCommand({
        ...forbidden,
        out: (text) => void out.push(text),
        monthlyChars: () => 500_000,
      })(["--digest", "2026-10-07", "--dry-run"], ctx);
      expect(code).toBe(0);
      const text = buildSpokenText(digest).text;
      const printed = out.join("");
      expect(printed).toContain(text);
      expect(printed).toContain(`2026-10-07: ${text.length} characters.`);
      expect(printed).toContain("Budget 2026-10: 0 used, limit 450000 (90 percent of 500000)");
    });

    it("emits JSON with the text, count and budget", async () => {
      await writeDigest(temp.root, makeDigest());
      const out: string[] = [];
      const jsonCtx = makeContext(temp.root, { json: true });
      await createAudioCommand({
        ...forbidden,
        out: (text) => void out.push(text),
        monthlyChars: () => 500_000,
      })(["--digest", "2026-10-07", "--dry-run"], jsonCtx);
      const result = JSON.parse(out.join(""));
      expect(result).toMatchObject({
        digest: "2026-10-07",
        characters: buildSpokenText(makeDigest()).text.length,
        budget: {
          month: "2026-10",
          used: 0,
          limit: 450_000,
          monthlyChars: 500_000,
          wouldSynthesize: true,
        },
      });
      expect(
        result.text.startsWith(
          "This is Singularity for Wednesday the seventh of October. Five stories today",
        ),
      ).toBe(true);
    });

    it("says when the budget would refuse the request", async () => {
      await writeDigest(temp.root, makeDigest());
      const out: string[] = [];
      await createAudioCommand({
        ...forbidden,
        out: (text) => void out.push(text),
        monthlyChars: () => 100,
      })(["--digest", "2026-10-07", "--dry-run"], ctx);
      expect(out.join("")).toContain("over the limit, audio would be refused");
    });

    it("counts usage already recorded this month", async () => {
      await writeDigest(temp.root, makeDigest());
      await put(
        temp.root,
        STATE_FILES.usage,
        JSON.stringify({ version: 1, speechify: { month: "2026-10", characters: 1234 } }),
      );
      const out: string[] = [];
      await createAudioCommand({
        ...forbidden,
        out: (text) => void out.push(text),
        monthlyChars: () => 500_000,
      })(["--digest", "2026-10-07", "--dry-run"], ctx);
      expect(out.join("")).toContain("1234 used");
    });

    it("writes nothing", async () => {
      await writeDigest(temp.root, makeDigest());
      await createAudioCommand({ ...forbidden, out: () => {}, monthlyChars: () => 500_000 })(
        ["--digest", "2026-10-07", "--dry-run"],
        ctx,
      );
      await expect(readFile(join(temp.root, STATE_FILES.usage), "utf8")).rejects.toThrow();
      await expect(
        readFile(join(temp.root, audioTimelineRelPath("2026-10-07")), "utf8"),
      ).rejects.toThrow();
    });

    it("fails when the usage file is corrupt", async () => {
      await writeDigest(temp.root, makeDigest());
      await put(temp.root, STATE_FILES.usage, "{broken");
      const code = await createAudioCommand({
        ...forbidden,
        out: () => {},
        monthlyChars: () => 500_000,
      })(["--digest", "2026-10-07", "--dry-run"], ctx);
      expect(code).toBe(1);
    });

    it("fails on an invalid monthly allowance", async () => {
      await writeDigest(temp.root, makeDigest());
      const code = await createAudioCommand({
        ...forbidden,
        out: () => {},
        monthlyChars: () => {
          throw new Error("SPEECHIFY_MONTHLY_CHARS must be a positive whole number");
        },
      })(["--digest", "2026-10-07", "--dry-run"], ctx);
      expect(code).toBe(1);
      expect(ctx.log.lines.some((line) => line.message.includes("SPEECHIFY_MONTHLY_CHARS"))).toBe(
        true,
      );
    });

    it("fails when the digest does not exist", async () => {
      const code = await createAudioCommand({
        ...forbidden,
        out: () => {},
        monthlyChars: () => 500_000,
      })(["--digest", "2026-10-07", "--dry-run"], ctx);
      expect(code).toBe(1);
    });
  });

  describe("synthesis", () => {
    it("narrates and uploads one digest", async () => {
      await writeDigest(temp.root, makeDigest());
      const r = rig();
      expect(await createAudioCommand(r.deps)(["--digest", "2026-10-07"], ctx)).toBe(0);
      expect(r.out.join("")).toContain("2026-10-07: audio ready");
      expect(r.out.join("")).toContain("marks timeline");
      expect(
        parseDigestFile(await readFile(join(temp.root, digestRelPath("2026-10-07")), "utf8")).audio
          ?.url,
      ).toContain("audio/2026-10-07.mp3");
      expect(await readFile(join(temp.root, audioTimelineRelPath("2026-10-07")), "utf8")).toContain(
        '"timeline": "marks"',
      );
    });

    it("uses the voice from the environment", async () => {
      await writeDigest(temp.root, makeDigest());
      const r = rig();
      const voiceCtx = makeContext(temp.root, {
        env: loadEnv({
          SPEECHIFY_API_KEY: FAKE_SPEECHIFY_KEY,
          BLOB_READ_WRITE_TOKEN: FAKE_BLOB_TOKEN,
          SPEECHIFY_VOICE_ID: "other_voice",
        }),
      });
      await createAudioCommand(r.deps)(["--digest", "2026-10-07"], voiceCtx);
      expect(must(r.speech.calls.marks[0]).voiceId).toBe("other_voice");
    });

    it("skips a digest that is already complete and regenerates it with --force", async () => {
      await writeDigest(temp.root, makeDigest());
      const r = rig();
      await createAudioCommand(r.deps)(["--digest", "2026-10-07"], ctx);
      r.out.length = 0;
      expect(await createAudioCommand(r.deps)(["--digest", "2026-10-07"], ctx)).toBe(0);
      expect(r.out.join("")).toContain("already has audio");
      expect(r.speech.calls.marks).toHaveLength(1);
      expect(await createAudioCommand(r.deps)(["--digest", "2026-10-07", "--force"], ctx)).toBe(0);
      expect(r.speech.calls.marks).toHaveLength(2);
    });

    it("only touches the requested digest", async () => {
      await writeDigest(temp.root, digestFor("2026-10-05"));
      await writeDigest(temp.root, digestFor("2026-10-07"));
      const r = rig();
      await createAudioCommand(r.deps)(["--digest", "2026-10-05"], ctx);
      expect(
        parseDigestFile(await readFile(join(temp.root, digestRelPath("2026-10-07")), "utf8")).audio,
      ).toBeNull();
    });

    it("exits 1 and names the stage when synthesis fails", async () => {
      await writeDigest(temp.root, makeDigest());
      const r = rig({
        failMarksCall: () =>
          new SpeechifyError("Speechify request failed (HTTP 500)", { status: 500 }),
      });
      expect(await createAudioCommand(r.deps)(["--digest", "2026-10-07"], ctx)).toBe(1);
      expect(r.out.join("")).toContain("failed at synthesis");
    });

    it("exits 1 when the budget refuses", async () => {
      await writeDigest(temp.root, makeDigest());
      const r = rig({}, 100);
      expect(await createAudioCommand(r.deps)(["--digest", "2026-10-07"], ctx)).toBe(1);
      expect(r.out.join("")).toContain("Speechify budget for 2026-10");
      expect(r.speech.calls.marks).toEqual([]);
    });

    it("exits 1 on an invalid monthly allowance without calling Speechify", async () => {
      await writeDigest(temp.root, makeDigest());
      const r = rig();
      const code = await createAudioCommand({
        ...r.deps,
        monthlyChars: () => {
          throw new Error("SPEECHIFY_MONTHLY_CHARS must be a positive whole number");
        },
      })(["--digest", "2026-10-07"], ctx);
      expect(code).toBe(1);
      expect(r.speech.calls.marks).toEqual([]);
    });

    it("exits 1 for a digest that does not exist", async () => {
      const r = rig();
      expect(await createAudioCommand(r.deps)(["--digest", "2026-10-07"], ctx)).toBe(1);
      expect(r.out.join("")).toContain("failed at read");
    });

    it("emits JSON when asked", async () => {
      await writeDigest(temp.root, makeDigest());
      const r = rig();
      await createAudioCommand(r.deps)(
        ["--digest", "2026-10-07"],
        makeContext(temp.root, { json: true }),
      );
      expect(JSON.parse(r.out.join(""))).toMatchObject({
        ok: true,
        outcome: { status: "published", digestId: "2026-10-07" },
        warnings: [],
      });
    });

    it("exits 1 naming the variable, never a value, when a key is missing", async () => {
      await writeDigest(temp.root, makeDigest());
      const bare = makeContext(temp.root, { env: loadEnv({}) });
      const code = await createAudioCommand({ out: () => {}, monthlyChars: () => 500_000 })(
        ["--digest", "2026-10-07"],
        bare,
      );
      expect(code).toBe(1);
      const logged = bare.log.lines.map((line) => line.message).join("\n");
      expect(logged).toContain("SPEECHIFY_API_KEY is not set");
      expect(logged).not.toContain(FAKE_SPEECHIFY_KEY);
    });
  });
});

describe("dispatch publish", () => {
  let pair: RepoPair;
  let ctx: TestContext;
  beforeEach(async () => {
    pair = await createRepoPair({ seedDigest: false });
    ctx = makeContext(pair.a);
  });
  afterEach(async () => {
    await pair.cleanup();
  });

  const remoteHead = (): string => git(pair.remote, "rev-parse", "refs/heads/main");
  const remoteSubject = (): string =>
    git(pair.remote, "log", "-1", "--format=%s", "refs/heads/main");

  /** Commit and push digests so the working tree starts clean. */
  async function seed(...ids: string[]): Promise<void> {
    for (const id of ids) await writeDigest(pair.a, digestFor(id));
    await commitAll(pair.a, "chore(digest): seed digests");
    git(pair.a, "push", "-q", "origin", "main");
  }

  const audioOf = (id: string) =>
    parseDigestFile(git(pair.a, "show", `HEAD:${digestRelPath(id)}`)).audio;

  describe("usage", () => {
    it.each([
      [["--prune", "0"]],
      [["--prune", "abc"]],
      [["--prune", "1.5"]],
      [["--prune", "-3"]],
      [["--digest", "yesterday"]],
      [["--loud"]],
      [["extra"]],
    ])("rejects %j with exit 2", async (argv) => {
      expect(await createPublishCommand({ ...forbidden, out: () => {} })(argv, ctx)).toBe(2);
    });
  });

  describe("nothing to do", () => {
    it("exits 0 without credentials or git changes when every digest is complete", async () => {
      await seed("2026-10-07");
      const r = rig();
      await createPublishCommand(r.deps)([], ctx);
      const before = git(pair.a, "rev-parse", "HEAD");
      r.out.length = 0;

      const code = await createPublishCommand({
        ...forbidden,
        out: (text) => void r.out.push(text),
      })([], ctx);
      expect(code).toBe(0);
      expect(r.out.join("")).toContain("Nothing to publish.");
      expect(git(pair.a, "rev-parse", "HEAD")).toBe(before);
    });

    it("exits 0 when there are no digests at all", async () => {
      const out: string[] = [];
      expect(
        await createPublishCommand({ ...forbidden, out: (text) => void out.push(text) })([], ctx),
      ).toBe(0);
      expect(out.join("")).toContain("Nothing to publish.");
    });
  });

  describe("publishing", () => {
    it("narrates, commits as the bot and pushes", async () => {
      await seed("2026-10-07");
      const r = rig();
      const code = await createPublishCommand(r.deps)([], ctx);

      expect(code).toBe(0);
      expect(remoteSubject()).toBe("chore(audio): add narration for 2026-10-07");
      expect(
        git(pair.remote, "show", "--name-only", "--format=", "refs/heads/main").split("\n").sort(),
      ).toEqual([
        "Digests/2026/10/2026-10-07.audio.json",
        "Digests/2026/10/2026-10-07.md",
        "state/usage.json",
      ]);
      expect(git(pair.remote, "log", "-1", "--format=%an|%ae", "refs/heads/main")).toBe(
        "dispatch-bot|dispatch-bot@users.noreply.github.com",
      );
      expect(remoteHead()).toBe(git(pair.a, "rev-parse", "HEAD"));
      expect(audioOf("2026-10-07")?.url).toContain("audio/2026-10-07.mp3");
      expect(git(pair.a, "status", "--porcelain")).toBe("");
      expect(r.out.join("")).toContain("2026-10-07  audio ready");
      expect(r.out.join("")).toContain("git: pushed");
    });

    it("converges: a second run is a no-op", async () => {
      await seed("2026-10-07");
      const r = rig();
      await createPublishCommand(r.deps)([], ctx);
      const head = remoteHead();
      expect(await createPublishCommand(r.deps)([], ctx)).toBe(0);
      expect(remoteHead()).toBe(head);
      expect(r.speech.calls.marks).toHaveLength(1);
    });

    it("lists up to three digests in the commit subject and counts more", async () => {
      await seed("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04");
      await createPublishCommand(rig().deps)([], ctx);
      expect(remoteSubject()).toBe("chore(audio): add narration for 4 digests");

      await pair.cleanup();
      pair = await createRepoPair({ seedDigest: false });
      ctx = makeContext(pair.a);
      await seed("2026-10-06", "2026-10-07");
      await createPublishCommand(rig().deps)([], ctx);
      expect(remoteSubject()).toBe("chore(audio): add narration for 2026-10-06, 2026-10-07");
    });

    it("--no-push commits locally and leaves the remote alone", async () => {
      await seed("2026-10-07");
      const before = remoteHead();
      const r = rig();
      expect(await createPublishCommand(r.deps)(["--no-push"], ctx)).toBe(0);
      expect(remoteHead()).toBe(before);
      expect(git(pair.a, "log", "-1", "--format=%s")).toBe(
        "chore(audio): add narration for 2026-10-07",
      );
      expect(r.out.join("")).toContain("not pushed");
    });

    it("--digest limits the work to one digest", async () => {
      await seed("2026-10-05", "2026-10-07");
      await createPublishCommand(rig().deps)(["--digest", "2026-10-05"], ctx);
      expect(audioOf("2026-10-05")).not.toBeNull();
      expect(audioOf("2026-10-07")).toBeNull();
    });

    it("emits JSON with outcomes and the commit result", async () => {
      await seed("2026-10-07");
      const r = rig();
      await createPublishCommand(r.deps)([], makeContext(pair.a, { json: true }));
      const result = JSON.parse(r.out.join(""));
      expect(result.outcomes[0]).toMatchObject({ status: "published", digestId: "2026-10-07" });
      expect(result.commit).toMatchObject({ status: "pushed" });
      expect(result.changedPaths).toHaveLength(3);
    });

    it("accepts a working tree that already holds allowed changes", async () => {
      await seed("2026-10-07");
      await put(
        pair.a,
        "state/usage.json",
        '{ "version": 1, "speechify": { "month": "2026-10", "characters": 10 } }\n',
      );
      expect(await createPublishCommand(rig().deps)([], ctx)).toBe(0);
      expect(git(pair.a, "status", "--porcelain")).toBe("");
    });
  });

  describe("failures never block the text digest", () => {
    it("exits 0 and leaves audio null when synthesis fails, committing nothing", async () => {
      await seed("2026-10-07");
      const before = remoteHead();
      const r = rig({
        failMarksCall: () =>
          new SpeechifyError("Speechify request failed (HTTP 500)", { status: 500 }),
      });
      expect(await createPublishCommand(r.deps)([], ctx)).toBe(0);
      expect(remoteHead()).toBe(before);
      expect(audioOf("2026-10-07")).toBeNull();
      expect(r.out.join("")).toContain("audio failed at synthesis");
      expect(r.out.join("")).toContain("nothing to commit");
      expect(
        ctx.log.lines.some((line) => line.level === "warn" && line.message.includes("2026-10-07")),
      ).toBe(true);
    });

    it("isolates a failing digest from the others", async () => {
      await seed("2026-10-05", "2026-10-07");
      const r = rig({ failMarksCall: (index) => (index === 0 ? new Error("down") : undefined) });
      expect(await createPublishCommand(r.deps)([], ctx)).toBe(0);
      expect(audioOf("2026-10-07")).toBeNull();
      expect(audioOf("2026-10-05")).not.toBeNull();
      expect(remoteSubject()).toBe("chore(audio): add narration for 2026-10-05");
    });

    it("exits 0 with a warning when credentials are missing, without synthesizing", async () => {
      await seed("2026-10-07");
      const before = remoteHead();
      const bare = makeContext(pair.a, { env: loadEnv({}) });
      const out: string[] = [];
      const code = await createPublishCommand({
        out: (text) => void out.push(text),
        monthlyChars: () => 500_000,
      })([], bare);
      expect(code).toBe(0);
      expect(remoteHead()).toBe(before);
      expect(out.join("")).toContain("audio failed at credentials: SPEECHIFY_API_KEY is not set");
      expect(
        bare.log.lines.some(
          (line) => line.level === "warn" && line.message.includes("SPEECHIFY_API_KEY is not set"),
        ),
      ).toBe(true);
    });

    it("reports an invalid monthly allowance and spends nothing", async () => {
      await seed("2026-10-07");
      const r = rig();
      const out: string[] = [];
      const code = await createPublishCommand({
        ...r.deps,
        out: (text) => void out.push(text),
        monthlyChars: () => {
          throw new Error("SPEECHIFY_MONTHLY_CHARS must be a positive whole number");
        },
      })([], ctx);
      expect(code).toBe(0);
      expect(out.join("")).toContain("audio failed at credentials: SPEECHIFY_MONTHLY_CHARS");
      expect(r.speech.calls.marks).toEqual([]);
    });

    it("names the missing blob token when only it is absent, and spends nothing", async () => {
      await seed("2026-10-07");
      const r = rig();
      const noBlob = makeContext(pair.a, {
        env: loadEnv({ SPEECHIFY_API_KEY: FAKE_SPEECHIFY_KEY }),
      });
      await createPublishCommand({
        out: (text) => void r.out.push(text),
        monthlyChars: () => 500_000,
        createSpeech: () => r.speech,
      })([], noBlob);
      expect(r.out.join("")).toContain("BLOB_READ_WRITE_TOKEN is not set");
      expect(r.speech.calls.marks).toEqual([]);
    });

    it("still commits the spend when the upload fails after synthesis", async () => {
      await seed("2026-10-07");
      const r = rig();
      r.blob.failNextPuts = 10;
      expect(await createPublishCommand({ ...r.deps, createBlob: () => r.blob })([], ctx)).toBe(0);
      expect(remoteSubject()).toBe("chore(audio): record speechify usage");
      expect(audioOf("2026-10-07")).toBeNull();
      const usage = JSON.parse(git(pair.remote, "show", "refs/heads/main:state/usage.json"));
      expect(usage.speechify.characters).toBeGreaterThan(0);
    });

    it("never prints a key or token", async () => {
      await seed("2026-10-07");
      const r = rig({
        failMarksCall: () =>
          new SpeechifyError("Speechify request failed (HTTP 401 unauthorized)", { status: 401 }),
      });
      await createPublishCommand(r.deps)([], ctx);
      const everything = [...r.out, ...ctx.log.lines.map((line) => line.message)].join("\n");
      expect(everything).not.toContain(FAKE_SPEECHIFY_KEY);
      expect(everything).not.toContain(FAKE_BLOB_TOKEN);
    });
  });

  describe("the write guard", () => {
    it("exits 1 before any synthesis when the tree holds a change outside the allowlist", async () => {
      await seed("2026-10-07");
      await put(pair.a, "config/preferences.json", '{"weights":{"x":1}}\n');
      const r = rig();
      expect(await createPublishCommand(r.deps)([], ctx)).toBe(1);
      expect(r.speech.calls.marks).toEqual([]);
      expect(
        ctx.log.lines.some(
          (line) => line.level === "error" && line.message.includes("config/preferences.json"),
        ),
      ).toBe(true);
    });

    it("exits 1 for an untracked stray file too", async () => {
      await seed("2026-10-07");
      await put(pair.a, "notes.txt", "x");
      const r = rig();
      expect(await createPublishCommand(r.deps)([], ctx)).toBe(1);
      expect(r.speech.calls.marks).toEqual([]);
    });

    it("exits 1 before synthesis when a dirty digest changes more than its audio field", async () => {
      await seed("2026-10-07", "2026-10-06");
      const edited = digestFor("2026-10-06");
      edited.items[0] = { ...must(edited.items[0]), headline: "Edited by hand" };
      await writeDigest(pair.a, edited);
      const r = rig();
      expect(await createPublishCommand(r.deps)([], ctx)).toBe(1);
      expect(r.speech.calls.marks).toEqual([]);
      expect(
        ctx.log.lines.some(
          (line) =>
            line.level === "error" && line.message.includes("changes more than the audio field"),
        ),
      ).toBe(true);
    });

    it("exits 1 when git status cannot be read", async () => {
      const outside = await makeTempRoot();
      try {
        await writeDigest(outside.root, makeDigest());
        const r = rig();
        expect(await createPublishCommand(r.deps)([], makeContext(outside.root))).toBe(1);
        expect(r.speech.calls.marks).toEqual([]);
      } finally {
        await outside.cleanup();
      }
    });
  });

  describe("a named digest", () => {
    it("exits 1 when it does not exist, without synthesizing", async () => {
      await seed("2026-10-07");
      const r = rig();
      expect(await createPublishCommand(r.deps)(["--digest", "2026-01-01"], ctx)).toBe(1);
      expect(r.speech.calls.marks).toEqual([]);
      expect(
        ctx.log.lines.some((line) => line.level === "error" && line.message.includes("2026-01-01")),
      ).toBe(true);
    });
  });

  describe("a failing commit step", () => {
    it("exits 1 and reports it when a pre-commit hook rejects the commit", async () => {
      await seed("2026-10-07");
      const hook = join(pair.a, ".git", "hooks", "pre-commit");
      await put(pair.a, ".git/hooks/pre-commit", "#!/bin/sh\necho blocked by hook >&2\nexit 1\n");
      await chmod(hook, 0o755);
      const r = rig();
      expect(await createPublishCommand(r.deps)([], ctx)).toBe(1);
      expect(
        ctx.log.lines.some(
          (line) => line.level === "error" && line.message.startsWith("Commit failed"),
        ),
      ).toBe(true);
      // The narration was made and written; only the commit was blocked.
      expect(r.out.join("")).toContain("2026-10-07  audio ready");
    });
  });

  describe("pushing", () => {
    it("rebases onto a concurrent push of another file", async () => {
      await seed("2026-10-07");
      git(pair.b, "pull", "-q", "origin", "main");
      await put(pair.b, "state/seen.json", '{ "version": 1, "items": { "z": "1" } }\n');
      await commitAll(pair.b, "chore: concurrent");
      git(pair.b, "push", "-q", "origin", "main");
      expect(await createPublishCommand(rig().deps)([], ctx)).toBe(0);
      expect(remoteSubject()).toBe("chore(audio): add narration for 2026-10-07");
      expect(git(pair.remote, "log", "--format=%s", "-2", "refs/heads/main")).toContain(
        "chore: concurrent",
      );
    });

    it("exits 1 when a concurrent writer changed usage.json too", async () => {
      await seed("2026-10-07");
      git(pair.b, "pull", "-q", "origin", "main");
      await put(
        pair.b,
        "state/usage.json",
        '{ "version": 1, "speechify": { "month": "2026-10", "characters": 77 } }\n',
      );
      await commitAll(pair.b, "chore: other usage");
      git(pair.b, "push", "-q", "origin", "main");
      const before = remoteHead();
      const out: string[] = [];
      const r = rig();
      expect(
        await createPublishCommand({ ...r.deps, out: (text) => void out.push(text) })([], ctx),
      ).toBe(1);
      expect(remoteHead()).toBe(before);
      expect(out.join("")).toContain("push failed (rebase_conflict)");
      expect(
        ctx.log.lines.some(
          (line) => line.level === "error" && line.message.includes("push failed"),
        ),
      ).toBe(true);
    });
  });

  describe("--prune", () => {
    it("prunes old narrations with nothing else to do and commits nothing", async () => {
      await seed("2026-10-07");
      const r = rig();
      await createPublishCommand(r.deps)([], ctx);
      const head = remoteHead();
      r.blob.seed("audio/2025-01-01.mp3", new Date("2025-01-01T00:00:00Z"));
      r.out.length = 0;

      expect(await createPublishCommand(r.deps)(["--prune", "30"], ctx)).toBe(0);
      expect(r.blob.store.has("audio/2025-01-01.mp3")).toBe(false);
      expect(r.blob.store.has("audio/2026-10-07.mp3")).toBe(true);
      expect(r.out.join("")).toContain("pruned 1 old narrations, kept 1");
      expect(remoteHead()).toBe(head);
    });

    it("prunes alongside publishing", async () => {
      await seed("2026-10-07");
      const r = rig();
      r.blob.seed("audio/2025-01-01.mp3", new Date("2025-01-01T00:00:00Z"));
      expect(await createPublishCommand(r.deps)(["--prune", "30"], ctx)).toBe(0);
      expect(r.blob.store.has("audio/2025-01-01.mp3")).toBe(false);
      expect(audioOf("2026-10-07")).not.toBeNull();
    });
  });
});
