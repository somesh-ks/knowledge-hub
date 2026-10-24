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
import type { SourceFormat } from "@singularity/core";
import { topicEmoji } from "@singularity/core/topicEmoji";
import { pickEmoji } from "../lib/pickEmoji";
import { readableUrl } from "../lib/readableUrl";
import { sourcesSummary } from "../lib/settingsSummary";
import type { HeldSource } from "../lib/sourceCatalogMatch";
import { parseSuggestedAdd, type SuggestedAdd, slugify } from "../lib/topicText";
import { weightOf } from "../lib/weightStops";
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
import { bandOf, element, iconNode, starNode, topicRow } from "./topicsView";

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
  if (control.type === "range") return weightOf(control);
  return control.type === "checkbox" ? control.checked : control.dataset.pressed === "true";
}

/** What a control held when the page was built: its markup, before anyone touched it. */
function builtAs(control: Control): string {
  if (control.type === "range") return String(weightOf(control, control.defaultValue));
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
      // A topic's and a source's removal: each is gone from the page at once and waits behind the
      // scenes with an Undo in the toast (D142).
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
        for (const button of removals()) {
          const row = button.closest("li");
          if (!row) {
            press(button);
            continue;
          }
          // A source's row comes back where it was.
          button.dataset.pressed = "false";
          row.removeAttribute("data-gone");
          update(button as unknown as Control);
        }
      },
    },
  );

  // ------------------------------------------------------------------------------------ adding

  /**
   * A topic from the panel: a decision already made, so it is listed now, as a row like every
   * other, in its place by name, and its row opens a page that shows it until the build gives it its
   * own (D142). Its one save waits for Jev's emoji (the same Jev that places a source's format) for
   * up to 4.5 s; the row shows the name's own guess (core topicEmoji) until then, and the guess is
   * what is saved when Jev has no answer.
   */
  const addTopic = async (topic: NewTopic): Promise<void> => {
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
    const guess = topicEmoji({ id, name: topic.name });
    const op: Extract<ConfigOp, { op: "topic.upsert" }> = {
      op: "topic.upsert",
      topic: {
        id,
        name: topic.name,
        description: topic.description,
        weight: 0.7,
        enabled: true,
        keywords: topic.keywords,
        // A new topic gets a section of its own, titled after it.
        section_id: id,
        emoji: guess,
      },
    };
    const hint = sourcesSummary({ total: 0 });
    const row = topicRow(root, { id, name: topic.name, emoji: guess }, hint);
    if (!row) return;
    added += 1;
    const line = row.querySelector("[data-hint]");
    let ready: () => void = () => {};
    changes.set(`new${added}`, {
      op,
      el: row,
      now: "",
      ...(scope.length > 0 ? { with: scope } : {}),
      ready: new Promise<void>((resolve) => {
        ready = resolve;
      }),
      // Refused or not sent: the row says so, and the toast's Retry sends it again.
      fail: () => {
        if (line) line.textContent = TOPIC_NOT_ADDED;
      },
      done: () => {
        if (line) line.textContent = hint;
      },
    });
    // The panel closes behind it, so focus and the view go to the new row.
    row.focus({ preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "center", behavior: reduce ? "instant" : "smooth" });
    autosave.now();
    void pickEmoji(topic.name, topic.description).then((emoji) => {
      // Not over an emoji the owner has chosen meanwhile.
      if (emoji && op.topic.emoji === guess) {
        op.topic.emoji = emoji;
        const shown = row.querySelector(".topic-emoji");
        if (shown) shown.textContent = emoji;
      }
      ready();
    });
  };

  /**
   * The row for a source being added, in its topic's list and tinted. On the list page, or for a topic
   * not built yet, it waits under the list until the build files it under its topic.
   */
  /** A source row built from what is known of the source, and the line a screen reader hears its save in. */
  const buildRow = (
    shown: {
      name: string;
      icon: string | null;
      score?: number | null;
      label?: string;
      format?: string;
    },
    op: ConfigOp,
    topicId: string,
  ): { row: HTMLElement; note: HTMLElement; key: string } => {
    added += 1;
    const key = `src${added}`;
    const row = element("li", "source-row");
    row.dataset.key = key;
    row.dataset.band = bandOf(shown.score ?? null);
    row.dataset.score = String(shown.score ?? -1);
    row.dataset.name = shown.name.toLowerCase();
    row.dataset.format = shown.format ?? "blog";
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
      format: shown.format ?? "blog",
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
    remove.dataset.op = JSON.stringify({ op: "source.remove", id });
    remove.dataset.was = "false";
    controls.push(box, remove as unknown as Control);
    // How the save goes is told to a screen reader here, and to the eye by the toast.
    const note = element("span", "source-announce sr-only", "Adding");
    note.setAttribute("role", "status");
    row.append(edit, main, score, check, remove, note);
    return { row, note, key };
  };

  /** Puts a source row first in its topic's list; on the list page, or for a topic not built yet, under the list. */
  const placeRow = (row: HTMLElement, topicId: string): void => {
    const topic = [...root.querySelectorAll<HTMLElement>(".topic")].find(
      (item) => item.dataset.id === topicId,
    );
    const list =
      topic?.querySelector("[data-sources]") ??
      root.querySelector("[data-added]") ??
      one("[data-sources]");
    list.prepend(row);
  };

  const addRow = (...args: Parameters<typeof buildRow>): void => {
    const { row, note, key } = buildRow(...args);
    placeRow(row, args[2]);
    row.scrollIntoView({ block: "center" });
    changes.set(key, { op: args[1], el: note, now: "" });
  };

  /** The source row and add of each suggestion pressed, by feed: a retry after a refusal sends the same add. */
  const pressed = new Map<
    string,
    { row: HTMLElement; note: HTMLElement; op: ConfigOp; key: string }
  >();

  /**
   * A suggestion added from its row. The row shimmers while the request goes (data-adding), saying
   * Adding in the line that named its site. Once the edit is saved (settle, in managePageSave.ts) the
   * row leaves Suggested sources, a source's row takes the top of the topic's list, and the next
   * spare suggestion (SuggestedSources.astro) takes the freed place. Nothing is scrolled to, so the
   * page stays where it was. A refusal keeps the row, says so, and gives the plus back.
   */
  const addSuggested = (button: HTMLButtonElement, suggestion: SuggestedAdd): void => {
    const { name, feed_url, topic_id, favicon_url } = suggestion;
    const item = button.closest<HTMLElement>("li");
    const note = element("span", "source-note", "Adding");
    item?.querySelector(".source-meta")?.replaceChildren(note);
    let entry = pressed.get(feed_url);
    if (!entry) {
      const op: ConfigOp = {
        op: "source.add",
        url: feed_url,
        ...(topic_id ? { topic_ids: [topic_id] } : {}),
      };
      // Built now so the add names the source's id; listed once it is saved.
      const built = buildRow({ name, icon: favicon_url }, op, topic_id);
      entry = { ...built, op };
      pressed.set(feed_url, entry);
    }
    const { row, op, key } = entry;
    const busy = (on: boolean): void => {
      button.disabled = on;
      button.setAttribute("aria-label", `${on ? "Adding" : "Add"} ${name}`);
      if (item) {
        item.toggleAttribute("data-adding", on);
        item.setAttribute("aria-busy", String(on));
      }
    };
    changes.set(key, {
      op,
      // The new row's own line, which settle fills in once the add is saved.
      el: entry.note,
      now: "",
      fail: () => {
        note.textContent = NOT_ADDED;
        busy(false);
      },
      done: () => {
        if (row.isConnected) return;
        placeRow(row, topic_id);
        const focused = !item || item.contains(document.activeElement);
        const home = item?.parentElement;
        // Every row that offers this feed, on the page and in the panel, leaves; the next spare of each takes its place.
        for (const other of document.querySelectorAll<HTMLButtonElement>(
          "button[data-suggested-add]",
        )) {
          if (parseSuggestedAdd(other.dataset.suggestedAdd)?.feed_url !== feed_url) continue;
          const li = other.closest("li");
          const list = li?.parentElement;
          li?.remove();
          const spare = list?.querySelector<HTMLElement>("li[data-spare]");
          if (spare) {
            spare.hidden = false;
            spare.removeAttribute("data-spare");
          } else if (list && !list.querySelector("li")) list.closest("section")?.remove();
        }
        if (focused)
          (
            home?.querySelector<HTMLElement>("li:not([hidden]) .source-plus-btn:enabled") ??
            row.querySelector<HTMLElement>(".source-edit")
          )?.focus({ preventScroll: true });
      },
    });
    busy(true);
    autosave.now();
  };

  /** A source chosen by its address in the panel: a decision already made, so it goes now. */
  const addSource = ({ url, topic_id, preview, format }: Chosen): void => {
    addRow(
      {
        name: preview.name,
        icon: preview.favicon_url ?? preview.thumbnail_url,
        score: preview.score,
        label: preview.score_label,
        format,
      },
      {
        op: "source.add",
        url,
        ...(topic_id ? { topic_ids: [topic_id] } : {}),
        ...(format ? { format: format as SourceFormat } : {}),
      },
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
    if (edit.lean !== undefined) facts.lean = edit.lean === null ? "" : String(edit.lean);
    if (edit.high_signal !== undefined) facts.high_signal = edit.high_signal;
    if (edit.format !== undefined) {
      facts.format = edit.format;
      row.dataset.format = edit.format;
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
    root
      .querySelector("[data-change-emoji]")
      ?.setAttribute("aria-label", `Change emoji for ${edit.name}`);
    const note = root.querySelector(".settings-note");
    if (note) note.textContent = edit.description;
    autosave.now();
  };

  /**
   * The topic's emoji from the picker, shown at once and sent now through the same edit as Edit topic
   * (one topic.upsert; a second pick or edit coalesces with it). A topic whose own add has not gone
   * yet carries the pick in that add too.
   */
  const setEmoji = (button: HTMLElement, emoji: string): void => {
    const trigger = root.querySelector<HTMLElement>("[data-edit-topic]");
    if (!trigger) return;
    type Upsert = Extract<ConfigOp, { op: "topic.upsert" }>;
    const built = JSON.parse(trigger.dataset.topicBase ?? "{}") as Upsert;
    const topic = { ...built.topic, emoji, enabled: true };
    trigger.dataset.topicBase = JSON.stringify({ ...built, topic });
    for (const { op } of changes.values())
      if (op.op === "topic.upsert" && op.topic.id === topic.id) op.topic.emoji = emoji;
    const op: Upsert = { op: "topic.upsert", topic };
    changes.set(`topic-edit:${topic.id}`, { op, el: trigger, now: JSON.stringify(op) });
    button.textContent = emoji;
    autosave.now();
  };

  // The picker's code and list start loading on intent (a pointer over or down on the emoji
  // button, or its focus), so they are in by the tap (owner, 2026-10-24: the list was late).
  const warmEmoji = (): void =>
    void import("./emojiPicker").then((module) => module.preloadEmoji());
  for (const type of ["pointerenter", "pointerdown", "focus"])
    root
      .querySelector("[data-change-emoji]")
      ?.addEventListener(type, warmEmoji, { once: true, passive: true });

  /** The emoji button: opens the picker (emojiPicker.ts, loaded now). */
  const changeEmoji = (button: HTMLElement): void => {
    const name = document.getElementById("page-title")?.textContent ?? "";
    void import("./emojiPicker").then((module) =>
      module.openEmojiPicker(button, name, button.textContent?.trim() ?? "", (emoji) =>
        setEmoji(button, emoji),
      ),
    );
  };

  /**
   * A source deleted in the panel: Delete asks first, over the panel, and says whether it was
   * confirmed. Confirmed, the row leaves the list at once and the removal waits behind an Undo
   * toast (deleteNow) before it is sent. The row stays gone on a reload before the build
   * (savedView.ts reads the saved removal).
   */
  const removeSource = (id: string): Promise<boolean> => {
    const row = [...root.querySelectorAll<HTMLElement>("li.source-row")].find(
      (item) => item.dataset.id === id,
    );
    const button = row?.querySelector<HTMLButtonElement>("button.source-remove");
    const dialog = document.querySelector<HTMLDialogElement>("dialog[data-source-confirm]");
    if (!row || !button || !dialog || button.dataset.pressed === "true")
      return Promise.resolve(false);
    const title = dialog.querySelector("[data-source-confirm-title]");
    if (title) title.textContent = `Delete ${button.dataset.name ?? "source"}?`;
    dialog.returnValue = "";
    return new Promise((resolve) => {
      const onClick = (event: Event): void => {
        const choice = (event.target as Element).closest<HTMLButtonElement>("button");
        if (choice && "sourceCancel" in choice.dataset) dialog.close("cancel");
        else if (choice && "sourceDelete" in choice.dataset) dialog.close("delete");
      };
      dialog.addEventListener("click", onClick);
      dialog.addEventListener(
        "close",
        () => {
          dialog.removeEventListener("click", onClick);
          const confirmed = dialog.returnValue === "delete";
          if (confirmed) deleteNow(row, button);
          resolve(confirmed);
        },
        { once: true },
      );
      dialog.showModal();
    });
  };

  /**
   * The row is gone at once: the control is recorded as pressed and waits behind the scenes, with
   * Undo in the toast, as a topic's removal does (D142).
   */
  const deleteNow = (row: HTMLElement, button: HTMLButtonElement): void => {
    button.dataset.pressed = "true";
    row.setAttribute("data-gone", "");
    update(button as unknown as Control);
    // Focus was on the row's Edit button, now hidden: it goes to the next row once the panel, which
    // holds focus until it closes, has gone.
    const hand = (): void => {
      let next: HTMLElement | null = null;
      for (const side of ["nextElementSibling", "previousElementSibling"] as const) {
        for (let item = row[side]; item && !next; item = item[side])
          if (!item.hasAttribute("data-gone"))
            next = item.querySelector<HTMLElement>("button, input");
      }
      (next ?? document.getElementById("page-title"))?.focus({ preventScroll: true });
    };
    const panel = document.querySelector<HTMLDialogElement>("dialog.topics-panel");
    if (panel?.open) panel.addEventListener("close", hand, { once: true });
    else hand();
  };

  /** The sources the page lists, by their addresses, for the panel's suggestions to leave out. */
  const onPage = (): HeldSource[] =>
    [...root.querySelectorAll<HTMLElement>("[data-edit-source]")].flatMap((button) => {
      try {
        const { url } = JSON.parse(button.dataset.editSource ?? "{}") as { url?: string };
        return url ? [{ host: new URL(url).hostname, url }] : [];
      } catch {
        return [];
      }
    });

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
      module.openPanel(
        back,
        { addTopic, editTopic, addSource, editSource, removeSource, addSuggested, held: onPage },
        start,
      ),
    );
  };

  // -------------------------------------------------------------------------------- the events

  const toggle = (button: HTMLButtonElement): void => {
    const control = button as unknown as Control;
    const pressed = !held(control);
    control.dataset.pressed = String(pressed);
    const label = pressed ? control.dataset.labelUndo : control.dataset.label;
    if (label) control.setAttribute("aria-label", label);
    // A topic's own page shows it removed at once, before its request goes (D142).
    const topic =
      button.matches("[data-remove]") && !button.closest("li")
        ? button.closest<HTMLElement>("[data-topic]")
        : null;
    if (topic) {
      topic.toggleAttribute("data-gone", pressed);
      if (pressed) topic.querySelector<HTMLElement>(".topic-gone")?.focus({ preventScroll: true });
    }
    update(control);
  };

  /** A topic's Delete asks first (D103); Keep topic, the undo, goes straight through. */
  const confirmTopic = (button: HTMLButtonElement): void => {
    const dialog = root.querySelector<HTMLDialogElement>("[data-topic-confirm]");
    if (!dialog) {
      toggle(button);
      return;
    }
    dialog.returnValue = "";
    const onClick = (event: Event): void => {
      const choice = (event.target as Element).closest<HTMLButtonElement>("button");
      if (choice && "confirmCancel" in choice.dataset) dialog.close("cancel");
      else if (choice && "confirmDelete" in choice.dataset) dialog.close("delete");
    };
    dialog.addEventListener("click", onClick);
    dialog.addEventListener(
      "close",
      () => {
        dialog.removeEventListener("click", onClick);
        if (dialog.returnValue === "delete") toggle(button);
      },
      { once: true },
    );
    dialog.showModal();
  };

  const press = (button: HTMLButtonElement): void => {
    if (
      "addSource" in button.dataset ||
      "addTopic" in button.dataset ||
      "editSource" in button.dataset ||
      "editTopic" in button.dataset
    )
      openPanel(button);
    else if ("changeEmoji" in button.dataset) changeEmoji(button);
    else if ("suggestedAdd" in button.dataset) {
      const suggestion = parseSuggestedAdd(button.dataset.suggestedAdd);
      if (suggestion) addSuggested(button, suggestion);
    } else if (button.dataset.op) {
      if ("confirm" in button.dataset && button.dataset.pressed !== "true") confirmTopic(button);
      else toggle(button);
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
