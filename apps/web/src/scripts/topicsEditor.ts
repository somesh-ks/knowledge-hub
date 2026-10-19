/**
 * The Topics and sources editor, loaded the first time a switch, a slider, a remove button, a source's
 * row, a suggestion's +, Edit topic or Add is used (topicsPage.ts forwards the event that woke it).
 * It records each change as an op, and autosave.ts sends it a moment later through
 * managePageSave.ts. The panel that adds and edits topics and sources is topicsPanel.ts, loaded when
 * it is first opened.
 *
 * The page is built with every control at its saved state, so what the editor holds is a comparison:
 * a control that differs from the state it was built (or last saved) in is a pending change.
 *
 * The pure parts are exported and tested; the rest is wiring.
 */
import { parseSuggestedAdd, type SuggestedAdd, slugify } from "../lib/topicText";
import type { ConfigOp } from "../types/contracts";
import { mountAutosave } from "./autosave";
import type { Pending } from "./managePageSave";
import type {
  Chosen,
  NewTopic,
  PanelStart,
  SourceEdit,
  SourceFacts,
  TopicEdit,
  TopicFacts,
} from "./topicsPanel";
import { bandOf, element, iconNode, starNode } from "./topicsView";

type Control = HTMLInputElement;

/** What a suggested source's row says when its request was refused or did not go. */
const NOT_ADDED = "Not added. Try again.";
/** And a topic's row, which has no plus to press: the toast's Retry may be dismissed, the next change still sends it. */
const TOPIC_NOT_ADDED = "Not added yet. It goes with your next change.";

/**
 * What a control holds now. A pressed button is a boolean, a slider a number. A remove button keeps
 * its state in data-pressed, not aria-pressed: its name changes with it ("Remove X", "Undo removing
 * X"), and a toggle button's name must not.
 */
