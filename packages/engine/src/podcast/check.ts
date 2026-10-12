import type { PodcastRequest } from "@dispatch/core";
import type { Logger } from "../context.js";
import { mapConcurrent } from "../llm/concurrency.js";
import type { PodcastStory, ScriptTurn, ScriptWriter } from "./types.js";

/** Turn rewrites in flight at once: a script rarely needs more, and this keeps a burst polite. */
const REWRITE_CONCURRENCY = 4;

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** Every number in a text, without thousands separators, so "2,000" and "2000" are the same. */
export function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((raw) => raw.replace(/,/g, ""));
}

export interface CheckResult {
  turns: ScriptTurn[];
  rewritten: number;
  dropped: number;
}

export interface CheckInput {
  request: PodcastRequest;
  turns: readonly ScriptTurn[];
  stories: readonly PodcastStory[];
  writer: ScriptWriter;
  log?: Logger;
}

/**
 * Hold the script to the stories it was given. A turn that names a story we did not select is
 * dropped. A turn with a number its story does not state is rewritten once, then dropped if the
 * rewrite still invents one. Opening and sign-off turns may use any number found in a selected
 * story, plus the story count.
 */
export async function checkTurns(input: CheckInput): Promise<CheckResult> {
  const byId = new Map(input.stories.map((story) => [story.item_id, story]));
  const everywhere = new Set<string>([String(input.stories.length)]);
  const perStory = new Map<string, Set<string>>();
  for (const story of input.stories) {
    const own = new Set(numbersIn(`${story.headline} ${story.summary}`));
    perStory.set(story.item_id, own);
    for (const n of own) everywhere.add(n);
  }

  // Each turn is judged on its own, so the rewrites run side by side instead of one after another;
  // the outcomes are then applied in script order.
  const outcomes = await mapConcurrent(input.turns, REWRITE_CONCURRENCY, async (turn) => {
    const story = turn.item_id === undefined ? null : (byId.get(turn.item_id) ?? undefined);
    if (story === undefined) return { kind: "unselected" } as const;
    const allowed = story === null ? everywhere : (perStory.get(story.item_id) ?? new Set());
    const invented = (text: string): string[] => numbersIn(text).filter((n) => !allowed.has(n));

    const bad = invented(turn.text);
    if (bad.length === 0) return { kind: "kept", turn } as const;
    const problem = `It says ${[...new Set(bad)].join(", ")}, which ${story === null ? "no selected story" : "its story"} does not state. Remove the number or use only what the story states.`;
    const replacement = await input.writer.rewriteTurn({
      request: input.request,
      story,
      stories: input.stories,
      text: turn.text,
      problem,
    });
    if (replacement !== null && invented(replacement).length === 0) {
      return { kind: "rewritten", turn: { ...turn, text: replacement } } as const;
    }
    return { kind: "invented", numbers: bad } as const;
  });

  const kept: ScriptTurn[] = [];
  let rewritten = 0;
  let dropped = 0;
  for (const outcome of outcomes) {
    switch (outcome.kind) {
      case "kept":
        kept.push(outcome.turn);
        break;
      case "rewritten":
        kept.push(outcome.turn);
        rewritten += 1;
        break;
      case "unselected":
        dropped += 1;
        input.log?.warn("Dropped a turn that names a story that was not selected");
        break;
      case "invented":
        dropped += 1;
        input.log?.warn("Dropped a turn that states a number its story does not", {
          numbers: outcome.numbers,
        });
        break;
    }
  }
  return { turns: kept, rewritten, dropped };
}
