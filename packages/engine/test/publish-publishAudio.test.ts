import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AudioTimeline,
  audioTimelineRelPath,
  digestRelPath,
  parseDigestFile,
  STATE_FILES,
  serializeDigestFile,
} from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUsage } from "../src/audio/budget.js";
import { SpeechifyError } from "../src/audio/speechify.js";
import { buildSpokenText } from "../src/audio/spokenText.js";
import type { PublishAudioDeps } from "../src/publish/publishAudio.js";
import {
  listDigestTargets,
  listPendingDigests,
  publishAudio,
} from "../src/publish/publishAudio.js";
import type {
  FakeBlob,
  FakeSpeech,
  FakeSpeechOptions,
  TempRoot,
  TestLogger,
} from "./audio-fixtures.js";
import {
  digestFor,
  makeDigest,
  makeFakeBlob,
  makeFakeSpeech,
  makeLogger,
  makeTempRoot,
  must,
  writeDigest,
  writeRepoFile,
} from "./audio-fixtures.js";

const NOW = new Date("2026-10-07T06:00:00Z");

interface Harness {
  temp: TempRoot;
  speech: FakeSpeech;
  blob: FakeBlob;
  log: TestLogger;
  sleeps: number[];
  deps: PublishAudioDeps;
}

let harness: Harness;

async function setup(
  speechOptions: FakeSpeechOptions = {},
  monthlyChars = 500_000,
): Promise<Harness> {
  const temp = await makeTempRoot();
  const speech = makeFakeSpeech(speechOptions);
  const blob = makeFakeBlob();
  const log = makeLogger();
  const sleeps: number[] = [];
  return {
    temp,
    speech,
    blob,
    log,
    sleeps,
    deps: {
      root: temp.root,
      speech,
      blob,
      log,
      now: () => NOW,
      monthlyChars,
      sleep: async (ms) => void sleeps.push(ms),
    },
  };
}

beforeEach(async () => {
  harness = await setup();
});
afterEach(async () => {
  await harness.temp.cleanup();
});

const read = (rel: string): Promise<string> => readFile(join(harness.temp.root, rel), "utf8");

async function readDigest(id: string) {
  return parseDigestFile(await read(digestRelPath(id)));
}

describe("publishAudio: one digest", () => {
  it("narrates a digest whose audio is null", async () => {
    const digest = makeDigest();
    await writeDigest(harness.temp.root, digest);
    const result = await publishAudio(harness.deps);

    expect(result.outcomes).toEqual([
      expect.objectContaining({
        status: "published",
        digestId: "2026-10-07",
        url: "https://store.public.blob.vercel-storage.com/audio/2026-10-07.mp3",
        timeline: "marks",
      }),
    ]);
    expect(harness.blob.puts).toEqual(["audio/2026-10-07.mp3"]);
    expect(must(harness.blob.store.get("audio/2026-10-07.mp3")).options.contentType).toBe(
      "audio/mpeg",
    );
  });

  it("writes the timeline next to the digest in the AudioTimeline schema", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    await publishAudio(harness.deps);
    const timeline = AudioTimeline.parse(
      JSON.parse(await read(audioTimelineRelPath("2026-10-07"))),
    );
    expect(timeline.digest).toBe("2026-10-07");
    expect(timeline.timeline).toBe("marks");
    expect(timeline.items).toHaveLength(5);
    expect(timeline.voice).toBe("geffen_32");
    expect(timeline.model).toBe("simba-3.2");
    expect((await read(audioTimelineRelPath("2026-10-07"))).endsWith("\n")).toBe(true);
  });

  it("rewrites the digest's audio field and nothing else", async () => {
    const digest = makeDigest();
    await writeDigest(harness.temp.root, digest);
    await publishAudio(harness.deps);
    const after = await readDigest("2026-10-07");
    const timeline = AudioTimeline.parse(
      JSON.parse(await read(audioTimelineRelPath("2026-10-07"))),
    );
    expect(after.audio).toEqual({
      url: "https://store.public.blob.vercel-storage.com/audio/2026-10-07.mp3",
      duration_ms: timeline.duration_ms,
    });
    expect({ ...after, audio: null }).toEqual({ ...digest, audio: null });
  });

  it("records the billed characters in usage.json", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    await publishAudio(harness.deps);
    const sent = must(harness.speech.calls.marks[0]).text.length;
    expect((await loadUsage(harness.temp.root, NOW)).speechify.characters).toBe(sent);
  });

  it("sends the spoken text, voice, model and format to the synthesizer", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    await publishAudio({
      ...harness.deps,
      voiceId: "voice_x",
      model: "simba-3.0",
      outputFormat: "mp3_24000_64",
    });
    const request = must(harness.speech.calls.marks[0]);
    expect(
      request.text.startsWith(
        "This is Singularity for Wednesday the seventh of October. Five stories today",
      ),
    ).toBe(true);
    expect(request).toMatchObject({
      voiceId: "voice_x",
      model: "simba-3.0",
      outputFormat: "mp3_24000_64",
    });
  });

  it("lists exactly the files it wrote", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    const result = await publishAudio(harness.deps);
    expect(result.changedPaths).toEqual([
      "Digests/2026/10/2026-10-07.audio.json",
      "Digests/2026/10/2026-10-07.md",
      STATE_FILES.usage,
    ]);
  });

  it("reports no warnings on a clean run", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    const result = await publishAudio(harness.deps);
    expect(result.warnings).toEqual([]);
  });
});

