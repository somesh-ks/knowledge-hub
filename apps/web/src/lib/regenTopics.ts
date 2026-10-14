/** Client-safe: the sheet imports this, so it must pull in no schema library. */
/** One topic chip in a Regenerate dialog: the ids it stands for, ticked together. */
export interface RegenChip {
  value: string;
  label: string;
  ids: readonly string[];
  /** The sections the topics publish to, which a briefing's items name; absent when ids are sections. */
  sections?: readonly string[];
}

/** A chip is ticked when the original covers any topic or section it stands for. */
export function isChipOn(
  chip: Pick<RegenChip, "ids" | "sections">,
  original: readonly string[],
): boolean {
  return [...chip.ids, ...(chip.sections ?? [])].some((id) => original.includes(id));
}

/** Every id the ticked chips stand for, once each: what a regeneration sends. */
export function idsOfChips(chips: readonly Pick<RegenChip, "ids">[]): string[] {
  return [...new Set(chips.flatMap((chip) => chip.ids))];
}
