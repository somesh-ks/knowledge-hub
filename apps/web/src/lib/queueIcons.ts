/**
 * The queue's glyphs, in one place, so one rule can hold them: a glyph names one meaning on a surface.
 * A status (how a run ended) sits in a row's leading slot and the folded head; an action (cancel, remove,
 * play) sits in the trailing slot or is the lead itself. A status never wears an action's glyph, or the
 * row shows an X at its start and another at its end (owner, 2026-11-05: a cancelled run did exactly
 * that, since Cancelled had been drawn with Close). queueIcons.test.ts holds the two lists apart and
 * e2e/queue.spec.ts checks the rendered rows.
 */
import type { IconName } from "./icons";

/** How a run ended, as the head and a row's lead show it. */
export const QUEUE_STATUS_ICONS = {
  done: "checkCircle",
  failed: "alert",
  started: "info",
  cancelled: "blocked",
} as const satisfies Record<string, IconName>;

/** What a row can be pressed for. Cancel and Remove are the one X at the row's end, one at a time. */
export const QUEUE_ACTION_ICONS = {
  cancel: "close",
  remove: "close",
  play: "play",
} as const satisfies Record<string, IconName>;
