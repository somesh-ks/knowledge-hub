/**
 * The Topics editor, loaded the first time a switch, a slider, a remove button or Add source is used
 * (topicsPage.ts forwards the event that woke it). It records each change as an op, and autosave.ts
 * sends it a moment later through managePageSave.ts. The Add source panel is topicsSheet.ts, loaded
 * when it is first opened.
 *
 * The page is built with every control at its saved state, so what the editor holds is a comparison:
 * a control that differs from the state it was built (or last saved) in is a pending change.
 *
 * The pure parts are exported and tested; the rest is wiring.
 */
import type { ConfigOp } from "../types/contracts";
import { mountAutosave } from "./autosave";
import type { Pending } from "./managePageSave";
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
  const queued = one("[data-queued]");
  const taken = (root.dataset.taken ?? "").split(" ");
  /** Each pending change by a key: an op string and its field, or the key of a queued row. */
  const changes = new Map<string, Pending>();
  let added = 0;

  /** Records or drops the change a control stands for. */
  const record = (control: Control): void => {
    const key = (control.dataset.op ?? "") + (control.dataset.field ?? "");
    const now = String(held(control));
    if (now === control.dataset.was) changes.delete(key);
    else changes.set(key, { op: editOf(control), el: control, now });
  };
  const update = (control: Control): void => {
    record(control);
    autosave.changed();
  };

  // After each save every control is compared again with what it was saved as. A removal waits with
  // an Undo in the toast; Undo presses each removal's button again.
  const controls = [...root.querySelectorAll<Control>("[data-op]")];
  const removals = (): HTMLButtonElement[] =>
    [...changes.values()]
      .map(({ el }) => el)
      .filter((el): el is HTMLButtonElement => el.matches("button[data-remove]"));
  const autosave = mountAutosave(
    root,
    changes,
    () => {
      for (const control of controls)
        if (control.isConnected && !control.closest("[data-gone]")) record(control);
    },
    {
      removing() {
        const names = removals().map((button) =>
          (button.dataset.label ?? "").replace(/^Remove /, ""),
        );
        if (names.length === 0) return null;
        return names.length === 1 ? `Removing ${names[0]}` : `Removing ${names.length} items`;
      },
      undo() {
        for (const button of removals()) press(button);
      },
    },
  );

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
    autosave.changed();
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
    const note = element("span", "source-note", "Adding");
    label.append(element("span", "source-name", preview.name), note);
    row.append(
      iconNode(preview.favicon_url ?? preview.thumbnail_url),
      label,
      scoreNode(preview.score, preview.score_label),
      element("span", "source-slot"),
    );
    // On a topic's page the row joins its list; on the Topics list it waits under Add source until
    // the build files it under its topic.
    const topic = [...root.querySelectorAll<HTMLElement>(".topic")].find(
      (item) => item.dataset.id === (topic_id ?? ""),
    );
    const list =
      topic?.querySelector("[data-sources]") ??
      root.querySelector("[data-added]") ??
      one("[data-sources]");
    list.prepend(row);
    row.scrollIntoView({ block: "center" });
    changes.set(key, {
      op: { op: "source.add", url, ...(topic_id ? { topic_ids: [topic_id] } : {}) },
      el: note,
      now: "",
    });
    // Chosen in the panel, a source is a decision already made: it goes now, with anything waiting.
    autosave.now();
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
    else if (act === "cancel" && row) {
      changes.delete(row.dataset.key ?? "");
      row.remove();
      autosave.changed();
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
