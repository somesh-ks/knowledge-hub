import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli, splitArgs, topLevelHelp } from "../src/cli.js";
import { COMMANDS, type CommandSpec } from "../src/commandRegistry.js";
import type { CommandContext, CommandRun } from "../src/context.js";
import { CONFIG_DOCUMENT_PATHS } from "../src/store/configPaths.js";
import { captureStdout } from "./curate-helpers.js";
import { REPO_ROOT } from "./score-factories.js";

const SECRET = "test-secret-sample-string";
const NOW = new Date("2026-10-07T05:13:00Z");

interface Run {
  code: number;
  out: string;
  err: string;
  ctx?: CommandContext;
  args?: string[];
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "singularity-cli-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function stub(run: CommandRun, name = "stub"): CommandSpec {
  return {
    name,
    summary: "A stub command",
    help: `Usage: dispatch ${name}`,
    load: async () => run,
  };
}

/** Run the CLI with a stub command table and capture what it prints. */
async function cli(
  argv: string[],
  run: CommandRun = async () => 0,
  env: Record<string, string | undefined> = {},
  cwd: string = dir,
): Promise<Run> {
  const result: Run = { code: -1, out: "", err: "" };
  result.code = await runCli(argv, {
    cwd,
    env,
    now: () => NOW,
    stdout: (text) => {
      result.out += text;
    },
    stderr: (text) => {
      result.err += text;
    },
    commands: [
      stub(async (args, ctx) => {
        result.ctx = ctx;
        result.args = args;
        return run(args, ctx);
      }),
    ],
  });
  return result;
}

describe("splitArgs", () => {
  it("finds the command and leaves its arguments alone", () => {
    expect(splitArgs(["fetch", "--since", "2026-10-01", "--weekly"])).toMatchObject({
      command: "fetch",
      rest: ["--since", "2026-10-01", "--weekly"],
      json: false,
      help: false,
    });
  });

  it("accepts the global flags after the command, as the workflows pass them", () => {
    expect(splitArgs(["run", "--stage", "gate", "--mode", "on-demand", "--json"])).toMatchObject({
      command: "run",
      rest: ["--stage", "gate", "--mode", "on-demand"],
      json: true,
    });
  });

  it("accepts the global flags before the command", () => {
    expect(splitArgs(["--json", "--root", "/repo", "status"])).toMatchObject({
      command: "status",
      root: "/repo",
      json: true,
      rest: [],
    });
  });

  it("reads --root in both spellings", () => {
    expect(splitArgs(["status", "--root=/a b"]).root).toBe("/a b");
    expect(splitArgs(["status", "--root", "/c"]).root).toBe("/c");
  });

  it("rejects --root without a path", () => {
    expect(() => splitArgs(["status", "--root"])).toThrow(/--root needs a path/);
    expect(() => splitArgs(["status", "--root", "--json"])).toThrow(/--root needs a path/);
    expect(() => splitArgs(["status", "--root="])).toThrow(/--root needs a path/);
  });

  it("treats -h and --help alike and skips a leading --", () => {
    expect(splitArgs(["--", "run", "-h"])).toMatchObject({ command: "run", help: true, rest: [] });
    expect(splitArgs(["--help"])).toMatchObject({ command: undefined, help: true });
  });

  it("passes unknown flags through to the command", () => {
    expect(splitArgs(["curate", "--mode", "agent", "--bogus"]).rest).toEqual([
      "--mode",
      "agent",
      "--bogus",
    ]);
  });
});

