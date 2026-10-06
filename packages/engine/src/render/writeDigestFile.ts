import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Digest, digestRelPath, serializeDigestFile } from "@dispatch/core";

export interface WrittenDigestFile {
  path: string;
  relPath: string;
}

/**
 * Write `Digests/YYYY/MM/<id>.md`, creating directories. The flag `wx` makes the OS refuse an
 * existing file, so a digest is never overwritten, even by a race between two writers.
 */
export async function writeDigestFile(root: string, digest: Digest): Promise<WrittenDigestFile> {
  const relPath = digestRelPath(digest.id);
  const path = join(root, relPath);
  const text = serializeDigestFile(digest);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, text, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Digest file already exists: ${relPath}. Digests are never overwritten.`);
    }
    throw error;
  }
  return { path, relPath };
}
