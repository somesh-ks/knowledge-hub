import { describe, expect, it } from "vitest";
import {
  createSegmentQueue,
  type NarrateResult,
  type NarrationError,
  type NarrationFailure,
} from "./segmentQueue";
import type { TrackSegment } from "./trackAudio";

function segments(): TrackSegment[] {
  return ["intro", "a", "b", "c", "d"].map((key, index) => ({
    key,
    start: index * 10,
    end: index * 10 + 10,
    url: key === "intro" ? "https://blob.test/intro.mp3" : null,
  }));
}

function setup(passphrase: string | null = "open sesame") {
  const list = segments();
  const sent: string[] = [];
  const answers = new Map<string, (result: NarrateResult) => void>();
  const failures: Array<[NarrationFailure, boolean]> = [];
  const progress: number[] = [];
  const phrase = { value: passphrase };
  const queue = createSegmentQueue({
    segments: list,
    narrate(key) {
      sent.push(key);
      return new Promise((resolve) => answers.set(key, resolve));
    },
    getPassphrase: () => phrase.value,
    onFailure: (reason, needed) => failures.push([reason, needed]),
    onProgress: (ready) => progress.push(ready),
  });
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const answer = async (key: string, result: NarrateResult) => {
    answers.get(key)?.(result);
    await settle();
  };
  const ok = (key: string) => answer(key, { ok: true, url: `https://blob.test/${key}.mp3` });
  return { list, queue, sent, failures, progress, phrase, answer, ok, settle };
}

const reasonOf = (error: unknown) => (error as NarrationError).reason;

describe("a guessed address", () => {
  it("is asked of the server by warm and confirm, and confirm joins the request on its way", async () => {
    const { list, queue, sent, ok } = setup();
    const intro = list[0];
    if (intro) intro.unconfirmed = true;
    queue.warm(0);
    expect(sent).toEqual(["intro"]);
    const confirmed = queue.confirm(0);
    expect(sent).toEqual(["intro"]);
    await ok("intro");
    await expect(confirmed).resolves.toBe("https://blob.test/intro.mp3");
    expect(intro?.unconfirmed).toBe(false);
    // Known now: nothing more to ask.
    queue.warm(0);
    await expect(queue.confirm(0)).resolves.toBe("https://blob.test/intro.mp3");
    expect(sent).toEqual(["intro"]);
  });

  it("is still handed over at once by ensure, which only the playhead uses", async () => {
    const { list, queue, sent } = setup();
    const intro = list[0];
    if (intro) intro.unconfirmed = true;
    await expect(queue.ensure(0)).resolves.toBe("https://blob.test/intro.mp3");
    expect(sent).toEqual([]);
  });

  it("warm sends nothing after a standing refusal", async () => {
    const { queue, sent, answer } = setup();
    queue.warm(1);
    await answer("a", { ok: false, reason: "daily_cap" });
    queue.warm(2);
    expect(sent).toEqual(["a"]);
  });
});

