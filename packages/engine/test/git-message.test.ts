import { describe, expect, it } from "vitest";
import { commitAndPush } from "../src/git/commit.js";

// The Conventional Commit check runs before any git call, so no repository is needed: a refused
// subject never reaches the runner, and an accepted one asks git for the status and finds nothing.
describe("commitAndPush: message", () => {
  const calls: string[][] = [];
  const runner = async (args: readonly string[]) => {
    calls.push([...args]);
    return { code: 0, stdout: "", stderr: "" };
  };
  const commit = (message: string) =>
    commitAndPush({ root: "/nowhere", message, command: "run", push: false, git: runner });

  it.each(["update stuff", "Chore: capital", "chore:missing space", "chore(): empty scope", ""])(
    "refuses the non-conventional subject %j before touching git",
    async (message) => {
      calls.length = 0;
      expect(await commit(message)).toMatchObject({ status: "refused", reason: "message" });
      expect(calls).toEqual([]);
    },
  );

  it.each([
    "feat: add thing",
    "fix(engine): handle 429",
    "chore(digest): 2026-10-07",
    "docs: update readme",
    "refactor(core)!: rename field",
    "ci: pin actions",
    "chore(digest): 2026-10-07\n\nThree sources failed.",
  ])("accepts %j", async (message) => {
    expect((await commit(message)).status).toBe("nothing_to_commit");
  });
});
