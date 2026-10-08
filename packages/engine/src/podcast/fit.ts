import { PodcastError, type ScriptTurn } from "./types.js";

export function charCount(turns: readonly ScriptTurn[]): number {
  return turns.reduce((sum, turn) => sum + turn.text.length, 0);
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
 */
export function fitToBudget(
  turns: readonly ScriptTurn[],
  budget: number,
): { turns: ScriptTurn[]; dropped_stories: number } {
  const first = turns.findIndex((turn) => turn.item_id !== undefined);
  let last = -1;
  turns.forEach((turn, index) => {
    if (turn.item_id !== undefined) last = index;
  });
  if (first < 0) throw new PodcastError("The script has no story in it.");

  const intro = turns.slice(0, first);
  let outro = turns.slice(last + 1);
  const blocks: ScriptTurn[][] = [];
  for (const turn of turns.slice(first, last + 1)) {
    const current = blocks[blocks.length - 1];
    const startsNew =
      turn.item_id !== undefined && current !== undefined && current[0]?.item_id !== turn.item_id;
    if (current === undefined || startsNew) blocks.push([turn]);
    else current.push(turn);
  }

  const total = (): number =>
    charCount(intro) + blocks.reduce((sum, block) => sum + charCount(block), 0) + charCount(outro);
  let dropped = 0;
  while (total() > budget && blocks.length > 1) {
    blocks.pop();
    dropped += 1;
  }
  if (total() > budget && outro.length > 0) outro = [];
  if (total() > budget) {
    throw new PodcastError(
      "The script does not fit the length even with one story. Try a longer episode or the headlines format.",
    );
  }
  return { turns: [...intro, ...blocks.flat(), ...outro], dropped_stories: dropped };
}
