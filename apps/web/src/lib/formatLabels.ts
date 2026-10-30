/**
 * The word for an episode's format, as the Library, the episode page and the player all say it.
 * Free of imports, so the player can read it in the browser without the build's file reading.
 */
export const FORMAT_LABELS = {
  readout: "Readout",
  discussion: "Discussion",
  // Create no longer offers headlines; a stored one reads as what it is, a readout.
  headlines: "Readout",
} as const;

/**
 * The kind of everything made on request, as the Library's filter names it. A card, the player's
 * caption and the page's facts line lead with the kind (Daily, Weekly, Catch up), never with an
 * episode's format (Readout, Discussion): that is a choice inside the Catch up, and it stays
 * searchable.
 */
export const CATCH_UP_LABEL = "Catch up";

export type EpisodeFormat = keyof typeof FORMAT_LABELS;
