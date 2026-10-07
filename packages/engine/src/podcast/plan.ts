import {
  PODCAST_CHARS_PER_MINUTE,
  PODCAST_MAX_CHARS,
  type PodcastFormat,
  PodcastRequest,
} from "@dispatch/core";
import { InvalidRequestError } from "./types.js";

/** Characters one story takes in each format, including the host's bridge into the next one. */
export const STORY_CHARS: Record<PodcastFormat, number> = {
  readout: 450,
  discussion: 700,
  headlines: 160,
};

/** Room for the opening and the sign-off. */
export const FRAME_CHARS = 300;

export interface PodcastPlan {
  request: PodcastRequest;
  /** Total characters of speech: minutes x 968, never above the hard cap. */
  budget_chars: number;
  /** Most stories the budget can carry in this format. */
  max_stories: number;
}

/** Parse the request JSON from the command line. The message names every field that is wrong. */
export function parseRequest(raw: string): PodcastRequest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new InvalidRequestError("The request is not valid JSON.");
  }
  const parsed = PodcastRequest.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join(".") || "(request)"}: ${issue.message}`);
    throw new InvalidRequestError(`The request is invalid. ${problems.join("; ")}`);
  }
  return parsed.data;
}

export function planPodcast(request: PodcastRequest): PodcastPlan {
  const budget = Math.min(request.length_minutes * PODCAST_CHARS_PER_MINUTE, PODCAST_MAX_CHARS);
  const maxStories = Math.max(0, Math.floor((budget - FRAME_CHARS) / STORY_CHARS[request.format]));
  return { request, budget_chars: budget, max_stories: maxStories };
}
