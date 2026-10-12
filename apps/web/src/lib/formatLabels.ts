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

export type EpisodeFormat = keyof typeof FORMAT_LABELS;
