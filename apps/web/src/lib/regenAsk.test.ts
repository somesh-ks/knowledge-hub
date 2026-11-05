import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCommentAsker } from "./regenAsk";

const reply = (body: unknown) => ({ ok: true, json: async () => body });

describe("createCommentAsker (D371)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // The bug it prevents: words changed back to ones already read costing two more paid model calls.
  it("never asks the same words twice, even after other words in between", async () => {
    const fetchMock = vi.fn(async () => reply({ length: true, topics: false }));
    vi.stubGlobal("fetch", fetchMock);
    const asker = createCommentAsker(() => {});
    asker.note("it dragged on", []);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    asker.note("it dragged on and on", []);
    asker.note("it dragged on", []);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // The bug it prevents: a failed read of new words leaving the answer to the old words in place.
  it("drops the old answer when the read of the new words fails", async () => {
    const answers: unknown[] = [];
    let fail = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        if (fail) throw new Error("offline");
        return reply(
          JSON.parse(init.body).want === "values"
            ? { length: "shorter", add: [] }
            : { length: true, topics: false },
        );
      }),
    );
    const asker = createCommentAsker((answer) => answers.push(answer));
    asker.note("it dragged on", []);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(asker.answer().values.length).toBe("shorter");
    fail = true;
    asker.note("it dragged on for ages", []);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(asker.answer().values.length).toBeNull();
    expect(asker.answer().hints.length).toBe(false);
  });
});
