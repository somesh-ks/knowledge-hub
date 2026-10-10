/**
 * The Topics & sources editor, loaded the first time a switch, a slider, a remove button or Add
 * source is used (topicsPage.ts forwards the event that woke it). It records each change as an op,
 * counts them in the bar, and sends them on Save through managePageSave.ts. The Add source panel is
 * topicsSheet.ts, loaded when it is first opened.
 *
 * The page is built with every control at its saved state, so what the editor holds is a comparison:
 * a control that differs from the state it was built (or last saved) in is a pending change.
 *
 * The pure parts are exported and tested; the rest is wiring.
 */
import type { ConfigOp } from "../types/contracts";
import type { Pending, SaveContext } from "./managePageSave";
import type { Chosen } from "./topicsSheet";
import { bandOf, element, iconNode, scoreNode } from "./topicsView";

/** Most keywords a topic holds (MAX_KEYWORDS in core; the page script does not import core). */
const MAX_KEYWORDS = 30;

/** What a name leaves for an id: lowercase letters, digits and hyphens. Under two characters is no id. */
export function idText(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

/** A topic's id from its name: lowercase letters, digits and hyphens, unique among `taken`. */
export function slugify(name: string, taken: readonly string[]): string {
  const cleaned = idText(name);
  const base = cleaned.length >= 2 ? cleaned : "topic";
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
}

/** Keywords from a comma-separated line: trimmed, no empties, no repeats, within what a topic holds. */
export function keywordList(text: string): string[] {
  const words = text
    .split(",")
    .map((word) => word.trim().slice(0, 60))
    .filter(Boolean);
  return [...new Set(words)].slice(0, MAX_KEYWORDS);
}

type Control = HTMLInputElement;

/** What a control holds now. A pressed button is a boolean, a slider a number. */
function held(control: Control): boolean | number {
  if (control.type === "range") return Number(control.value);
  return control.type === "checkbox"
    ? control.checked
    : control.getAttribute("aria-pressed") === "true";
}

/** What a control held when the page was built: its markup, before anyone touched it. */
function builtAs(control: Control): string {
  if (control.type === "range") return String(Number(control.defaultValue));
  return String(control.type === "checkbox" ? control.defaultChecked : false);
}

/** The edit a control stands for: the op in its data-op, with its field set to what it holds. */
function editOf(control: Control): ConfigOp {
  const op = JSON.parse(control.dataset.op ?? "{}");
  const [outer = "", inner] = (control.dataset.field ?? "").split(".");
  if (inner) op[outer][inner] = held(control);
  else if (outer) op[outer] = held(control);
  return op;
}

export interface Editor {
  handle(event: Event): void;
}

export function mountEditor(root: HTMLElement): Editor {
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    root.querySelector(selector) as T;
  const bar = one("[data-bar]");
  const text = one("[data-bar-text]");
  const live = one("[data-live]");
  const queued = one("[data-queued]");
  const taken = (root.dataset.taken ?? "").split(" ");
  /** Each pending change by a key: an op string and its field, or the key of a queued row. */
  const changes = new Map<string, Pending>();
  let added = 0;

  const show = (message: string, state: string): void => {
    text.textContent = message;
    live.textContent = message;
    bar.dataset.state = state;
    bar.hidden = false;
    root.setAttribute("data-pending", "");
  };
  const refresh = (): void => {
    const count = changes.size;
    if (count > 0) show(`${count} ${count === 1 ? "change" : "changes"}`, "idle");
    else {
      bar.hidden = true;
      root.removeAttribute("data-pending");
    }
  };

  /** Records or drops the change a control stands for. */
  const update = (control: Control): void => {
    const key = (control.dataset.op ?? "") + (control.dataset.field ?? "");
    const now = String(held(control));
    if (now === control.dataset.was) changes.delete(key);
    else changes.set(key, { op: editOf(control), el: control, now });
    refresh();
  };

  const context: SaveContext = {
    changes,
    show,
    fields: one("[data-fields]"),
    dialog: root.querySelector("dialog") as HTMLDialogElement,
  };

  // A source added from the panel says so in its row once the save has gone through.
  new MutationObserver(() => {
    if (bar.dataset.state !== "done") return;
    for (const row of root.querySelectorAll<HTMLElement>(".source-row[data-key]")) {
      if (changes.has(row.dataset.key ?? "")) continue;
      const note = row.querySelector(".source-note");
      if (note) note.textContent = "Added. It appears after the next build.";
    }
  }).observe(bar, { attributes: true, attributeFilter: ["data-state"] });

  // ------------------------------------------------------------------------------------ adding

  /** A topic waiting to be saved, listed above the topics until it is. */
  const queue = (name: string, op: ConfigOp): void => {
    const template = one<HTMLTemplateElement>("template:not(#source-sheet-template)");
    const row = template.content.firstElementChild?.cloneNode(true) as HTMLElement;
    added += 1;
    row.dataset.key = `new${added}`;
    (row.querySelector("[data-q-name]") as HTMLElement).textContent = name;
    row.querySelector("button")?.setAttribute("aria-label", `Cancel adding ${name}`);
    queued.append(row);
    changes.set(row.dataset.key, { op, el: row, now: "" });
    refresh();
  };

  const addTopic = (form: HTMLFormElement): void => {
    const data = new FormData(form);
    const value = (name: string): string => String(data.get(name) ?? "").trim();
    // The form skips the browser's own check so the message sits beside the field.
    const bad = [
      [
        "name",
        !value("name")
          ? "Enter a name."
          : idText(value("name")).length < 2
            ? "Use at least two letters or numbers in the name."
            : "",
      ],
      ["description", value("description") ? "" : "Say what should count as this topic."],
    ] as const;
    let first: HTMLElement | null = null;
    for (const [field, message] of bad) {
      const input = form.elements.namedItem(field) as HTMLInputElement;
      const note = form.querySelector<HTMLElement>(`[data-error="${field}"]`);
      if (!note) continue;
      note.hidden = !message;
      const line = note.querySelector("span");
      if (line) line.textContent = message;
      input.toggleAttribute("aria-invalid", Boolean(message));
      if (message) first ??= input;
    }
    if (first) {
      first.focus();
      return;
    }
    // A topic still waiting to be saved holds its id; one that was cancelled gives it back.
    const waiting = [...changes.values()].map(({ op }) =>
      op.op === "topic.upsert" ? (op.topic.id ?? "") : "",
    );
    const id = slugify(value("name"), [...taken, ...waiting]);
    queue(value("name"), {
      op: "topic.upsert",
      topic: {
        id,
        name: value("name"),
        description: value("description"),
        weight: 0.5,
        enabled: true,
        keywords: keywordList(value("keywords")),
        // A new topic gets a section of its own, titled after it.
        section_id: id,
      },
    });
    form.reset();
    form.closest("details")?.removeAttribute("open");
  };

  /** The row for a source just added from the panel, in its topic's list and tinted. */
  const addSource = ({ url, topic_id, preview }: Chosen): void => {
    added += 1;
    const key = `src${added}`;
    const row = element("li", "source-row is-new");
    row.dataset.key = key;
    row.dataset.band = bandOf(preview.score);
    row.dataset.score = String(preview.score);
    row.dataset.name = preview.name.toLowerCase();
    const label = element("span", "source-text");
    const note = element("span", "source-note", "Adding when you save");
    label.append(element("span", "source-name", preview.name), note);
    row.append(
      iconNode(preview.name, preview.favicon_url ?? preview.thumbnail_url),
      label,
      scoreNode(preview.score, preview.score_label),
      element("span", "source-slot"),
    );
    const topic = [...root.querySelectorAll<HTMLElement>(".topic")].find(
      (item) => item.dataset.id === topic_id,
    );
    const list = topic?.querySelector("[data-sources]") ?? one(".topic-other [data-sources]");
    list.prepend(row);
    // The page may be filtered; a source that was just added is always shown.
    if (root.dataset.band && root.dataset.band !== "all") {
      root.dataset.band = "all";
      const bandFilter = root.querySelector<HTMLSelectElement>("select[data-band-filter]");
      if (bandFilter) bandFilter.value = "all";
    }
    row.scrollIntoView({ block: "center" });
    changes.set(key, {
      op: { op: "source.add", url, ...(topic_id ? { topic_ids: [topic_id] } : {}) },
      el: note,
      now: "",
    });
    refresh();
    void import("./managePageSave").then((module) => module.save(context));
  };

  const openPanel = (trigger: HTMLElement): void => {
    const topic = trigger.dataset.addSource ?? "";
    void import("./topicsSheet").then((module) =>
      module.openSourceSheet(trigger, addSource, topic),
    );
  };

  // -------------------------------------------------------------------------------- the events

  const press = (button: HTMLButtonElement): void => {
    const act = button.dataset.act;
    const row = button.closest<HTMLElement>("li");
    if ("addSource" in button.dataset) openPanel(button);
    else if (act === "save") void import("./managePageSave").then((module) => module.save(context));
    else if (act === "close") context.dialog.close();
    else if (act === "dismiss") refresh();
    else if (act === "discard") location.reload();
    else if (act === "cancel" && row) {
      changes.delete(row.dataset.key ?? "");
      row.remove();
      refresh();
    } else if (button.dataset.op) {
      const control = button as unknown as Control;
      const pressed = !held(control);
      control.setAttribute("aria-pressed", String(pressed));
      const label = pressed ? control.dataset.labelUndo : control.dataset.label;
      if (label) control.setAttribute("aria-label", label);
      update(control);
    }
  };

  // Each control remembers how the page was built, so putting it back drops the change; whatever
  // was moved before this loaded is picked up now.
  const controls = [...root.querySelectorAll<Control>("[data-op]")];
  for (const control of controls) control.dataset.was = builtAs(control);
  for (const control of controls)
    if (String(held(control)) !== control.dataset.was) update(control);

  return {
    handle(event) {
      const target = event.target as HTMLElement;
      if (event.type === "submit") {
        const form = target as HTMLFormElement;
        if (form.dataset.add === "topic") addTopic(form);
      } else if (event.type === "click") {
        const button = target.closest("button");
        if (button) press(button);
      } else if (event.type === "input") {
        const control = target as Control;
        const form = control.closest<HTMLFormElement>("form[data-add=topic]");
        if (form && control.hasAttribute("aria-invalid")) {
          control.removeAttribute("aria-invalid");
          const note = form.querySelector<HTMLElement>(`[data-error="${control.name}"]`);
          if (note) note.hidden = true;
        }
        if (control.matches("[data-op]")) update(control);
      }
    },
  };
}
