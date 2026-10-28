import { describe, expect, it } from "vitest";
import { fastForwardToRemote } from "../src/git/fastForward.js";
import type { GitRunner } from "../src/git/runGit.js";

const log = { info: () => {}, warn: () => {}, error: () => {} };

// The runner answers each git command by its first word; a name in `failing` exits 1.
function runner(failing: string[] = []): GitRunner {
  return async (args) => {
    const code = failing.includes(args[0] ?? "") ? 1 : 0;
    const stdout = args[0] === "diff" ? "config/topics.json\nstate/seen.json\n" : "main\n";
    return { code, stdout: code === 0 ? stdout : "", stderr: code === 0 ? "" : "fatal" };
  };
}

// The bug (D209): a fast-forward that moved the checkout but could not list what it changed came
// back as "no paths changed", so the commit kept its store-sync marker and claimed a snapshot of
// config files that no longer equal the store's.
describe("fastForwardToRemote", () => {
  it("reports the changed paths after a fast-forward", async () => {
    const result = await fastForwardToRemote(runner(), log as never);
    expect(result).toEqual({ moved: true, changed: ["config/topics.json", "state/seen.json"] });
  });

  it("reports the changed paths as unknown when the diff fails, never as none", async () => {
    const result = await fastForwardToRemote(runner(["diff"]), log as never);
    expect(result.moved).toBe(true);
    expect(result.changed).toBeNull();
  });

  it("leaves the checkout and the marker alone when the fast-forward cannot run", async () => {
    const result = await fastForwardToRemote(runner(["merge"]), log as never);
    expect(result).toEqual({ moved: false, changed: [] });
  });
});
