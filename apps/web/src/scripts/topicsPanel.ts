/**
 * The Topics & Sources panel: one native modal dialog, cloned from the page's template each time it
 * opens, for four jobs. Add opens it on Topic: a new topic's name, what counts and where it plays,
 * added in one press (D71); its sources are suggested on its page. A topic's Edit topic opens the
 * same details filled in. Its Source segment, and a topic's Add source, take an address, look it up
 * after a pause (GET /api/source-preview) and file the source under a topic. A source's row opens
 * it to edit that source: its name, its topic, where it lives and what its score is made of. A
 * modal dialog gives the scrim, the focus trap and Escape; browser Back closes it the way it closes
 * the Create panel. Loaded the first time it is opened.
 */
import { problemText, topicChanged, topicProblems, webAddress } from "../lib/topicText";
import { element, iconNode, type SourcePreview, scoreNode } from "./topicsView";

export const PREVIEW_DELAY_MS = 400;

export interface NewTopic {
  name: string;
  description: string;
  /** A new topic starts with none; an edited one keeps its own, which the panel does not show. */
  keywords: string[];
  /** Where a new topic plays (D69); an edited topic keeps what its page set. */
  scope?: { daily: boolean; weekly: boolean; custom: boolean };
}

export interface Chosen {
  /** The address as typed, made a web address. */
  url: string;
  /** The chosen topic's id; empty for Other. */
  topic_id: string;
  preview: SourcePreview;
}

/** What changed about a source: only the fields that did. */
export interface SourceEdit {
  id: string;
  name?: string;
  topic_ids?: string[];
}

/** What a source's row tells the panel about it. */
export interface SourceFacts {
  id: string;
  name: string;
  /** Empty for Other. */
  topic_id: string;
  /** The topic's name, for a topic the panel's select does not offer (one that never publishes). */
  topic_name: string;
  url: string | null;
  host: string;
  score: number | null;
  label: string;
  /** Each part 0 to 1; trust is null until enough items were checked for hype and sponsorship. */
  parts: { health: number; quality: number; trust: number | null } | null;
  reason: string;
}

/** What a topic's page tells the panel about it. */
export interface TopicFacts {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  /**
   * Where the topic comes from. Its name and keywords always change; what counts changes on a custom
   * or app topic, whose fit question is built from it, and not on a built-in one, judged by fixed
   * questions.
   */
  origin: "builtin" | "app" | "custom" | "general";
}

/** A topic's details as the panel leaves them. */
export interface TopicEdit extends NewTopic {
  id: string;
}

export interface PanelHandlers {
  addTopic(topic: NewTopic): void;
  editTopic(edit: TopicEdit): void;
  addSource(pick: Chosen): void;
  editSource(edit: SourceEdit): void;
}

export type PanelStart =
  | { kind: "topic" }
  | { kind: "topic-edit"; topic: TopicFacts }
  | { kind: "source"; topicId: string }
  | { kind: "edit"; source: SourceFacts };