describe("createSegmentQueue", () => {
  it("answers at once for a segment that already has its file", async () => {
    const { queue, sent } = setup();
    await expect(queue.ensure(0)).resolves.toBe("https://blob.test/intro.mp3");
    expect(sent).toEqual([]);
  });

  it("makes a missing file, stores it on the segment and reports progress", async () => {
    const { queue, list, sent, ok, progress } = setup();
    const wanted = queue.ensure(1);
    expect(sent).toEqual(["a"]);
    await ok("a");
    await expect(wanted).resolves.toBe("https://blob.test/a.mp3");
    expect(list[1]?.url).toBe("https://blob.test/a.mp3");
    expect(progress).toEqual([2]);
  });

  it("sends one request at a time", async () => {
    const { queue, sent, ok } = setup();
    queue.prepare(1);
    queue.prepare(2);
    queue.prepare(3);
    expect(sent).toEqual(["a"]);
    await ok("a");
    expect(sent).toEqual(["a", "b"]);
    await ok("b");
    expect(sent).toEqual(["a", "b", "c"]);
  });

  it("lets a file the playhead needs jump the line", async () => {
    const { queue, sent, ok } = setup();
    queue.prepare(1);
    queue.prepare(2);
    queue.prepare(3);
    void queue.ensure(4);
    await ok("a");
    expect(sent).toEqual(["a", "d"]);
    await ok("d");
    expect(sent).toEqual(["a", "d", "b"]);
  });

  it("asks once for a file that is wanted twice", async () => {
    const { queue, sent, ok } = setup();
    const one = queue.ensure(1);
    const two = queue.ensure(1);
    queue.prepare(1);
    expect(sent).toEqual(["a"]);
    await ok("a");
    await expect(Promise.all([one, two])).resolves.toEqual([
      "https://blob.test/a.mp3",
      "https://blob.test/a.mp3",
    ]);
  });

  it("stops after a refusal that trying again will not change", async () => {
    const { queue, sent, answer, failures } = setup();
    // The expectation is attached before the answer, so the rejection always has a handler.
    const wanted = expect(queue.ensure(1)).rejects.toSatisfy(
      (error) => reasonOf(error) === "wrong_passphrase",
    );
    queue.prepare(2);
    queue.prepare(3);
    await answer("a", { ok: false, reason: "wrong_passphrase" });
    await wanted;
    // One bad passphrase is one request, not one per story.
    expect(sent).toEqual(["a"]);
    await expect(queue.ensure(2)).rejects.toSatisfy(
      (error) => reasonOf(error) === "wrong_passphrase",
    );
    expect(failures).toEqual([["wrong_passphrase", true]]);
  });

  it("carries on after reset, with the new passphrase", async () => {
    const { queue, sent, answer, ok, phrase } = setup();
    void queue.ensure(1).catch(() => {});
    await answer("a", { ok: false, reason: "wrong_passphrase" });
    phrase.value = "the right one";
    queue.reset();
    const again = queue.ensure(1);
    expect(sent).toEqual(["a", "a"]);
    await ok("a");
    await expect(again).resolves.toBe("https://blob.test/a.mp3");
  });

  it("asks for the passphrase before sending anything when there is none", async () => {
    const { queue, sent, failures } = setup(null);
    await expect(queue.ensure(1)).rejects.toSatisfy(
      (error) => reasonOf(error) === "passphrase_required",
    );
    expect(sent).toEqual([]);
    expect(failures).toEqual([["passphrase_required", true]]);
  });

  it("does not spend a second request on a hint for a file that just failed", async () => {
    const { queue, sent, answer, ok, failures } = setup();
    queue.prepare(1);
    await answer("a", { ok: false, reason: "failed" });
    expect(failures).toEqual([["failed", false]]);
    queue.prepare(1);
    expect(sent).toEqual(["a"]);
    // The playhead needing it is a different matter.
    const wanted = queue.ensure(1);
    expect(sent).toEqual(["a", "a"]);
    await ok("a");
    await expect(wanted).resolves.toBe("https://blob.test/a.mp3");
  });

  it("moves on to the next file after a passing failure", async () => {
    const { queue, sent, answer } = setup();
    queue.prepare(1);
    queue.prepare(2);
    await answer("a", { ok: false, reason: "failed" });
    expect(sent).toEqual(["a", "b"]);
  });

  it("sends nothing more once stopped, and lets the request in flight finish", async () => {
    const { queue, list, sent, ok } = setup();
    queue.prepare(1);
    queue.prepare(2);
    queue.stop();
    await ok("a");
    expect(list[1]?.url).toBe("https://blob.test/a.mp3");
    expect(sent).toEqual(["a"]);
    queue.prepare(3);
    expect(sent).toEqual(["a"]);
  });

  it("refuses an index that is not a segment", async () => {
    const { queue } = setup();
    await expect(queue.ensure(99)).rejects.toSatisfy(
      (error) => reasonOf(error) === "segment_not_found",
    );
  });
});
