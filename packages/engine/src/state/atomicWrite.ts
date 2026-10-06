import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Write a file so readers see either the old content or the new, never a partial file: write a
 * temp file beside it, then rename over the target. Creates missing directories.
 */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(temp, text, "utf8");
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