describe("runCli: usage errors exit 2", () => {
  it("prints the command list and exits 2 with no arguments", async () => {
    const result = await cli([]);
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toContain("Commands:");
  });

  it("names an unknown command on stderr and exits 2", async () => {
    const result = await cli(["bogus"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('unknown command "bogus"');
    expect(result.out).toBe("");
  });

  it("exits 2 for --root without a path", async () => {
    const result = await cli(["stub", "--root"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("--root needs a path");
  });

  it("exits 2 when --root does not exist", async () => {
    const result = await cli(["stub", "--root", join(dir, "missing")]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("does not exist");
  });

  it("lets a command report its own usage error through its exit code", async () => {
    const result = await cli(["stub", "--bad", "--root", dir], async () => 2);
    expect(result.code).toBe(2);
    expect(result.args).toEqual(["--bad"]);
  });
});

describe("runCli: help", () => {
  it("lists every command and the global flags with --help", async () => {
    const result = await cli(["--help"]);
    expect(result.code).toBe(0);
    for (const spec of COMMANDS) {
      expect(topLevelHelp(COMMANDS)).toContain(spec.name);
    }
    expect(result.out).toContain("Commands:");
    expect(result.out).toContain("--json");
    expect(result.out).toContain("--root");
    expect(result.out).toContain("Exit codes");
  });

  it("prints a command's help without running it", async () => {
    let called = false;
    const result = await cli(["stub", "--help"], async () => {
      called = true;
      return 0;
    });
    expect(result.code).toBe(0);
    expect(result.out).toBe("Usage: dispatch stub\n");
    expect(called).toBe(false);
  });

  it("has help text for every registered command", async () => {
    for (const spec of COMMANDS) {
      const out: string[] = [];
      const code = await runCli([spec.name, "--help"], {
        stdout: (text) => out.push(text),
        stderr: () => {},
        env: {},
      });
      expect(code).toBe(0);
      expect(out.join("")).toContain(`singularity ${spec.name}`);
    }
  });
});

describe("runCli: running a command", () => {
  it("gives the command its own arguments and a context for the root", async () => {
    const result = await cli(["stub", "--alpha", "one", "--root", dir, "--json"]);
    expect(result.code).toBe(0);
    expect(result.args).toEqual(["--alpha", "one"]);
    expect(result.ctx?.root).toBe(resolve(dir));
    expect(result.ctx?.json).toBe(true);
    expect(result.ctx?.now()).toEqual(NOW);
  });

  it("finds the repository root from the working directory", async () => {
    const result = await cli(["stub"], async () => 0, {}, REPO_ROOT);
    expect(resolve(result.ctx?.root ?? "")).toBe(resolve(REPO_ROOT));
  });

  it("exits 1 outside a git repository when no --root is given", async () => {
    const result = await cli(["stub"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("not inside a git repository");
  });

  it("returns the command's exit code", async () => {
    expect((await cli(["stub", "--root", dir], async () => 0)).code).toBe(0);
    expect((await cli(["stub", "--root", dir], async () => 1)).code).toBe(1);
  });

  it("types the environment, so commands read defaults and never raw strings", async () => {
    const result = await cli(["stub", "--root", dir], async () => 0, {
      MAX_TOKENS_PER_RUN: "1000",
    });
    expect(result.ctx?.env.MAX_TOKENS_PER_RUN).toBe(1000);
    expect(result.ctx?.env.SPEECHIFY_VOICE_ID).toBe("geffen_32");
  });

  it("exits 1 with the variable name, not its value, for a bad environment", async () => {
    const result = await cli(["stub", "--root", dir], async () => 0, {
      MAX_TOKENS_PER_RUN: "not a number",
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain("MAX_TOKENS_PER_RUN");
    expect(result.err).not.toContain("not a number");
  });
});

describe("runCli: failures never leak or dump a stack", () => {
  it("prints one redacted line when a command throws", async () => {
    const result = await cli(
      ["stub", "--root", dir],
      async () => {
        throw new Error(`request failed with key ${SECRET}\n    at somewhere (file.ts:1:1)`);
      },
      { ANTHROPIC_API_KEY: SECRET },
    );
    expect(result.code).toBe(1);
    expect(result.err).toBe("singularity: stub failed: request failed with key [redacted]\n");
    expect(result.err).not.toContain(SECRET);
    expect(result.err).not.toContain("at somewhere");
    expect(result.out).toBe("");
  });

  it("redacts the secrets the typed environment does not list", async () => {
    const token = "vercel-token-abcdef123456";
    const result = await cli(
      ["stub", "--root", dir],
      async () => {
        throw new Error(`deploy failed for ${token}`);
      },
      { VERCEL_TOKEN: token },
    );
    expect(result.err).not.toContain(token);
  });

  it("redacts secrets in log lines too", async () => {
    const result = await cli(
      ["stub", "--root", dir],
      async (_args, ctx) => {
        ctx.log.warn(`calling with ${SECRET}`);
        return 0;
      },
      { ANTHROPIC_API_KEY: SECRET },
    );
    expect(result.err).toContain("warn: calling with [redacted]");
    expect(result.err).not.toContain(SECRET);
  });

  it("handles a thrown non-error value", async () => {
    const result = await cli(["stub", "--root", dir], async () => {
      throw "plain string";
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain("plain string");
  });
});

describe("runCli: streams", () => {
  it("sends logs to stderr and keeps stdout for results", async () => {
    const result = await cli(["stub", "--root", dir], async (_args, ctx) => {
      ctx.log.info("working");
      return 0;
    });
    expect(result.err).toBe("info: working\n");
    expect(result.out).toBe("");
  });

  it("writes JSON log lines with --json", async () => {
    const result = await cli(["stub", "--root", dir, "--json"], async (_args, ctx) => {
      ctx.log.info("working", { step: 1 });
      return 0;
    });
    expect(JSON.parse(result.err)).toEqual({ level: "info", message: "working", step: 1 });
  });

  it("hides debug lines unless SINGULARITY_DEBUG=1", async () => {
    const run: CommandRun = async (_args, ctx) => {
      ctx.log.debug("details");
      return 0;
    };
    expect((await cli(["stub", "--root", dir], run)).err).toBe("");
    expect((await cli(["stub", "--root", dir], run, { SINGULARITY_DEBUG: "1" })).err).toContain(
      "debug: details",
    );
    expect((await cli(["stub", "--root", dir], run, { DISPATCH_DEBUG: "1" })).err).toContain(
      "debug: details",
    );
  });
});

describe("runCli: the real registry", () => {
  it("loads every command module", { timeout: 120_000 }, async () => {
    for (const spec of COMMANDS) {
      expect(typeof (await spec.load())).toBe("function");
    }
  });

  it("runs status through the CLI on a bare folder and prints one JSON document", async () => {
    const out = await captureStdout(() =>
      runCli(["status", "--json", "--root", dir], {
        env: {},
        now: () => NOW,
        stderr: () => {},
      }),
    );
    expect(out.result).toBe(0);
    const report = JSON.parse(out.stdout);
    expect(report).toMatchObject({ version: 1, today: "2026-10-07", due_now: true });
  });
});

describe("the owner's config is not in git (D296)", () => {
  const STORE_ENV = { DATABASE_URL: "postgres://fake", SINGULARITY_CONFIG_STORE: "postgres" };
  const down = async (): Promise<never> => {
    throw new Error("connect ECONNREFUSED");
  };
  beforeEach(() => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
  });
  const downIo = (code: { value: number }, err: string[], ran: string[]) => ({
    cwd: dir,
    env: STORE_ENV,
    now: () => NOW,
    stdout: () => {},
    stderr: (text: string) => err.push(text),
    connectConfigStore: down,
    commands: [
      stub(async () => {
        ran.push("ran");
        return 0;
      }, "run"),
    ],
  });

  // The bug it prevents: with the files out of git a checkout has none, and the old fallback ("use
  // the files") would have built a briefing from the defaults, with no sources, and published it.
  it("stops a run when the store is down and the checkout holds no config", async () => {
    const err: string[] = [];
    const ran: string[] = [];
    const code = await runCli(["run", "--stage", "gate"], downIo({ value: 0 }, err, ran));
    expect(code).toBe(1);
    expect(ran).toEqual([]);
    expect(err.join("")).toContain("config/preferences.json");
  });

  // The bug it prevents: a store that answers but holds no schedule row (wiped, or never seeded)
  // would leave the loaders on DEFAULT_SCHEDULE, and the gate would start work at its hour and cadence.
  it("stops a run when the store answers but lacks a required document", async () => {
    const err: string[] = [];
    const ran: string[] = [];
    const io = {
      ...downIo({ value: 0 }, err, ran),
      connectConfigStore: async () => ({ query: async () => [] }),
    };
    expect(await runCli(["run", "--stage", "gate"], io)).toBe(1);
    expect(ran).toEqual([]);
    expect(err.join("")).toContain("config/schedule.json");
  });

  // The bug it prevents: hydration keeps a file the store has no row for, so a stale schedule left
  // on a machine would pass a file-exists check while the store holds nothing for it.
  it("stops a run on a stale file when the store has no row for it", async () => {
    for (const path of CONFIG_DOCUMENT_PATHS) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), "{}\n");
    }
    const err: string[] = [];
    const ran: string[] = [];
    const io = {
      ...downIo({ value: 0 }, err, ran),
      connectConfigStore: async () => ({ query: async () => [] }),
    };
    expect(await runCli(["run", "--stage", "gate"], io)).toBe(1);
    expect(ran).toEqual([]);
  });

  // The bug it prevents: a production run whose store switch went missing would read no config and
  // build the briefing from the loaders' defaults.
  it("stops a run with the store off when the checkout holds no config", async () => {
    const err: string[] = [];
    const ran: string[] = [];
    const io = { ...downIo({ value: 0 }, err, ran), env: {} };
    expect(await runCli(["run", "--stage", "gate"], io)).toBe(1);
    expect(ran).toEqual([]);
    expect(err.join("")).toContain("config pull");
  });

  it("lets a machine that holds its own config files go on when the store is down", async () => {
    for (const path of CONFIG_DOCUMENT_PATHS) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), "{}\n");
    }
    const ran: string[] = [];
    const code = await runCli(["run", "--stage", "gate"], downIo({ value: 0 }, [], ran));
    expect(code).toBe(0);
    expect(ran).toEqual(["ran"]);
  });
});
