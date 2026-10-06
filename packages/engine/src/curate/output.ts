import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CommandContext } from "../context.js";

/**
 * Print a command result. Machine mode writes one JSON line to stdout; otherwise the human
 * lines go to stdout. Logs always go to stderr through ctx.log.
 */
export function emit(
  ctx: CommandContext,
  human: readonly string[],
  data: Record<string, unknown>,
): void {
  if (ctx.json) process.stdout.write(`${JSON.stringify(data)}\n`);
  else process.stdout.write(`${human.join("\n")}\n`);
}

/** Write JSON with the repository's conventions: 2-space indent, no BOM, trailing newline. */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