describe("publishAudio: idempotence", () => {
  it("skips a digest that already has audio and a timeline", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    await publishAudio(harness.deps);
    const before = [
      await read(digestRelPath("2026-10-07")),
      await read(audioTimelineRelPath("2026-10-07")),
      await read(STATE_FILES.usage),
    ];

    const second = await publishAudio(harness.deps);
    expect(second.outcomes).toEqual([
      { status: "skipped", digestId: "2026-10-07", reason: "complete" },
    ]);
    expect(second.changedPaths).toEqual([]);
    expect(harness.speech.calls.marks).toHaveLength(1);
    expect(harness.blob.puts).toHaveLength(1);
    expect([
      await read(digestRelPath("2026-10-07")),
      await read(audioTimelineRelPath("2026-10-07")),
      await read(STATE_FILES.usage),
    ]).toEqual(before);
  });

  it("regenerates when audio is set but the timeline file is missing", async () => {
    await writeDigest(
      harness.temp.root,
      makeDigest({ audio: { url: "https://old.example/a.mp3", duration_ms: 1000 } }),
    );
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0]).status).toBe("published");
    expect((await readDigest("2026-10-07")).audio?.url).toContain("/audio/2026-10-07.mp3");
  });

  it("regenerates when the timeline exists but audio is null", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    await writeRepoFile(harness.temp.root, audioTimelineRelPath("2026-10-07"), "{}\n");
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0]).status).toBe("published");
    expect(
      AudioTimeline.parse(JSON.parse(await read(audioTimelineRelPath("2026-10-07")))).items,
    ).toHaveLength(5);
  });

  it("regenerates a complete digest only when forced", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    await publishAudio(harness.deps);
    const forced = await publishAudio(harness.deps, { force: true });
    expect(must(forced.outcomes[0]).status).toBe("published");
    expect(harness.speech.calls.marks).toHaveLength(2);
    expect(harness.blob.store.size).toBe(1);
  });

  it("converges: a failed digest is retried on the next run while finished ones are skipped", async () => {
    await writeDigest(harness.temp.root, digestFor("2026-10-05"));
    await writeDigest(harness.temp.root, digestFor("2026-10-07"));
    let failNext = true;
    harness.deps.speech = makeFakeSpeech({
      failMarksCall: () => {
        if (!failNext) return undefined;
        failNext = false;
        return new SpeechifyError("boom", { status: 500 });
      },
    });
    const first = await publishAudio(harness.deps);
    expect(first.outcomes.map((outcome) => `${outcome.digestId}:${outcome.status}`)).toEqual([
      "2026-10-07:failed",
      "2026-10-05:published",
    ]);
    const second = await publishAudio(harness.deps);
    expect(second.outcomes.map((outcome) => `${outcome.digestId}:${outcome.status}`)).toEqual([
      "2026-10-07:published",
      "2026-10-05:skipped",
    ]);
  });
});

