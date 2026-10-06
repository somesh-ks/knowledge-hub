import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Write UTF-8 text through a temporary file and a rename, so a crash never leaves a half-written
 * digest or state file for the bot to commit.
 */
export async function writeTextAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, text, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** JSON as the repo stores it: two-space indent, no BOM, trailing newline. */
export function formatJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await writeTextAtomic(path, formatJson(data));
}