/** What changed between a source and the edit panel's fields, or null when nothing did. */
export function editOf(
  source: Pick<SourceFacts, "id" | "name" | "topic_id">,
  fields: { name: string; topic: string },
): SourceEdit | null {
  const edit: SourceEdit = { id: source.id };
  const name = fields.name.trim();
  if (name && name !== source.name) edit.name = name;
  if (fields.topic !== source.topic_id) edit.topic_ids = fields.topic ? [fields.topic] : [];
  return edit.name === undefined && edit.topic_ids === undefined ? null : edit;
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
  head.append(iconNode(preview.thumbnail_url ?? preview.favicon_url, preview.name), title);

  const score = element("div", "source-card-score");
  score.append(scoreNode(preview.score_label), element("p", "source-card-reason", preview.reason));

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

/** Opens the panel where `start` says. The handler for what it makes runs before the panel closes. */
export function openPanel(
  trigger: HTMLElement | null,
  handlers: PanelHandlers,
  start: PanelStart,
): void {
  const template = document.getElementById("topics-panel-template") as HTMLTemplateElement | null;
  const clone = template?.content.firstElementChild?.cloneNode(true);
  if (!(clone instanceof HTMLDialogElement)) return;
  const panel = clone;
  // A panel still sliding out goes now, so its fields never share an id with this one's.
  for (const old of document.querySelectorAll("dialog.topics-panel:not([open])")) old.remove();
  document.body.append(panel);

  const one = <T extends Element>(selector: string): T => panel.querySelector(selector) as T;
  const title = one<HTMLElement>("[data-panel-title]");
  const kinds = one<HTMLFieldSetElement>("[data-panel-kind]");
  const topicPane = one<HTMLFormElement>('[data-pane="topic"]');
  const sourcePane = one<HTMLElement>('[data-pane="source"]');
  const editPane = one<HTMLElement>('[data-pane="edit"]');
  const go = one<HTMLButtonElement>("[data-panel-go]");

  let mode: PanelStart["kind"] = start.kind;

  // ---------------------------------------------------------------------------------- a topic

  const topicField = (name: string): HTMLInputElement | HTMLTextAreaElement =>
    topicPane.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
  const scoped = (key: string): boolean =>
    topicPane.querySelector<HTMLInputElement>(`input[name="scope"][value="${key}"]`)?.checked ??
    true;
  // Editing a topic starts from what it holds. A built-in topic is judged by fixed questions, so what
  // counts stays as it is; its name takes typing like any other topic's. Its keywords have no field
  // (D71) and go back as they were, so a save never empties them.
  const editedTopic = start.kind === "topic-edit" ? start.topic : null;
  const topicValue = (): NewTopic => ({
    name: topicField("name").value.trim(),
    description: topicField("description").value.trim(),
    keywords: editedTopic ? [...editedTopic.keywords] : [],
    scope: { daily: scoped("daily"), weekly: scoped("weekly"), custom: scoped("custom") },
  });
  if (editedTopic) {
    topicPane.setAttribute("aria-label", "Edit topic");
    one<HTMLElement>("[data-scope]").hidden = true;
    topicField("name").value = editedTopic.name;
    topicField("description").value = editedTopic.description;
    if (editedTopic.origin === "builtin") {
      topicField("description").readOnly = true;
      one<HTMLElement>("[data-fixed-note]").hidden = false;
    }
  }
  const topicDirty = (): boolean => editedTopic !== null && topicChanged(editedTopic, topicValue());

  /** Shows each field's problem beside it and returns the first field that has one. */
  const flag = (problems: Record<string, string>): HTMLElement | null => {
    let first: HTMLElement | null = null;
    for (const [name, message] of Object.entries(problems)) {
      const input = topicField(name);
      if (!input) continue;
      const note = topicPane.querySelector<HTMLElement>(`[data-error="${name}"]`);
      if (!note) continue;
      note.hidden = !message;
      const line = note.querySelector("span");
      if (line) line.textContent = message;
      input.toggleAttribute("aria-invalid", Boolean(message));
      if (message) first ??= input;
    }
    return first;
  };

  topicPane.addEventListener("input", (event) => {
    const control = event.target as HTMLInputElement;
    if (control.hasAttribute("aria-invalid")) {
      control.removeAttribute("aria-invalid");
      const note = topicPane.querySelector<HTMLElement>(`[data-error="${control.name}"]`);
      if (note) note.hidden = true;
    }
    render();
  });

  // ---------------------------------------------------------------------------------- a source

  const address = one<HTMLInputElement>("[data-source-url]");
  const sourceTopic = one<HTMLSelectElement>("[data-source-topic]");
  const area = one<HTMLElement>("[data-source-preview]");
  let loaded: { url: string; preview: SourcePreview } | null = null;
  let timer = 0;
  let seq = 0;
  if (start.kind === "source") sourceTopic.value = start.topicId;

  const addressError = one<HTMLElement>('[data-error="url"]');
  const show = (state: string, node?: HTMLElement): void => {
    area.dataset.state = state;
    area.replaceChildren(...(node ? [node] : []));
  };
  /** Why the address gave nothing, under the field as every field's error is, and the field marked. */
  const problem = (message: string): void => {
    addressError.hidden = !message;
    const line = addressError.querySelector("span");
    if (line) line.textContent = message;
    address.toggleAttribute("aria-invalid", Boolean(message));
  };

  const ask = (): void => {
    const url = webAddress(address.value);
    const turn = ++seq;
    loaded = null;
    problem("");
    render();
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
      } else {
        show("idle");
        problem(problemText(outcome.status));
      }
      render();
    });
  };

  address.addEventListener("input", () => {
    clearTimeout(timer);
    seq += 1;
    loaded = null;
    problem("");
    render();
    timer = window.setTimeout(ask, PREVIEW_DELAY_MS);
  });
  // A pasted address does not need to wait out the pause.
  address.addEventListener("paste", () => {
    clearTimeout(timer);
    timer = window.setTimeout(ask, 0);
  });

  // ---------------------------------------------------------------------------------- editing

  const editName = one<HTMLInputElement>("[data-edit-name]");
  const editTopic = one<HTMLSelectElement>("[data-edit-topic]");
  const editNote = one<HTMLElement>('[data-error="edit-name"]');
  const edited = start.kind === "edit" ? start.source : null;
  if (edited) {
    editName.value = edited.name;
    // A topic the select does not offer is added to it, so opening the panel never moves the source.
    if (![...editTopic.options].some((option) => option.value === edited.topic_id)) {
      editTopic.add(new Option(edited.topic_name || edited.topic_id, edited.topic_id), 0);
    }
    editTopic.value = edited.topic_id;
    const open = one<HTMLAnchorElement>("[data-edit-open]");
    const where = one<HTMLElement>(".edit-address");
    if (edited.url) {
      open.href = edited.url;
      open.setAttribute("aria-label", `Open ${edited.name} in a new tab`);
      one<HTMLElement>("[data-edit-host]").textContent = edited.host || edited.url;
    } else where.hidden = true;
    one<HTMLElement>("[data-edit-total]").textContent =
      edited.score === null
        ? "New: too little history for a score yet."
        : `${edited.score.toFixed(1)} of 3, ${edited.label}`;
    const parts = one<HTMLElement>("[data-edit-parts]");
    parts.hidden = edited.parts === null;
    // Two decimals, as the engine rounds each part. A part not measured yet says so, with no bar.
    for (const [part, value] of Object.entries(edited.parts ?? {})) {
      const row = parts.querySelector<HTMLElement>(`[data-part="${part}"]`);
      const num = row?.querySelector(".part-num");
      if (!row || !num) continue;
      if (value === null) {
        row.dataset.unmeasured = "";
        num.textContent = "Not measured yet";
        continue;
      }
      row.querySelector<HTMLElement>(".part-meter")?.style.setProperty("--part", String(value));
      num.textContent = value.toFixed(2);
    }
    one<HTMLElement>("[data-edit-reason]").textContent = edited.reason;
  }
  const editNow = (): SourceEdit | null =>
    edited ? editOf(edited, { name: editName.value, topic: editTopic.value }) : null;
  editName.addEventListener("input", () => {
    if (editName.value.trim()) {
      editNote.hidden = true;
      editName.removeAttribute("aria-invalid");
    }
    render();
  });
  editTopic.addEventListener("change", render);

  // ---------------------------------------------------------------------------------- the frame

  function render(): void {
    const topicLike = mode === "topic" || mode === "topic-edit";
    panel.dataset.mode = mode;
    kinds.hidden = mode === "edit" || mode === "topic-edit";
    topicPane.hidden = !topicLike;
    sourcePane.hidden = mode !== "source";
    editPane.hidden = mode !== "edit";
    title.textContent = {
      topic: "Add a topic",
      "topic-edit": "Edit topic",
      source: "Add a source",
      edit: "Edit source",
    }[mode];
    if (mode === "topic") {
      go.textContent = "Add topic";
      go.disabled = false;
    } else if (mode === "topic-edit") {
      go.textContent = "Save";
      go.disabled = !topicDirty();
    } else if (mode === "source") {
      go.textContent = "Add source";
      go.disabled = loaded === null;
    } else {
      go.textContent = "Save";
      go.disabled = editNow() === null && editName.value.trim() !== "";
    }
  }

  const firstField = (): HTMLElement =>
    mode === "topic" ? (topicField("name") as HTMLElement) : mode === "source" ? address : editName;

  kinds.addEventListener("change", (event) => {
    const value = (event.target as HTMLInputElement).value;
    mode = value === "source" ? "source" : "topic";
    render();
  });

  go.addEventListener("click", () => {
    if (mode === "topic") {
      const topic = topicValue();
      const bad = flag(topicProblems(topic));
      if (bad) {
        bad.focus();
        return;
      }
      handlers.addTopic(topic);
      panel.close();
    } else if (mode === "topic-edit" && editedTopic) {
      const topic = topicValue();
      const bad = flag(topicProblems(topic));
      if (bad) {
        bad.focus();
        return;
      }
      if (topicDirty()) handlers.editTopic({ id: editedTopic.id, ...topic });
      panel.close();
    } else if (mode === "source") {
      if (!loaded) return;
      handlers.addSource({ url: loaded.url, topic_id: sourceTopic.value, preview: loaded.preview });
      panel.close();
    } else {
      if (!editName.value.trim()) {
        editNote.hidden = false;
        editName.setAttribute("aria-invalid", "");
        editName.focus();
        return;
      }
      const edit = editNow();
      if (edit) handlers.editSource(edit);
      panel.close();
    }
  });

  // Enter moves on from a one-line field, as the button would; in the description it is a new line.
  panel.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (event.key !== "Enter" || !(target instanceof HTMLInputElement)) return;
    if (target.type === "checkbox" || target.type === "radio") return;
    event.preventDefault();
    if (target === address && !loaded) {
      clearTimeout(timer);
      ask();
      return;
    }
    if (!go.disabled) go.click();
  });

  panel.querySelector("[data-panel-close]")?.addEventListener("click", () => panel.close());
  // A press on the scrim lands on the dialog itself; everything else is inside its panel. Only a press
  // that also began on the scrim closes it: a drag out of a field ends there too.
  let fromScrim = false;
  panel.addEventListener("pointerdown", (event) => {
    fromScrim = event.target === panel;
  });
  panel.addEventListener("click", (event) => {
    if (event.target === panel && fromScrim) panel.close();
    fromScrim = false;
  });

  // Browser Back closes the panel and stays on the page; the panel takes one history entry.
  let entry = true;
  const onBack = (event: Event): void => {
    if (!entry) return;
    entry = false;
    event.preventDefault();
    removeEventListener("dispatch:back", onBack);
    if (panel.open) panel.close();
  };
  history.pushState({ ...history.state, topicsPanel: true }, "");
  addEventListener("dispatch:back", onBack);
  panel.addEventListener(
    "close",
    () => {
      clearTimeout(timer);
      seq += 1;
      if (trigger?.isConnected) trigger.focus();
      // It slides out as the Create panel does, then goes. Only its transitions are waited on: a
      // loading card's shimmer never ends.
      const exits = panel
        .getAnimations({ subtree: true })
        .filter((animation) => animation instanceof CSSTransition);
      void Promise.allSettled(exits.map((exit) => exit.finished)).then(() => panel.remove());
      // Closed any other way: give the entry back. The pop this causes reaches onBack, which swallows it.
      if (entry) history.go(-1);
    },
    { once: true },
  );

  if (mode === "source") {
    const radio = kinds.querySelector<HTMLInputElement>('input[value="source"]');
    if (radio) radio.checked = true;
  }
  render();
  panel.showModal();
  // Adding starts with typing, so the first field takes focus. Editing starts with reading, so the
  // panel keeps the browser's own first focus, and a phone's keyboard does not cover what is there.
  if (mode === "topic" || mode === "source") firstField().focus();
}