describe("publishAudio: several digests", () => {
  it("processes newest first", async () => {
    for (const id of ["2026-09-30", "2026-10-07", "2026-10-07-weekly", "2026-10-05"]) {
      await writeDigest(harness.temp.root, digestFor(id));
    }
    const result = await publishAudio(harness.deps);
    expect(result.outcomes.map((outcome) => outcome.digestId)).toEqual([
      "2026-10-07-weekly",
      "2026-10-07",
      "2026-10-05",
      "2026-09-30",
    ]);
  });

  it("limits work to --digest", async () => {
    await writeDigest(harness.temp.root, digestFor("2026-10-05"));
    await writeDigest(harness.temp.root, digestFor("2026-10-07"));
    const result = await publishAudio(harness.deps, { digestId: "2026-10-05" });
    expect(result.outcomes.map((outcome) => outcome.digestId)).toEqual(["2026-10-05"]);
    expect((await readDigest("2026-10-07")).audio).toBeNull();
  });

  it("reports an unknown --digest as a failed read", async () => {
    const result = await publishAudio(harness.deps, { digestId: "2026-01-01" });
    expect(result.outcomes).toEqual([
      {
        status: "failed",
        digestId: "2026-01-01",
        stage: "read",
        error: expect.stringContaining("does not exist"),
      },
    ]);
  });

  it("does nothing when there are no digests", async () => {
    expect(await publishAudio(harness.deps)).toEqual({
      outcomes: [],
      warnings: [],
      changedPaths: [],
    });
  });

  it("ignores a digest filed under the wrong month", async () => {
    await writeRepoFile(harness.temp.root, "Digests/2026/09/2026-10-07.md", "---\n---\n");
    expect(await listDigestTargets(harness.temp.root)).toEqual([]);
  });

  it("ignores files that are not digests", async () => {
    await writeRepoFile(harness.temp.root, "Digests/2026/10/notes.md", "x");
    await writeRepoFile(harness.temp.root, "Digests/2026/10/2026-10-07.audio.json", "{}");
    await writeRepoFile(harness.temp.root, "Digests/README.md", "x");
    expect(await listDigestTargets(harness.temp.root)).toEqual([]);
  });
});

