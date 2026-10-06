import { parseArgs } from "node:util";
import type { CommandRun } from "../context.js";
import { secretsFromEnv } from "../context.js";
import { createGitRunner } from "../git/runGit.js";
import { createJevClient } from "../judge/jevClient.js";
import { type DoctorDeps, formatDoctor, runDoctor } from "../ops/doctor.js";
import { createVercelBlobClient } from "../publish/blob.js";

const USAGE = "Usage: dispatch doctor [--online] [--json]";

const ONLINE_TIMEOUT_MS = 12_000;

/** `dispatch doctor`: exit 1 when any check fails, 0 otherwise (warnings do not fail it). */
export function makeDoctorCommand(overrides: Partial<DoctorDeps> = {}): CommandRun {
  return async (argv, ctx) => {
    let online: boolean;
    try {
      const { values } = parseArgs({
        args: argv,
        allowPositionals: false,
        strict: true,
        options: { online: { type: "boolean" } },
      });
      online = values.online === true;
    } catch (error) {
      ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
      return 2;
    }

    const deps: DoctorDeps = {
      fetchImpl: (input, init) => fetch(input, init),
      nodeVersion: process.versions.node,
      git: createGitRunner(ctx.root),
      createJev: createJevClient,
      createBlob: createVercelBlobClient,
      timeoutMs: ONLINE_TIMEOUT_MS,
      ...overrides,
    };
    const report = await runDoctor(ctx, deps, online, secretsFromEnv(ctx.env));
    process.stdout.write(`${ctx.json ? JSON.stringify(report) : formatDoctor(report)}\n`);
    return report.ok ? 0 : 1;
  };
}

export const run: CommandRun = makeDoctorCommand();
