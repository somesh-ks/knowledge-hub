import { defineSpec, esc, on, str } from "../lib/designSpec";

/** The crop of each scene, as EmptyArt.astro sets it: one scale (240 units across), each box cut to its drawing. */
const VIEW: Record<string, string> = {
  today: "0 26 240 128",
  library: "0 28 240 124",
  results: "0 22 240 146",
  offline: "0 20 240 143",
  online: "0 20 240 143",
  notfound: "0 20 240 142",
};

/** The shapes of each scene, copied from EmptyArt.astro. */
const SHAPES: Record<string, string> = {
  today: `<rect class="art-hero" x="60" y="30" width="120" height="120" rx="24"></rect><path class="art-ink-fill" d="M106 66l36 24-36 24z"></path>`,
  library: `<rect class="art-slot" x="62" y="32" width="116" height="116" rx="24"></rect><path class="art-ink-line" d="M120 72v36M102 90h36"></path>`,
  results: `<rect class="art-hero" x="52" y="26" width="108" height="108" rx="24"></rect><path class="art-handle" d="M178 136l20 20"></path><circle class="art-pop" cx="156" cy="114" r="34"></circle><circle class="art-lens" cx="156" cy="114" r="23"></circle>`,
  offline: `<circle class="art-hero" cx="120" cy="90" r="66"></circle><path class="art-glyph-off" d="M98 102a31 31 0 0 1 44 0M76 80a62 62 0 0 1 88 0M120 124h0"></path><path class="art-slash-knock" d="M88 52l64 64"></path><path class="art-slash" d="M88 52l64 64"></path>`,
  online: `<circle class="art-hero" cx="120" cy="90" r="66"></circle><path class="art-glyph" d="M98 102a31 31 0 0 1 44 0M76 80a62 62 0 0 1 88 0M120 124h0"></path><circle class="art-knock" cx="168" cy="134" r="25"></circle><circle class="art-pop" cx="168" cy="134" r="20"></circle><path class="art-on-pop-line" d="M159 134l6 6 12-12"></path>`,
  notfound: `<path class="art-hero" d="M88 24h44l32 32v86a16 16 0 0 1-16 16H88a16 16 0 0 1-16-16V40a16 16 0 0 1 16-16z"></path><path class="art-hero-ink" d="M132 24v20a12 12 0 0 0 12 12h20z"></path><path class="art-pop" d="M120 128c-14-16-20-26-20-36a20 20 0 0 1 40 0c0 10-6 20-20 36z"></path><circle class="art-hero" cx="120" cy="92" r="7"></circle>`,
};

/** What each scene says on its page, from the pages that draw it. */
const COPY: Record<string, { title: string; body: string; action: string }> = {
  today: {
    title: "No podcasts yet",
    body: "The first one arrives with your next scheduled podcast.",
    action: "Check again",
  },
  library: {
    title: "Nothing saved yet",
    body: "Podcasts you download appear here.",
    action: "Go to Latest",
  },
  results: {
    title: "No results",
    body: "Try another word, or clear the filters.",
    action: "Clear search",
  },
  offline: {
    title: "You are offline",
    body: "This page needs a connection. Podcasts you have opened can still be read.",
    action: "Try again",
  },
  online: {
    title: "Back online",
    body: "Everything is up to date.",
    action: "Continue",
  },
  notfound: {
    title: "Page not found",
    body: "Check the address, or start again from Latest.",
    action: "Go to Latest",
  },
};

/** The empty state: a spot illustration, a title, one line on what happens next and one way on. */
export default defineSpec({
  id: "empty-state",
  title: "Empty state",
  level: "organism",
  category: "Feedback",
  summary:
    "What a screen shows when it has nothing to list: one flat scene, a title, one line and one action.",
  frame: "stack",
  usage: { sheet: "empty.css", selector: ".empty" },
  classes: [
    "empty",
    "empty-art",
    "empty-title",
    "empty-body",
    "empty-actions",
    "art-hero",
    "art-hero-ink",
    "art-pop",
    "art-knock",
    "art-lens",
    "art-slot",
    "art-ink-fill",
    "art-ink-line",
    "art-on-pop-line",
    "art-handle",
    "art-glyph",
    "art-glyph-off",
    "art-slash-knock",
    "art-slash",
  ],
  decisions: ["D96", "D98"],
  guidance: [
    "One flat scene of two to four shapes, drawn in the theme's own accent roles, so both themes follow without a second set of colours.",
    "The scene draws an object, not a control. The title and the button carry the meaning; the scene is decorative.",
    "One filled button that fits its words, and at most one text button beside it.",
  ],
  controls: [
    {
      kind: "choice",
      id: "art",
      label: "Scene",
      group: "Variant",
      value: "today",
      options: [
        { value: "today", label: "Today" },
        { value: "library", label: "Library" },
        { value: "results", label: "Results" },
        { value: "offline", label: "Offline" },
        { value: "online", label: "Online" },
        { value: "notfound", label: "Not found" },
      ],
    },
    { kind: "toggle", id: "compact", label: "Compact", group: "State", value: false },
    { kind: "toggle", id: "secondary", label: "Second action", group: "Content", value: true },
  ],
  render: (state) => {
    const art = str(state.art, "today");
    const compact = on(state.compact);
    const copy = COPY[art] ?? COPY.today;
    const svg = `<svg class="empty-art" data-art="${art}" data-size="${compact ? "compact" : "regular"}" viewBox="${VIEW[art]}" aria-hidden="true" focusable="false">${SHAPES[art]}</svg>`;
    const secondary = on(state.secondary) ? `<a class="btn" href="#">Settings</a>` : "";
    return `<section class="empty" aria-labelledby="empty-title"${compact ? " data-compact" : ""}>${svg}<h2 class="empty-title" id="empty-title">${esc(copy?.title ?? "")}</h2><p class="empty-body">${esc(copy?.body ?? "")}</p><div class="empty-actions"><a class="btn-primary" href="#">${esc(copy?.action ?? "")}</a>${secondary}</div></section>`;
  },
});