describe("publishAudio: failure isolation", () => {
  it("a synthesis failure leaves that digest's audio null and does not stop the others", async () => {
    await writeDigest(harness.temp.root, digestFor("2026-10-05"));
    await writeDigest(harness.temp.root, digestFor("2026-10-06"));
    await writeDigest(harness.temp.root, digestFor("2026-10-07"));
    harness.deps.speech = makeFakeSpeech({
      failMarksCall: (index) =>
        index === 1
          ? new SpeechifyError("Speechify request failed (HTTP 500)", { status: 500 })
          : undefined,
    });
    const result = await publishAudio(harness.deps);

    expect(result.outcomes.map((outcome) => `${outcome.digestId}:${outcome.status}`)).toEqual([
      "2026-10-07:published",
      "2026-10-06:failed",
      "2026-10-05:published",
    ]);
    expect(must(result.outcomes[1])).toMatchObject({
      stage: "synthesis",
      error: expect.stringContaining("HTTP 500"),
    });
    expect((await readDigest("2026-10-06")).audio).toBeNull();
    expect((await readDigest("2026-10-07")).audio).not.toBeNull();
    expect((await readDigest("2026-10-05")).audio).not.toBeNull();
    expect(result.warnings).toEqual([
      expect.stringContaining("2026-10-06: audio failed at synthesis"),
    ]);
  });

  it("a failed digest leaves no timeline file and no upload", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    harness.deps.speech = makeFakeSpeech({ failMarksCall: () => new Error("down") });
    await publishAudio(harness.deps);
    await expect(read(audioTimelineRelPath("2026-10-07"))).rejects.toThrow();
    expect(harness.blob.puts).toEqual([]);
  });

  it("a failed synthesis does not spend budget", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    harness.deps.speech = makeFakeSpeech({ failMarksCall: () => new Error("down") });
    await publishAudio(harness.deps);
    expect((await loadUsage(harness.temp.root, NOW)).speechify.characters).toBe(0);
  });

  it("counts the characters a stream synthesized before it failed", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    harness.deps.speech = makeFakeSpeech({
      failMarksCall: () =>
        new SpeechifyError("Speechify stream failed (upstream_failure)", {
          code: "upstream_failure",
          partialCharacters: 321,
        }),
    });
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0])).toMatchObject({ status: "failed", stage: "synthesis" });
    expect((await loadUsage(harness.temp.root, NOW)).speechify.characters).toBe(321);
    expect(result.changedPaths).toEqual([]);
  });

  it("keeps counting partial spend across retries so a loop cannot outrun the allowance", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    harness.deps.speech = makeFakeSpeech({
      failMarksCall: () => new SpeechifyError("cut", { partialCharacters: 100 }),
    });
    await publishAudio(harness.deps);
    await publishAudio(harness.deps);
    await publishAudio(harness.deps);
    expect((await loadUsage(harness.temp.root, NOW)).speechify.characters).toBe(300);
  });

  it("an upload failure leaves audio null but still records the spend", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    harness.blob.failNextPuts = 10;
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0])).toMatchObject({ status: "failed", stage: "upload" });
    expect((await readDigest("2026-10-07")).audio).toBeNull();
    await expect(read(audioTimelineRelPath("2026-10-07"))).rejects.toThrow();
    expect((await loadUsage(harness.temp.root, NOW)).speechify.characters).toBeGreaterThan(0);
  });

  it("retries a failed upload up to three attempts with a growing pause", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    harness.blob.failNextPuts = 10;
    await publishAudio(harness.deps);
    expect(harness.blob.puts).toHaveLength(3);
    expect(harness.sleeps).toEqual([1000, 2000]);
  });

  it("succeeds when the upload recovers on a retry, without synthesizing twice", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    harness.blob.failNextPuts = 2;
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0]).status).toBe("published");
    expect(harness.speech.calls.marks).toHaveLength(1);
    expect(harness.blob.puts).toHaveLength(3);
  });

  it("honours a custom number of upload attempts", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    harness.blob.failNextPuts = 10;
    await publishAudio({ ...harness.deps, uploadAttempts: 1 });
    expect(harness.blob.puts).toHaveLength(1);
  });

  it("an unreadable digest is reported and the rest continue", async () => {
    await writeRepoFile(harness.temp.root, digestRelPath("2026-10-06"), "not a digest");
    await writeDigest(harness.temp.root, digestFor("2026-10-07"));
    const result = await publishAudio(harness.deps);
    expect(result.outcomes.map((outcome) => `${outcome.digestId}:${outcome.status}`)).toEqual([
      "2026-10-07:published",
      "2026-10-06:failed",
    ]);
    expect(must(result.outcomes[1])).toMatchObject({ stage: "read" });
  });

  it("a digest whose file name and id disagree is rejected", async () => {
    const wrong = makeDigest({ id: "2026-10-08", date: "2026-10-08" });
    await writeRepoFile(harness.temp.root, digestRelPath("2026-10-07"), serializeDigestFile(wrong));
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0])).toMatchObject({
      status: "failed",
      stage: "read",
      error: expect.stringContaining("expected 2026-10-07"),
    });
  });

  it("a digest too long to narrate fails at spoken_text without a request", async () => {
    const long = makeDigest();
    long.items[0] = { ...must(long.items[0]), summary: "word ".repeat(5000) };
    await writeDigest(harness.temp.root, long);
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0])).toMatchObject({ status: "failed", stage: "spoken_text" });
    expect(harness.speech.calls.marks).toEqual([]);
  });

  it("a corrupt usage file fails the digest at budget without a request", async () => {
    await writeDigest(harness.temp.root, makeDigest());
    await writeRepoFile(harness.temp.root, STATE_FILES.usage, "{broken");
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0])).toMatchObject({ status: "failed", stage: "budget" });
    expect(harness.speech.calls.marks).toEqual([]);
  });
});

