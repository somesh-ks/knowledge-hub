import { audioTimelineRelPath, digestRelPath } from "@singularity/core";
import type { DigestSource } from "./narrate";

/**
 * The digests as the narrate function sees them: bundled, not read from disk.
 *
 * A deployed function has no repository next to it, and a path into Digests/ would have to survive
 * the adapter's packaging. Instead Vite compiles every file under Digests/ into the server build,
 * one small chunk per file that is loaded only when a request asks for that digest. The function and
 * the pages therefore always hold the same digests, because one build made both, and there is no
 * file system to get wrong at run time.
 *
 * The patterns have to be literals, and the keys Vite builds are these same paths, relative to this
 * file.
 */
const REPO_ROOT = "../../../../";

const digestFiles = import.meta.glob<string>("../../../../Digests/**/*.md", {
  query: "?raw",
  import: "default",
});

/** Timelines committed by the audio workflow, for digests it narrated before narrate on Play. */
const timelineFiles = import.meta.glob<unknown>("../../../../Digests/**/*.audio.json", {
  import: "default",
});

/** The schedule, for the voices of the Daily and Weekly briefings. Absent until it is first saved. */
const scheduleFile = import.meta.glob<unknown>("../../../../config/schedule.json", {
  import: "default",
});

export const bundledDigests: DigestSource = {
  async readSchedule() {
    const load = scheduleFile[`${REPO_ROOT}config/schedule.json`];
    return load ? await load() : null;
  },
  async readDigest(id) {
    const load = digestFiles[`${REPO_ROOT}${digestRelPath(id)}`];
    return load ? await load() : null;
  },
  async readTimeline(id) {
    const load = timelineFiles[`${REPO_ROOT}${audioTimelineRelPath(id)}`];
    return load ? await load() : null;
  },
};

/** The id of every digest in this build, newest first. */
export function bundledDigestIds(): string[] {
  return Object.keys(digestFiles)
    .map((path) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""))
    .sort()
    .reverse();
}
