/**
 * The Add source panel: a native modal dialog cloned from the page's template on the first press of
 * Add source. Paste an address, and after a pause the site is looked up (GET /api/source-preview) and
 * shown as a card: icon, name, feed, latest post and a score. Add source is enabled once a card has
 * loaded. A modal dialog gives the scrim, the focus trap and Escape; Back closes it the way it closes
 * the Create panel. Loaded the first time it is opened.
 */
import { element, iconNode, type SourcePreview, scoreNode } from "./topicsView";

export const PREVIEW_DELAY_MS = 400;

/** A web address from what a person types: "example.com" is "https://example.com/". */
export function webAddress(text: string): string | null {
  const typed = text.trim();
  try {
    const url = new URL(typed.includes("://") ? typed : `https://${typed}`);
    return /^https?:$/.test(url.protocol) && url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

/** One sentence that says what to do about a refused preview. */
export function problemText(status: number): string {
  if (status === 400) return "That address cannot be used. Check it and try again.";
  if (status === 422) return "The address could not be read. Try the site's home page instead.";
  if (status === 429) return "That was a lot of lookups. Wait a minute, then try again.";
  if (status === 504) return "The site took too long to answer. Try again in a moment.";
  return "The lookup could not be reached. Check your connection and try again.";
}

type Outcome = { preview: SourcePreview } | { status: number };

/** One lookup per distinct address; only a failure worth repeating (busy, slow, offline) is forgotten. */
const lookups = new Map<string, Promise<Outcome>>();

function look(url: string): Promise<Outcome> {
  const known = lookups.get(url);
  if (known) return known;
  const run = fetch(`/api/source-preview?url=${encodeURIComponent(url)}`)
    .then(async (response): Promise<Outcome> => {
      if (!response.ok) return { status: response.status };
      return { preview: (await response.json()) as SourcePreview };
    })
    .catch((): Outcome => ({ status: 0 }));
  lookups.set(url, run);
  void run.then((outcome) => {
    if ("status" in outcome && (outcome.status === 0 || outcome.status >= 429)) {
      lookups.delete(url);
    }
  });
  return run;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function when(iso: string | null): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? DATE.format(date) : "Not known";
}

function fact(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.append(element("dt", "", label), element("dd", "", value));
  return row;
}

function card(preview: SourcePreview): HTMLElement {
  const shell = element("div", "source-card");
  const head = element("div", "source-card-head");
  const title = element("div", "source-card-title");
  title.append(
    element("span", "source-card-name", preview.name),
    element("span", "source-host", preview.host),
  );
  head.append(iconNode(preview.thumbnail_url ?? preview.favicon_url), title);

  const score = element("div", "source-card-score");
  score.append(
    scoreNode(preview.score, preview.score_label),
    element("p", "source-card-reason", preview.reason),
  );

  const facts = element("dl", "source-facts");
  facts.append(
    fact("Feed", preview.feed_url ?? "No feed found: the page will be read as a web page"),
    fact("Latest post", when(preview.latest_at)),
    fact(
      "Last 30 days",
      preview.items_30d === null
        ? "Not known"
        : `${preview.items_30d} ${preview.items_30d === 1 ? "post" : "posts"}`,
    ),
  );
  shell.append(head, score, facts);
  return shell;
}

function skeleton(): HTMLElement {
  const shell = element("div", "source-card");
  shell.setAttribute("aria-hidden", "true");
  const head = element("div", "source-card-head");
  const lines = element("div", "source-card-title");
  const wide = element("span", "skeleton-bar");
  wide.dataset.wide = "";
  lines.append(wide, element("span", "skeleton-bar"));
  head.append(element("span", "skeleton-circle"), lines);
  const score = element("div", "source-card-score");
  score.append(element("span", "skeleton-bar"));
  const facts = element("div", "source-facts");
  facts.append(element("span", "skeleton-bar"), element("span", "skeleton-bar"));
  shell.append(head, score, facts);
  return shell;
}

function problem(status: number): HTMLElement {
  const shell = element("div", "source-card");
  shell.dataset.kind = "error";
  const note = element("p", "manage-error", problemText(status));
  note.setAttribute("role", "alert");
  shell.append(note);
  return shell;
}

export interface Chosen {
  /** The address as typed, made a web address. */
  url: string;
  /** The chosen topic's id; empty for Other. */
  topic_id: string;
  preview: SourcePreview;
}

/** Opens the panel. `onAdd` runs when Add source is pressed; the panel closes after it. */
export function openSourceSheet(
  trigger: HTMLElement | null,
  onAdd: (pick: Chosen) => void,
  topicId = "",
): void {
  const template = document.getElementById("source-sheet-template") as HTMLTemplateElement | null;
  const clone = template?.content.firstElementChild?.cloneNode(true);
  if (!(clone instanceof HTMLDialogElement)) return;
  const sheet = clone;
  document.body.append(sheet);

  const field = sheet.querySelector("[data-sheet-url]") as HTMLInputElement;
  const topic = sheet.querySelector("[data-sheet-topic]") as HTMLSelectElement;
  const area = sheet.querySelector("[data-sheet-preview]") as HTMLElement;
  const add = sheet.querySelector("[data-sheet-add]") as HTMLButtonElement;
  topic.value = topicId;
  let loaded: { url: string; preview: SourcePreview } | null = null;
  let timer = 0;
  let seq = 0;

  const show = (state: string, node?: HTMLElement): void => {
    area.dataset.state = state;
    area.replaceChildren(...(node ? [node] : []));
  };

  const ask = (): void => {
    const url = webAddress(field.value);
    const turn = ++seq;
    loaded = null;
    add.disabled = true;
    if (!url) {
      show("idle");
      return;
    }
    show("loading", skeleton());
    void look(url).then((outcome) => {
      if (turn !== seq) return;
      if ("preview" in outcome) {
        loaded = { url, preview: outcome.preview };
        show("ready", card(outcome.preview));
        add.disabled = false;
      } else show("error", problem(outcome.status));
    });
  };

  field.addEventListener("input", () => {
    clearTimeout(timer);
    seq += 1;
    loaded = null;
    add.disabled = true;
    timer = window.setTimeout(ask, PREVIEW_DELAY_MS);
  });
  // A pasted address does not need to wait out the pause.
  field.addEventListener("paste", () => {
    clearTimeout(timer);
    timer = window.setTimeout(ask, 0);
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      clearTimeout(timer);
      if (loaded) add.click();
      else ask();
    }
  });

  add.addEventListener("click", () => {
    if (!loaded) return;
    onAdd({ url: loaded.url, topic_id: topic.value, preview: loaded.preview });
    sheet.close();
  });
  sheet.querySelector("[data-sheet-close]")?.addEventListener("click", () => sheet.close());
  // A press on the scrim lands on the dialog itself; everything else is inside its panel.
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) sheet.close();
  });

  // Browser Back closes the panel and stays on the page; the panel takes one history entry.
  let entry = true;
  const onBack = (event: Event): void => {
    if (!entry) return;
    entry = false;
    event.preventDefault();
    removeEventListener("dispatch:back", onBack);
    if (sheet.open) sheet.close();
  };
  history.pushState({ ...history.state, sourceSheet: true }, "");
  addEventListener("dispatch:back", onBack);
  sheet.addEventListener(
    "close",
    () => {
      clearTimeout(timer);
      seq += 1;
      if (trigger?.isConnected) trigger.focus();
      sheet.remove();
      // Closed any other way: give the entry back. The pop this causes reaches onBack, which swallows it.
      if (entry) history.go(-1);
    },
    { once: true },
  );
  sheet.showModal();
  field.focus();
}
