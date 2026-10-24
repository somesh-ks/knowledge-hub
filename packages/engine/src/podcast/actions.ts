import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Episode, episodeRelPath, PodcastCommand, parseEpisodeFile } from "@singularity/core";
import { InvalidRequestError, PodcastError } from "./types.js";

/** Parse the `--request` JSON: a new episode, a deletion or a regeneration. */
export function parseCommand(raw: string): PodcastCommand {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new InvalidRequestError("The request is not valid JSON.");
  }
  const parsed = PodcastCommand.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join(".") || "(request)"}: ${issue.message}`);
    throw new InvalidRequestError(`The request is invalid. ${problems.join("; ")}`);
  }
  return parsed.data;
}

/** The stored episode with this id, or a plain failure when there is none or it cannot be read. */
export async function readEpisode(
  root: string,
  id: string,
): Promise<{ episode: Episode; relPath: string }> {
  const relPath = episodeRelPath(id);
  let text: string;
  try {
    text = await readFile(join(root, relPath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PodcastError(`There is no episode ${id}.`);
    }
    throw error;
  }
  try {
    return { episode: parseEpisodeFile(text), relPath };
  } catch {
    throw new PodcastError(`Episode ${id} could not be read, so it cannot be replaced.`);
  }
}

/** Whether the episode file exists, without parsing it: a delete must work on a damaged file too. */
export async function episodeExists(root: string, id: string): Promise<string> {
  const relPath = episodeRelPath(id);
  try {
    await readFile(join(root, relPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PodcastError(`There is no episode ${id}.`);
    }
    throw error;
  }
  return relPath;
}
