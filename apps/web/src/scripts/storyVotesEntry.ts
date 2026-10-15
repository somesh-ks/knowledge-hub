/**
 * The story controls' first-load part (components/StoryControls.astro): it shows each story's stored
 * mark as the page loads, so a reload never flashes the controls unpressed, and loads the sending
 * code (scripts/storyVotes.ts) at idle, so the first press does not wait for it; votes waiting from
 * an earlier visit then go on the sender's clock. A story's link followed is recorded as an open.
 * A bundled module runs once per session, so the marks are applied on astro:page-load.
 */
import { parseVotes, pressedOf, VOTES_KEY } from "../lib/storyVotes";
import { warmWhenIdle } from "./idle";

let loading: Promise<typeof import("./storyVotes")> | null = null;
const sender = (): Promise<typeof import("./storyVotes")> => {
  // A failed fetch is forgotten, so the next press asks again.
  loading ??= import("./storyVotes").catch((error: unknown) => {
    loading = null;
    throw error;
  });
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
}

document.addEventListener("astro:page-load", applyMarks);
warmWhenIdle(sender);
document.addEventListener("click", (event) => {
  const button = (event.target as Element).closest?.("[data-vote], [data-block]");
  if (button) void sender().then((module) => module.handle(button));
});

/** Following a story's link to its source, with any button, is an open: a weak like. */
function onLink(event: MouseEvent): void {
  if (event.type === "auxclick" && event.button !== 1) return;
  const link = (event.target as Element).closest?.("a[href]");
  const controls = link
    ?.closest("article, li")
    ?.querySelector<HTMLElement>("[data-story-controls]");
  if (controls) void sender().then((module) => module.opened(controls));
}
document.addEventListener("click", onLink);
document.addEventListener("auxclick", onLink);