describe("publishAudio: budget", () => {
  it("refuses when the request would pass 90 percent of the allowance", async () => {
    await harness.temp.cleanup();
    harness = await setup({}, 100);
    await writeDigest(harness.temp.root, makeDigest());
    const result = await publishAudio(harness.deps);
    const outcome = must(result.outcomes[0]);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") {
      expect(outcome.refusal).toMatchObject({
        reason: "monthly_budget",
        limit: 90,
        monthlyChars: 100,
      });
    }
    expect(harness.speech.calls.marks).toEqual([]);
    expect((await readDigest("2026-10-07")).audio).toBeNull();
    expect(result.warnings).toEqual([expect.stringContaining("2026-10-07: audio skipped")]);
    expect(result.changedPaths).toEqual([]);
  });

  it("refuses the later digest once earlier ones used the allowance", async () => {
    const newest = buildSpokenText(digestFor("2026-10-07")).text.length;
    await harness.temp.cleanup();
    // Room for the newest digest under the 90 percent limit, but not for a second one.
    harness = await setup({}, Math.ceil((newest + 10) / 0.9));
    await writeDigest(harness.temp.root, digestFor("2026-10-06"));
    await writeDigest(harness.temp.root, digestFor("2026-10-07"));
    const result = await publishAudio(harness.deps);
    expect(result.outcomes.map((outcome) => `${outcome.digestId}:${outcome.status}`)).toEqual([
      "2026-10-07:published",
      "2026-10-06:refused",
    ]);
    expect(harness.speech.calls.marks).toHaveLength(1);
  });

  it("rolls the budget over at the start of a new month", async () => {
    await writeRepoFile(
      harness.temp.root,
      STATE_FILES.usage,
      JSON.stringify({ version: 1, speechify: { month: "2026-09", characters: 449_000 } }),
    );
    await writeDigest(harness.temp.root, makeDigest());
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0]).status).toBe("published");
    expect((await loadUsage(harness.temp.root, NOW)).speechify.month).toBe("2026-10");
  });
});

describe("publishAudio: timelines without marks", () => {
  it("uses an estimated timeline, with a warning, when the stream returns no marks", async () => {
    harness.deps.speech = makeFakeSpeech({ marksFor: () => [] });
    await writeDigest(harness.temp.root, makeDigest());
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0])).toMatchObject({ status: "published", timeline: "estimated" });
    expect(
      AudioTimeline.parse(JSON.parse(await read(audioTimelineRelPath("2026-10-07")))).timeline,
    ).toBe("estimated");
    expect(result.warnings).toEqual([expect.stringContaining("estimated timeline")]);
    expect((await readDigest("2026-10-07")).audio).not.toBeNull();
  });

  it("falls back to the plain stream when marks are unsupported", async () => {
    const speech = makeFakeSpeech({
      failMarksCall: () =>
        new SpeechifyError("unsupported", { status: 400, code: "speech_marks_unsupported" }),
    });
    harness.deps.speech = speech;
    await writeDigest(harness.temp.root, makeDigest());
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0])).toMatchObject({ status: "published", timeline: "estimated" });
    expect(speech.calls.plain).toHaveLength(1);
    expect(speech.calls.marks).toHaveLength(1);
    expect(
      harness.log.lines.some(
        (line) => line.level === "warn" && /Speech marks unavailable/.test(line.message),
      ),
    ).toBe(true);
  });

  it("does not fall back on an authentication failure", async () => {
    const speech = makeFakeSpeech({
      failMarksCall: () =>
        new SpeechifyError("unauthorized", { status: 401, code: "unauthorized" }),
    });
    harness.deps.speech = speech;
    await writeDigest(harness.temp.root, makeDigest());
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0])).toMatchObject({ status: "failed", stage: "synthesis" });
    expect(speech.calls.plain).toEqual([]);
  });

  it("fails at synthesis when the plain stream fails too", async () => {
    harness.deps.speech = makeFakeSpeech({
      failMarksCall: () =>
        new SpeechifyError("unsupported", { status: 400, code: "speech_marks_unsupported" }),
      failPlain: new SpeechifyError("also down", { status: 500 }),
    });
    await writeDigest(harness.temp.root, makeDigest());
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0])).toMatchObject({ status: "failed", stage: "synthesis" });
  });

  it("uses an estimated timeline when marks skip a whole item", async () => {
    harness.deps.speech = makeFakeSpeech({
      marksFor: (request) => {
        const marks = [...request.text.matchAll(/\S+/g)].map((match, index) => ({
          type: "word",
          start: match.index ?? 0,
          end: (match.index ?? 0) + match[0].length,
          start_time: index * 100,
          end_time: index * 100 + 90,
          value: match[0],
        }));
        // Drop everything after the opening line so no item has a mark.
        return marks.slice(0, 6);
      },
    });
    await writeDigest(harness.temp.root, makeDigest());
    const result = await publishAudio(harness.deps);
    expect(must(result.outcomes[0])).toMatchObject({ status: "published", timeline: "estimated" });
  });
});

