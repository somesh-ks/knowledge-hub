/**
 * The story controls' first-load part (components/StoryControls.astro): it shows each story's stored
 * mark as the page loads, so a reload never flashes the controls unpressed, and loads the sending
 * code (scripts/storyVotes.ts) on the first press, or at idle when votes are waiting to go. A
 * bundled module runs once per session, so the marks are applied on astro:page-load.
 */
import { hasUnsent, parseVotes, pressedOf, VOTES_KEY } from "../lib/storyVotes";

let loading: Promise<typeof import("./storyVotes")> | null = null;
const sender = (): Promise<typeof import("./storyVotes")> => {
  loading ??= import("./storyVotes");
  return loading;
};

function applyMarks(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(VOTES_KEY);
  } catch {
    // Storage is blocked: nothing is remembered.
  }
  if (!raw) return;
  const state = parseVotes(raw);
  for (const controls of document.querySelectorAll<HTMLElement>("[data-story-controls]")) {
    const pressed = pressedOf(state, controls.dataset.storyId ?? "");
    if (!pressed) continue;
    for (const button of controls.querySelectorAll<HTMLElement>("[data-vote]"))
      button.setAttribute("aria-pressed", String(button.dataset.vote === pressed));
  }
  if (hasUnsent(state)) {
    // Votes from an earlier visit are due ten minutes after the first: the sender keeps that clock.
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => void sender());
    else setTimeout(() => void sender(), 1500);
  }
}

document.addEventListener("astro:page-load", applyMarks);
document.addEventListener("click", (event) => {
  const button = (event.target as Element).closest?.("[data-vote], [data-block]");
  if (button) void sender().then((module) => module.handle(button));
});