function held(control: Control): boolean | number {
  if (control.type === "range") return Number(control.value);
  return control.type === "checkbox" ? control.checked : control.dataset.pressed === "true";
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
        const names = removals().map((button) => button.dataset.name ?? "");
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
  const queue = (name: string, op: ConfigOp, after?: ConfigOp[]): HTMLElement => {
    const template = one<HTMLTemplateElement>(
      "template:not(#topics-panel-template, #suggested-template)",
    );
    const row = template.content.firstElementChild?.cloneNode(true) as HTMLElement;
    added += 1;
    row.dataset.key = `new${added}`;
    (row.querySelector("[data-q-name]") as HTMLElement).textContent = name;
    queued.append(row);
    changes.set(row.dataset.key, {
      op,
      el: row,
      now: "",
      ...(after?.length ? { with: after } : {}),
      // Refused or not sent: the row says so, and the toast's Retry sends it again.
      fail: () => {
        const note = row.querySelector(".manage-quiet");
        if (note) note.textContent = TOPIC_NOT_ADDED;
      },
    });
    // The panel closes behind it, so focus and the view go to the row that says it is being added.
    row.tabIndex = -1;
    row.focus({ preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "center", behavior: reduce ? "instant" : "smooth" });
    return row;
  };

  /**
   * A topic from the panel: a decision already made, so it is sent now. It waits in the list, saved,
   * until the build gives it a page: the site is static, so a page for it does not exist before
   * then, and leaving this one would drop the request on its way (and any passphrase it asks for).
   */
  const addTopic = (topic: NewTopic): void => {
    // A topic still waiting to be saved holds its id.
    const waiting = [...changes.values()].map(({ op }) =>
      op.op === "topic.upsert" ? (op.topic.id ?? "") : "",
    );
    const id = slugify(topic.name, [...taken, ...waiting]);
    // The podcasts it is left out of, sent with it so the topic exists when they are applied.
    const out = Object.fromEntries(
      Object.entries(topic.scope ?? {}).filter(([, inScope]) => !inScope),
    ) as { daily?: boolean; weekly?: boolean; custom?: boolean };
    const scope: ConfigOp[] =
      Object.keys(out).length > 0 ? [{ op: "topic.scope", ids: [id], ...out }] : [];
    const row = queue(
      topic.name,
      {
        op: "topic.upsert",
        topic: {
          id,
          name: topic.name,
          description: topic.description,
          weight: 0.5,
          enabled: true,
          keywords: topic.keywords,
          // A new topic gets a section of its own, titled after it.
          section_id: id,
        },
      },
      scope,
    );
    autosave.now();
    // Its suggested sources at once, ranked in the browser as the build ranks them for its page.
    void import("./savedView").then((view) =>
      view.suggestUnder(row, { id, name: topic.name, description: topic.description }),
    );
  };

  /**
   * The row for a source being added, in its topic's list and tinted. On the list page, or for a topic
   * not built yet, it waits under the list until the build files it under its topic.
   */
  /** The address as a built row shows it (readableUrl in lib/manage.ts, which a page script cannot import). */
  const readableUrl = (address: string): string => {
    try {
      const url = new URL(address);
      return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
      return "";
    }
  };

  const addRow = (
    shown: { name: string; icon: string | null; score?: number | null; label?: string },
    op: ConfigOp,
    topicId: string,
  ): void => {
    added += 1;
    const key = `src${added}`;
    const row = element("li", "source-row");
    row.dataset.key = key;
    row.dataset.band = bandOf(shown.score ?? null);
    row.dataset.score = String(shown.score ?? -1);
    row.dataset.name = shown.name.toLowerCase();
    // The same parts as a built row (SourceRow.astro), live at once: the page names the source's id
    // in the add, so the checkbox, the edit panel and Delete work before the build lists it.
    const address = op.op === "source.add" ? op.url : "";
    const host = readableUrl(address);
    const id = `${
      host
        .split("/")[0]
        ?.replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "source"
    }-${Math.random().toString(36).slice(2, 6)}`;
    if (op.op === "source.add") op.id = id;
    row.dataset.id = id;
    row.title = address;
    const topicName =
      [...(document.querySelector<HTMLSelectElement>("[data-edit-topic]")?.options ?? [])].find(
        (option) => option.value === topicId,
      )?.text ??
      (topicId || "Other");
    const edit = element("button", "source-edit");
    edit.type = "button";
    edit.setAttribute("aria-label", `Edit ${shown.name}`);
    edit.dataset.editSource = JSON.stringify({
      id,
      name: shown.name,
      topic_id: topicId,
      topic_name: topicName,
      url: address,
      host: host.split("/")[0] ?? "",
      score: shown.score ?? null,
      label: shown.label ?? "New",
      parts: null,
    });
    const main = element("span", "source-main");
    const label = element("span", "source-text");
    const meta = element("span", "source-meta");
    meta.append(element("span", "source-url", host));
    label.append(element("span", "source-name", shown.name), meta);
    main.append(iconNode(shown.icon, shown.name), label);
    const score = element("span", "score");
    score.dataset.label = shown.label ?? "New";
    if (shown.score == null) score.append(element("span", "score-new", "New"));
    else score.append(starNode(), element("span", "score-number", shown.score.toFixed(1)));
    const check = element("label", "source-check");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.autocomplete = "off";
    box.setAttribute("aria-label", `Read ${shown.name}`);
    box.dataset.op = JSON.stringify({ op: "source.set", id, enabled: true });
    box.dataset.field = "enabled";
    box.dataset.was = "true";
    check.append(box, element("span", "suggest-box"));
    const remove = element("button", "source-remove");
    remove.type = "button";
    remove.hidden = true;
    remove.dataset.remove = "";
    remove.dataset.name = shown.name;
    remove.dataset.label = `Delete ${shown.name}`;
    remove.dataset.labelUndo = `Undo deleting ${shown.name}`;
    remove.dataset.op = JSON.stringify({ op: "source.remove", id });
    remove.dataset.was = "false";
    controls.push(box, remove as unknown as Control);
    // How the save goes is told to a screen reader here, and to the eye by the toast.
    const note = element("span", "source-announce sr-only", "Adding");
    note.setAttribute("role", "status");
    row.append(edit, main, score, check, remove, note);
    const topic = [...root.querySelectorAll<HTMLElement>(".topic")].find(
      (item) => item.dataset.id === topicId,
    );
    const list =
      topic?.querySelector("[data-sources]") ??
      root.querySelector("[data-added]") ??
      one("[data-sources]");
    list.prepend(row);
    row.scrollIntoView({ block: "center" });
    changes.set(key, { op, el: note, now: "" });
  };

  /**
   * A suggestion added from its row. The row says it is being added in the line that named its site, and then that it is, once the edit is saved (settle, in managePageSave.ts); its
   * button shows a check where the plus was. Nothing is put in the list above or scrolled to, so the
   * page stays as it was and the next suggestion is where the last one left it.
   */
  const addSuggested = (button: HTMLButtonElement, suggestion: SuggestedAdd): void => {
    const { name, feed_url, topic_id } = suggestion;
    const note = element("span", "source-note", "Adding");
    button.closest("li")?.querySelector(".source-meta")?.replaceChildren(note);
    // One pending add per feed: the plus pressed again after a refusal sends that same one.
    const earlier = [...changes].find(
      ([, other]) => other.op.op === "source.add" && other.op.url === feed_url,
    );
    if (!earlier) added += 1;
    const asAdded = (): void => {
      button.disabled = true;
      button.classList.add("is-added");
      button.setAttribute("aria-label", `Added ${name}`);
    };
    changes.set(earlier?.[0] ?? `src${added}`, {
      op: { op: "source.add", url: feed_url, ...(topic_id ? { topic_ids: [topic_id] } : {}) },
      el: note,
      now: "",
      // Refused or not sent: the row says so and offers the plus again, rather than keep a check.
      fail: () => {
        note.textContent = NOT_ADDED;
        button.disabled = false;
        button.classList.remove("is-added");
        button.setAttribute("aria-label", `Add ${name}`);
      },
      done: asAdded,
    });
    autosave.now();
    asAdded();
  };

  /** A source chosen by its address in the panel: a decision already made, so it goes now. */
  const addSource = ({ url, topic_id, preview }: Chosen): void => {
    addRow(
      {
        name: preview.name,
        icon: preview.favicon_url ?? preview.thumbnail_url,
        score: preview.score,
        label: preview.score_label,
      },
      { op: "source.add", url, ...(topic_id ? { topic_ids: [topic_id] } : {}) },
      topic_id,
    );
    autosave.now();
  };

  /**
   * A source edited in the panel. A new name shows in its row at once; a new topic is said under its
   * name until the build files it there. Sent now, like everything the panel decides.
   */
  const editSource = (edit: SourceEdit): void => {
    const row = [...root.querySelectorAll<HTMLElement>("li.source-row")].find(
      (item) => item.dataset.id === edit.id,
    );
    const button = row?.querySelector<HTMLElement>("[data-edit-source]");
    if (!row || !button) return;
    const facts = JSON.parse(button.dataset.editSource ?? "{}") as SourceFacts;
    if (edit.name !== undefined) {
      facts.name = edit.name;
      row.dataset.name = edit.name.toLowerCase();
      const name = row.querySelector(".source-name");
      if (name) name.textContent = edit.name;
      button.setAttribute("aria-label", `Edit ${edit.name}`);
    }
    if (edit.topic_ids !== undefined) {
      facts.topic_id = edit.topic_ids[0] ?? "";
      const select = document.querySelector<HTMLSelectElement>("[data-edit-topic]");
      const chosen = [...(select?.options ?? [])].find((option) => option.value === facts.topic_id);
      facts.topic_name = chosen?.text ?? (facts.topic_id ? facts.topic_id : "Other");
      const text = row.querySelector(".source-text");
      let note = row.querySelector<HTMLElement>(".source-note");
      if (!note && text) {
        note = element("span", "source-note");
        text.append(note);
      }
      if (note) note.textContent = `Moves to ${facts.topic_name} in about a minute.`;
    }
    button.dataset.editSource = JSON.stringify(facts);
    // An earlier edit of this source that has not gone yet goes with this one.
    const key = `edit:${edit.id}`;
    const waiting = changes.get(key)?.op;
    const op: ConfigOp = {
      ...(waiting?.op === "source.update" ? waiting : {}),
      op: "source.update",
      ...edit,
    };
    changes.set(key, { op, el: button, now: JSON.stringify(op) });
    autosave.now();
  };

  /**
   * A topic's details from the panel, sent now. The edit is the topic as the page was built (the
   * trigger's data-topic-base) with the new details; the trigger keeps them, so a second edit starts
   * from the first. A topic is always on, so it is sent as on.
   */
  const editTopic = (edit: TopicEdit): void => {
    const trigger = root.querySelector<HTMLElement>("[data-edit-topic]");
    if (!trigger) return;
    const facts = JSON.parse(trigger.dataset.editTopic ?? "{}") as TopicFacts;
    type Upsert = Extract<ConfigOp, { op: "topic.upsert" }>;
    const built = JSON.parse(trigger.dataset.topicBase ?? "{}") as Upsert;
    const topic = {
      ...built.topic,
      name: edit.name,
      description: edit.description,
      keywords: edit.keywords,
      enabled: true,
    };
    trigger.dataset.topicBase = JSON.stringify({ ...built, topic });
    const op: Upsert = { op: "topic.upsert", topic };
    changes.set(`topic-edit:${edit.id}`, { op, el: trigger, now: JSON.stringify(op) });
    // The page says the new name and what counts at once; the rest follows the next build.
    trigger.dataset.editTopic = JSON.stringify({ ...facts, ...edit });
    const title = document.getElementById("page-title");
    if (title) title.textContent = edit.name;
    const note = root.querySelector(".settings-note");
    if (note) note.textContent = edit.description;
    autosave.now();
  };

  /** A source deleted in the panel: its row's remove control, pressed, waits with an Undo. */
  const removeSource = (id: string): void => {
    const row = [...root.querySelectorAll<HTMLElement>("li.source-row")].find(
      (item) => item.dataset.id === id,
    );
    const button = row?.querySelector<HTMLButtonElement>("button.source-remove");
    if (button && button.dataset.pressed !== "true") press(button);
  };

  const openPanel = (trigger: HTMLElement): void => {
    let start: PanelStart;
    if ("editSource" in trigger.dataset) {
      start = { kind: "edit", source: JSON.parse(trigger.dataset.editSource ?? "{}") };
    } else if ("editTopic" in trigger.dataset) {
      start = { kind: "topic-edit", topic: JSON.parse(trigger.dataset.editTopic ?? "{}") };
    } else if ("addSource" in trigger.dataset) {
      start = { kind: "source", topicId: trigger.dataset.addSource ?? "" };
    } else {
      start = { kind: "topic" };
      // The catalogue a new topic's suggestions come from, asked for now so it is in by Add.
      void import("./savedView").then((view) => view.loadCatalog());
    }
    // A menu item is gone once the menu closes: focus goes back to the menu's More button.
    const back =
      trigger
        .closest<HTMLElement>(".topic-card-menu")
        ?.querySelector<HTMLElement>("[data-hero-more]") ?? trigger;
    void import("./topicsPanel").then((module) =>
      module.openPanel(back, { addTopic, editTopic, addSource, editSource, removeSource }, start),
    );
  };

  // -------------------------------------------------------------------------------- the events

  const press = (button: HTMLButtonElement): void => {
    if (
      "addSource" in button.dataset ||
      "addTopic" in button.dataset ||
      "editSource" in button.dataset ||
      "editTopic" in button.dataset
    )
      openPanel(button);
    else if ("suggestedAdd" in button.dataset) {
      const suggestion = parseSuggestedAdd(button.dataset.suggestedAdd);
      if (suggestion) addSuggested(button, suggestion);
    } else if (button.dataset.op) {
      const control = button as unknown as Control;
      const pressed = !held(control);
      control.dataset.pressed = String(pressed);
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
      if (event.type === "click") {
        const button = target.closest("button");
        if (button) press(button);
      } else if (event.type === "input") {
        const control = target as Control;
        if (control.matches("[data-op]")) update(control);
      }
    },
  };
}
