import type { PodcastRequest } from "@singularity/core";
import type { Taste } from "../profile/tasteNote.js";
import type { ScriptShape } from "./structure.js";

/** Raised for a problem the listener can act on: a bad request, too few stories, an unusable script. */
export class PodcastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PodcastError";
  }
}

/** The request itself is wrong, so the caller should fix it rather than retry. */
export class InvalidRequestError extends PodcastError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

/** One published story the episode may talk about. All text is copied from a digest. */
export interface PodcastStory {
  item_id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  /** Ids, not the built-in enums: a briefing can carry sections and topics the owner added. */
  section: string;
  category: string;
}

export interface ScriptTurn {
  speaker: "a" | "b";
  text: string;
  item_id?: string | undefined;
}

export interface ScriptInput {
  request: PodcastRequest;
  stories: readonly PodcastStory[];
  /** Total characters the whole script may use. */
  budget_chars: number;
  /** What the listener asked to change in the previous version; typed by the owner, so untrusted. */
  feedback?: string | undefined;
  /** Headlines the listener liked and disliked; data for the writer, never instructions. */
  taste?: Taste | undefined;
  /** Epoch milliseconds by which the call, retries included, must end. */
  deadline_at?: number | undefined;
  /** Turns already written and shown to the listener; the script continues right after them. */
  opening?: readonly ScriptTurn[] | undefined;
  /** The Catch up structure's asks (D170); absent is the shape every episode had before it. */
  shape?: ScriptShape | undefined;
}

export interface TurnRewrite {
  request: PodcastRequest;
  /** The story the turn is about; null for an opening or sign-off turn. */
  story: PodcastStory | null;
  stories: readonly PodcastStory[];
  text: string;
  /** Why the turn failed, in plain language. Written by our code, so it is trusted. */
  problem: string;
}

/**
 * Writes the spoken script. The model has no tools and sees stories as delimited data. Spend-guard
 * errors always propagate; any other failure is thrown and handled by the retry in script.ts.
 */
export interface ScriptWriter {
  /** One call that returns the whole script as `{ turns }`. `problems` lists what a previous reply got wrong. */
  writeScript(input: ScriptInput, problems: readonly string[]): Promise<unknown>;
  /**
   * One short call for the first turns only (the hello, the rundown, the lead story), so the
   * listener can start while the rest is written. Optional; a writer without it has no opening.
   */
  writeOpening?(input: ScriptInput): Promise<unknown>;
  /**
   * One call that returns the whole script again, with the thinnest segments deepened from the
   * material already in the story blocks. Optional; a writer without it is not asked to extend.
   */
  extendScript?(
    input: ScriptInput,
    turns: readonly ScriptTurn[],
    problem: string,
  ): Promise<unknown>;
  /** Rewrite one turn so it keeps to the facts. Null when the model could not. */
  rewriteTurn(input: TurnRewrite): Promise<string | null>;
}
