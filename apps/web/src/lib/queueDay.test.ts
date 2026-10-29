import { describe, expect, it } from "vitest";
import { clearDay, forget, readDay, remember } from "./queueDay";

const store = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

const noon = new Date(2026, 9, 29, 12, 0).getTime();
const nextMorning = new Date(2026, 9, 30, 8, 0).getTime();

describe("the day's queue", () => {
  // A queue that never emptied would show last week's Catch ups above today's; one that forgot
  // on every redraw would lose a finished podcast the moment the page changed.
  it("keeps today's ended runs once each, newest first, and lets go of them when the day changes", () => {
    const s = store();
    remember(s, { id: 1, phase: "done" }, noon - 60_000, noon);
    remember(s, { id: 2, phase: "failed" }, noon, noon);
    remember(s, { id: 2, phase: "failed" }, noon, noon);
    expect(readDay(s, noon).map((entry) => entry.run.id)).toEqual([2, 1]);
    expect(readDay(s, nextMorning)).toEqual([]);
  });

  it("forgets one run for Check again and Try again, and all of them for Clear queue", () => {
    const s = store();
    remember(s, { id: 1 }, noon, noon);
    remember(s, { id: 2 }, noon - 1, noon);
    forget(s, 1, noon);
    expect(readDay(s, noon).map((entry) => entry.run.id)).toEqual([2]);
    clearDay(s);
    expect(readDay(s, noon)).toEqual([]);
  });
});
