import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandContext } from "../context.js";
import { makeStateCommand } from "./state.js";

async function context(env: Record<string, string>): Promise<CommandContext> {
  const lines: string[] = [];
  const log = {
    debug() {},
    info() {},
    warn() {},
    error: (message: string) => void lines.push(message),
  };
  return {
    root: await mkdtemp(join(tmpdir(), "state-cmd-")),
    env,
    json: false,
    log,
    now: () => new Date("2026-11-06T00:00:00Z"),
  } as unknown as CommandContext;
}

describe("state command", () => {
  // The bug: a push step with no DATABASE_URL must fail the job (exit 1), not pass as "nothing to
  // push", and a bad flag must be a usage error, so a typo in a workflow is caught on its first run.
  it("exits 1 without DATABASE_URL, 2 for a flag or subcommand that does not exist", async () => {
    const run = makeStateCommand();
    expect(await run(["push"], await context({}))).toBe(1);
    expect(await run(["push", "--dry-run"], await context({ DATABASE_URL: "postgres://x" }))).toBe(
      2,
    );
    expect(await run(["nope"], await context({}))).toBe(2);
  });

  // The bug: a driver error that quotes the connection string must not reach the CI log.
  it("redacts the database password from a failure", async () => {
    const ctx = await context({ DATABASE_URL: "postgres://user:pa%40ssword99@host/db" });
    const errors: string[] = [];
    (ctx.log as { error: (m: string) => void }).error = (m) => void errors.push(m);
    const run = makeStateCommand({
      connect: async () => {
        throw new Error(
          "could not connect with pa@ssword99 at postgres://user:pa%40ssword99@host/db",
        );
      },
    });
    expect(await run(["pull"], ctx)).toBe(1);
    expect(errors.join("\n")).not.toContain("pa@ssword99");
    expect(errors.join("\n")).not.toContain("pa%40ssword99");
  });
});