describe("publishAudio: pruning", () => {
  it("prunes old narrations and touches no digest", async () => {
    harness.blob.seed("audio/2025-01-01.mp3", new Date("2025-01-01T00:00:00Z"));
    harness.blob.seed("audio/2026-10-06.mp3", new Date("2026-10-06T00:00:00Z"));
    await writeDigest(
      harness.temp.root,
      makeDigest({ audio: { url: "https://x.example/a.mp3", duration_ms: 5000 } }),
    );
    await writeRepoFile(harness.temp.root, audioTimelineRelPath("2026-10-07"), "{}\n");
    const result = await publishAudio(harness.deps, { pruneDays: 30 });
    expect(result.pruned).toEqual({ deleted: ["audio/2025-01-01.mp3"], kept: 1 });
    expect((await readDigest("2026-10-07")).audio?.url).toBe("https://x.example/a.mp3");
    expect(result.changedPaths).toEqual([]);
  });

  it("turns a prune failure into a warning", async () => {
    harness.blob.failList = new Error("list failed");
    const result = await publishAudio(harness.deps, { pruneDays: 30 });
    expect(result.pruned).toBeUndefined();
    expect(result.warnings).toEqual(["prune failed: list failed"]);
  });

  it("does not prune unless asked", async () => {
    harness.blob.seed("audio/2025-01-01.mp3", new Date("2025-01-01T00:00:00Z"));
    await publishAudio(harness.deps);
    expect(harness.blob.deletes).toEqual([]);
  });
});

describe("listPendingDigests", () => {
  it("lists digests without audio or without a timeline, newest first", async () => {
    await writeDigest(harness.temp.root, digestFor("2026-10-05"));
    await writeDigest(harness.temp.root, digestFor("2026-10-07"));
    await publishAudio(harness.deps, { digestId: "2026-10-07" });
    expect(await listPendingDigests(harness.temp.root)).toEqual(["2026-10-05"]);
  });

  it("includes everything when forced and an unreadable digest as pending", async () => {
    await writeDigest(harness.temp.root, digestFor("2026-10-07"));
    await publishAudio(harness.deps);
    await writeRepoFile(harness.temp.root, digestRelPath("2026-10-06"), "garbage");
    expect(await listPendingDigests(harness.temp.root)).toEqual(["2026-10-06"]);
    expect(await listPendingDigests(harness.temp.root, { force: true })).toEqual([
      "2026-10-07",
      "2026-10-06",
    ]);
  });

  it("is empty when everything is complete", async () => {
    await writeDigest(harness.temp.root, digestFor("2026-10-07"));
    await publishAudio(harness.deps);
    expect(await listPendingDigests(harness.temp.root)).toEqual([]);
  });
});
