import { PODCAST_CHARS_PER_MINUTE } from "@singularity/core";
import { PodcastError, type ScriptTurn } from "./types.js";

export function charCount(turns: readonly ScriptTurn[]): number {
  return turns.reduce((sum, turn) => sum + turn.text.length, 0);
}

/** How long the turns take to say at the planned pace, in milliseconds. */
export function spokenMs(turns: readonly ScriptTurn[]): number {
  return Math.round((charCount(turns) * 60_000) / PODCAST_CHARS_PER_MINUTE);
}

/** Join neighbours that share a speaker and a story, so a dropped turn cannot leave a double. */
export function mergeNeighbours(turns: readonly ScriptTurn[]): ScriptTurn[] {
  const out: ScriptTurn[] = [];
  for (const turn of turns) {
    const last = out[out.length - 1];
    if (last && last.speaker === turn.speaker && last.item_id === turn.item_id) {
      out[out.length - 1] = { ...last, text: `${last.text} ${turn.text}` };
    } else {
      out.push({ ...turn });
    }
  }
  return out;
}

/**
 * Keep the script inside the character budget by dropping story blocks from the end, never by
 * cutting inside a turn. The opening is the turns before the first story turn and the sign-off is
 * the run of story-less turns at the end; a block is one story's turns, plus story-less turns
 * between two stories. The sign-off goes only when the first story alone still does not fit.
 * The first `keep` turns are out already and are never dropped: a script that cannot fit without
 * them runs over instead of failing.
 */
export function fitToBudget(
  turns: readonly ScriptTurn[],
  budget: number,
  options: {
    /** Drop the close (the sign-off's story-less turns before it) before any story block. */
    closeFirst?: boolean;
    keep?: number;
  } = {},
): { turns: ScriptTurn[]; dropped_stories: number } {
  const keep = options.keep ?? 0;
  const first = turns.findIndex((turn) => turn.item_id !== undefined);
  const last = turns.findLastIndex((turn) => turn.item_id !== undefined);
  if (first < 0) throw new PodcastError("The script has no story in it.");

  const intro = turns.slice(0, first);
  let outro = turns.slice(last + 1);
  const outroFree = last + 1 >= keep;
  const blocks: ScriptTurn[][] = [];
  const starts: number[] = [];
  for (const [offset, turn] of turns.slice(first, last + 1).entries()) {
    const current = blocks[blocks.length - 1];
    const startsNew =
      turn.item_id !== undefined && current !== undefined && current[0]?.item_id !== turn.item_id;
    if (current === undefined || startsNew) {
      blocks.push([turn]);
      starts.push(first + offset);
    } else current.push(turn);
  }

  const total = (): number =>
    charCount(intro) + blocks.reduce((sum, block) => sum + charCount(block), 0) + charCount(outro);
  let dropped = 0;
  if (options.closeFirst && total() > budget && outro.length > 1 && outroFree) {
    outro = outro.slice(-1);
  }
  while (total() > budget && blocks.length > 1 && (starts[blocks.length - 1] ?? 0) >= keep) {
    blocks.pop();
    dropped += 1;
  }
  if (total() > budget && outro.length > 0 && outroFree) outro = [];
  if (total() > budget && keep === 0) {
    throw new PodcastError(
      "The script does not fit the length even with one story. Try a longer episode or the headlines format.",
    );
  }
  return { turns: [...intro, ...blocks.flat(), ...outro], dropped_stories: dropped };
}
