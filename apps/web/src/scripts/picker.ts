/**
 * A select with a search box. The page carries a plain select with `data-picker`; this hides it and
 * puts a button in its place that opens a list under a search field, as a time zone or a voice is
 * chosen from a long list. The select stays in the page and holds the value: a choice sets it and
 * fires its `change`, so whatever listens for a select (the settings editor, the Create form) hears
 * the choice as it always did, and the page works as it was while this has not loaded.
 *
 * The list is a popover, so it sits over everything, closes on Escape or a press outside, and works
 * inside a dialog. The search keeps every word of the query in any order (lib/pickerFilter.ts).
 * Loaded after the page is up (podcastPage.ts, createPage.ts), so it costs no first load.
 *
 * Options come from the select's own options when the list opens, so a list filled later (the
 * voices) needs no call: a script that changes the options or the value without a `change` sends
 * `picker:sync` to the select to bring the button's words up to date.
 */

import { iconClass } from "../design-system/icon";
import { ICON_PATHS, ICON_VIEW_BOX } from "../lib/icons";
import { matchesQuery, pickerCount, pickerNoMatch } from "../lib/pickerFilter";
import { FLOATING, roomFloor } from "../lib/roomFloor";
import { flagNode } from "../lib/voices";

const GAP_PX = 8;
const MIN_WIDTH_PX = 288;
const MAX_HEIGHT_PX = 384;
const MIN_ROOM_PX = 176;

let uid = 0;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

interface Choice {
  value: string;
  label: string;
  /** What the search also reads: a voice's accent, a zone's offset. */
  keywords: string;
  /** The region whose flag leads the words (a voice's accent), or "". */
  region: string;
  /**
   * A voice's drawn form (lib/voices.ts fillVoiceSelect): its name alone as the title, a line under
   * it, the words around a Default's title, and the voice whose sample the list's play control plays.
   * Absent on a list that is plain words (a time zone).
   */
  title: string;
  sub: string;
  lead: string;
  tail: string;
  sample: string;
}

/** A Phosphor glyph as an <svg>, for a control a script draws. */
function glyph(name: "playOutline" | "pause"): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", `${iconClass()} picker-${name === "pause" ? "pause" : "play-glyph"}`);
  svg.setAttribute("data-icon", name);
  svg.setAttribute("viewBox", ICON_VIEW_BOX);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", ICON_PATHS[name]);
  svg.append(path);
  return svg;
}

/**
 * The samples a voice list plays from its rows, one at a time across every list on the page. The
 * audio is built on the first press, so a page loads none up front; samples come through the site
 * (/api/voice-sample) because the page may play audio only from its own address and the Blob store.
 */
const audition = {
  audio: undefined as HTMLAudioElement | undefined,
  /** The control whose sample is playing: it shows pause until the sample ends or stops. */
  playing: null as HTMLElement | null,
  /** Counts the plays started, so a rejection of an earlier one (its source was replaced while it
   *  loaded) cannot clear the control of the sample that replaced it. */
  attempt: 0,
  /** The voice playing, so a redrawn list can find its new control. */
  sampleId: "",
  /** Says a failure to the list that started the sample (its live region). */
  tell: null as ((text: string) => void) | null,
  mark(control: HTMLElement | null): void {
    this.playing?.setAttribute("aria-pressed", "false");
    this.playing = control;
    control?.setAttribute("aria-pressed", "true");
  },
  toggle(control: HTMLElement, id: string, tell: (text: string) => void): void {
    const url = `/api/voice-sample?voice=${encodeURIComponent(id)}`;
    if (!this.audio) {
      const audio = new Audio();
      audio.addEventListener("pause", () => this.mark(null));
      audio.addEventListener("ended", () => this.mark(null));
      // A sample that cannot be played dims its control and says so, rather than failing in silence.
      audio.addEventListener("error", () => {
        if (this.playing) {
          this.playing.dataset.silent = "";
          this.tell?.("The sample could not be played");
        }
        this.mark(null);
      });
      this.audio = audio;
      // A sample stops when the page is left, by a link in the app (the page swaps in place, so the
      // audio would play on over the next one) or by closing or leaving the tab.
      document.addEventListener("astro:before-swap", () => this.stop());
      addEventListener("pagehide", () => this.stop());
      // A hidden tab (another tab, a locked phone) must not keep playing a sample nobody is choosing.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.stop();
      });
    }
    if (this.playing === control && !this.audio.paused) {
      // A stop settles a pending play() as a rejection; it is not a failure to announce.
      this.attempt += 1;
      this.audio.pause();
      return;
    }
    const attempt = ++this.attempt;
    this.sampleId = id;
    this.tell = tell;
    this.audio.src = url;
    this.mark(control);
    void this.audio.play().catch(() => {
      if (attempt !== this.attempt) return;
      this.tell?.("The sample could not be played");
      this.mark(null);
    });
  },
  stop(): void {
    this.attempt += 1;
    this.audio?.pause();
    this.mark(null);
  },
};

function mountPicker(select: HTMLSelectElement): void {
  const holder = select.parentElement;
  if (!holder || select.dataset.pickerReady !== undefined) return;
  select.dataset.pickerReady = "";
  const id = `picker-${++uid}`;
  const noun = select.dataset.picker || "option";
  const label = select.id
    ? document.querySelector<HTMLLabelElement>(`label[for="${select.id}"]`)
    : null;

  // The button takes the select's id, so its label points at it and a press on the label opens the list.
  const trigger = element("button", "picker-trigger");
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", `${id}-pop`);
  trigger.setAttribute("popovertarget", `${id}-pop`);
  const value = element("span", "picker-value");
  value.id = `${id}-value`;
  trigger.append(value);
  if (select.id) {
    trigger.id = select.id;
    select.id = `${select.id}-native`;
  }
  // The name: its label and the value, or the select's own aria-label, kept in step (the Create form
  // renames its voice selects once the hosts' names are known).
  const name = (): void => {
    const own = select.getAttribute("aria-label");
    if (own) {
      trigger.removeAttribute("aria-labelledby");
      trigger.setAttribute("aria-label", `${own}: ${value.textContent}`);
    } else if (label) {
      label.id ||= `${id}-label`;
      trigger.removeAttribute("aria-label");
      trigger.setAttribute("aria-labelledby", `${label.id} ${value.id}`);
    }
  };

  const pop = element("div", "picker-pop");
  pop.id = `${id}-pop`;
  pop.setAttribute("popover", "auto");
  pop.tabIndex = -1;
  const search = element("div", "picker-search");
  const glass = element("span", "picker-glass");
  glass.setAttribute("aria-hidden", "true");
  const input = element("input", "picker-input");
  input.type = "search";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", `${id}-list`);
  input.placeholder = `Search ${noun}s`;
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.enterKeyHint = "go";
  input.setAttribute("aria-label", `Search ${noun}s`);
  search.append(glass, input);
  const note = element("p", "picker-note");
  note.hidden = true;
  const list = element("div", "picker-list");
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");
  const count = element("p", "sr-only");
  count.setAttribute("aria-live", "polite");
  // A voice list is heard from the keyboard too: Shift+Enter plays the highlighted voice (a pointer
  // presses its Play control, which is not a tab stop; the search field keeps the focus).
  const hint = element("p", "sr-only", "Press Shift and Enter to hear the highlighted voice.");
  hint.id = `${id}-hint`;
  pop.append(search, note, list, count, hint);

  holder.classList.add("picker");
  select.classList.add("picker-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.before(trigger);
  holder.append(pop);

  let choices: Choice[] = [];
  let shown: Choice[] = [];
  let active = -1;

  const readChoices = (): Choice[] =>
    [...select.options].map((option) => ({
      value: option.value,
      label: option.textContent ?? "",
      keywords: option.dataset.keywords ?? "",
      region: option.dataset.region ?? "",
      title: option.dataset.title ?? "",
      sub: option.dataset.sub ?? "",
      lead: option.dataset.lead ?? "",
      tail: option.dataset.tail ?? "",
      sample: option.dataset.sample ?? "",
    }));

  /**
   * A voice's title as the words of the button and of a row: a Default's "Default (" flag name ")",
   * any other voice's flag and name. A list with no titles is its option's own words and flag.
   */
  const titleNodes = (choice: Choice): (Node | string)[] => {
    if (choice.title === "") {
      return [...(choice.region ? [flagNode(choice.region)] : []), choice.label];
    }
    if (choice.lead !== "") {
      return [
        choice.lead,
        ...(choice.region ? [flagNode(choice.region)] : []),
        `${choice.title}${choice.tail}`,
      ];
    }
    return [...(choice.region ? [flagNode(choice.region)] : []), choice.title];
  };

  const sync = (): void => {
    const chosen = select.selectedOptions[0];
    const current = chosen ? readChoices()[chosen.index] : undefined;
    value.replaceChildren(...(current ? titleNodes(current) : []));
    name();
  };

  const isOpen = (): boolean => pop.matches(":popover-open");

  const highlight = (index: number, block: ScrollLogicalPosition = "nearest"): void => {
    active = index;
    list.querySelectorAll<HTMLElement>("[role=option]").forEach((item, at) => {
      item.toggleAttribute("data-active", at === index);
    });
    const item = list.querySelectorAll<HTMLElement>("[role=option]")[index];
    if (item) {
      input.setAttribute("aria-activedescendant", item.id);
      // Only the list scrolls: scrollIntoView would move the page under it as well.
      const here = item.getBoundingClientRect();
      const frame = list.getBoundingClientRect();
      const top = here.top - frame.top + list.scrollTop;
      if (block === "center") list.scrollTop = top - (list.clientHeight - here.height) / 2;
      else if (top < list.scrollTop) list.scrollTop = top;
      else if (top + here.height > list.scrollTop + list.clientHeight)
        list.scrollTop = top + here.height - list.clientHeight;
    } else input.removeAttribute("aria-activedescendant");
  };

  /** Plays, or stops, the sample of a voice's Play control, and says so to a screen reader. */
  const hear = (play: HTMLElement): void => {
    const name = play.closest("[role=option]")?.querySelector(".picker-option-title")?.textContent;
    // The control is aria-hidden (an option's children are presentational), so its state is said here.
    if (!play.dataset.sample || play.hasAttribute("data-silent")) {
      count.textContent = `No sample for ${name ?? "this voice"}`;
      return;
    }
    const was = play.getAttribute("aria-pressed") === "true";
    audition.toggle(play, play.dataset.sample, (text) => {
      count.textContent = text;
    });
    count.textContent = `${was ? "Stopped" : "Playing"} ${name ?? "the sample"}`;
  };

  const draw = (query: string, from?: number): void => {
    shown = choices.filter((choice) => matchesQuery(`${choice.label} ${choice.keywords}`, query));
    list.replaceChildren(
      ...shown.map((choice, index) => {
        const item = element("div", "picker-option");
        item.id = `${id}-option-${index}`;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(choice.value === select.value));
        item.dataset.index = String(index);
        if (choice.title === "") {
          if (choice.region) item.append(flagNode(choice.region));
          item.append(element("span", "picker-option-name", choice.label));
          return item;
        }
        // A voice: a play control at the start, then its title with the gender and accent under it.
        // The check at the end is drawn by CSS on the chosen row.
        item.classList.add("picker-option-voice");
        const play = element("span", "picker-play");
        play.setAttribute("aria-hidden", "true");
        play.setAttribute("aria-pressed", "false");
        // Not aria-disabled: the page's disabledGuard would swallow the press before it said why.
        if (choice.sample === "") play.dataset.silent = "";
        else play.dataset.sample = choice.sample;
        play.append(glyph("playOutline"), glyph("pause"));
        const words = element("span", "picker-option-name");
        const title = element("span", "picker-option-title");
        title.append(...titleNodes(choice));
        words.append(title);
        if (choice.sub !== "") words.append(element("span", "picker-option-sub", choice.sub));
        item.append(play, words);
        return item;
      }),
    );
    // A search redraws the rows: the playing voice keeps its pressed control if it is still listed,
    // and stops if it is not, so no sample plays on with nothing to stop it.
    if (audition.playing && !audition.playing.isConnected) {
      const again = list.querySelector<HTMLElement>(
        `.picker-play[data-sample="${CSS.escape(audition.sampleId)}"]`,
      );
      if (again) audition.mark(again);
      else audition.stop();
    }
    if (shown.length === 0) list.append(element("p", "picker-empty", pickerNoMatch(query, noun)));
    count.textContent = pickerCount(shown.length, noun);
    if (shown.some((choice) => choice.title !== "")) {
      input.setAttribute("aria-describedby", hint.id);
      input.setAttribute("aria-keyshortcuts", "Shift+Enter");
    } else {
      input.removeAttribute("aria-describedby");
      input.removeAttribute("aria-keyshortcuts");
    }
    const start =
      from ??
      (query.trim() === "" ? shown.findIndex((choice) => choice.value === select.value) : 0);
    highlight(shown.length === 0 ? -1 : Math.max(start, 0));
  };

  /** Under the button, as wide as the room asks, and above it when the room below is short. */
  const place = (): void => {
    const field = trigger.getBoundingClientRect();
    // On a phone the list is a bottom sheet (picker.css, [data-sheet]): the screen places it, so
    // the measurements below are not applied, and what an earlier width set is cleared.
    if (matchMedia("(width < 40rem)").matches) {
      pop.dataset.sheet = "";
      pop.removeAttribute("style");
      return;
    }
    delete pop.dataset.sheet;
    const wide = field.width >= MIN_WIDTH_PX;
    const width = Math.min(wide ? field.width : MIN_WIDTH_PX, window.innerWidth - GAP_PX * 2);
    // A value at the end of a row opens its list toward the start of the row, as a native one does.
    const left = wide ? field.left : field.right - width;
    const placedLeft = Math.max(GAP_PX, Math.min(left, window.innerWidth - width - GAP_PX));
    pop.style.width = `${width}px`;
    pop.style.left = `${placedLeft}px`;
    const covers = [...document.querySelectorAll<HTMLElement>(FLOATING)].map((node) =>
      node.getBoundingClientRect(),
    );
    const below = roomFloor(field, covers, window.innerHeight) - field.bottom - GAP_PX * 2;
    const above = field.top - GAP_PX * 2;
    const wants = Math.min(pop.scrollHeight, MAX_HEIGHT_PX);
    const flip = below < wants && above > below;
    const room = Math.max(Math.min(flip ? above : below, MAX_HEIGHT_PX), MIN_ROOM_PX);
    pop.style.maxHeight = `${room}px`;
    pop.dataset.side = flip ? "above" : "below";
    // It grows from the button: the origin is the button's centre, on the edge that faces it.
    pop.style.transformOrigin = `${Math.round(field.left + field.width / 2 - placedLeft)}px ${flip ? "100%" : "0"}`;
    pop.style.top = flip
      ? `${Math.max(GAP_PX, field.top - GAP_PX - Math.min(pop.offsetHeight, room))}px`
      : `${field.bottom + GAP_PX}px`;
  };

  /** Whether the list was opened from the keyboard: only then does its current row show a ring. */
  let viaKey = false;

  const close = (): void => {
    if (isOpen()) pop.hidePopover();
  };

  const choose = (choice: Choice): void => {
    const changed = select.value !== choice.value;
    select.value = choice.value;
    sync();
    // The row now reads as the chosen one, so the press that chose it sounds as a choice.
    for (const item of list.querySelectorAll<HTMLElement>("[role=option]")) {
      item.setAttribute("aria-selected", String(shown[Number(item.dataset.index)] === choice));
    }
    close();
    trigger.focus({ preventScroll: true });
    // The change a select makes: a script that edits the choices in the page listens for it.
    if (changed) {
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  // The button opens and closes the popover itself (popovertarget), so its own press never closes the
  // list and opens it again. The rows are drawn before the list shows and placed as it does.
  pop.addEventListener("beforetoggle", (event) => {
    if ((event as ToggleEvent).newState !== "open") return;
    // Hidden until it is placed, so it never shows for a frame where it was last time.
    delete pop.dataset.placed;
    choices = readChoices();
    note.hidden = !select.dataset.note;
    note.textContent = select.dataset.note ?? "";
    input.value = "";
    list.toggleAttribute("data-keyboard", viaKey);
    draw("");
  });
  pop.addEventListener("toggle", (event) => {
    const opening = (event as ToggleEvent).newState === "open";
    trigger.setAttribute("aria-expanded", String(opening));
    if (opening) {
      place();
      pop.dataset.placed = "";
      // The chosen row comes into the middle of a long list, not to its foot.
      highlight(active, "center");
      // A finger keeps the list in view: the keyboard that a focused field brings up would cover it.
      if (viaKey || !matchMedia("(pointer: coarse)").matches) input.focus({ preventScroll: true });
      // With a finger the keyboard would cover the list, so the search is left to a tap; focus still
      // goes into the list, for a screen reader that follows it there.
      else pop.focus({ preventScroll: true });
      return;
    }
    // A sample heard from the list stops with it.
    audition.stop();
    if (document.activeElement === document.body || pop.contains(document.activeElement))
      trigger.focus({ preventScroll: true });
  });

  trigger.addEventListener("pointerdown", () => {
    viaKey = false;
  });
  trigger.addEventListener("keydown", (event) => {
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) viaKey = true;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !isOpen()) {
      event.preventDefault();
      pop.showPopover();
    }
  });

  input.addEventListener("input", () => draw(input.value));
  input.addEventListener("keydown", (event) => {
    const { key } = event;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      list.toggleAttribute("data-keyboard", true);
      if (shown.length === 0) return;
      const next =
        key === "ArrowDown"
          ? active >= shown.length - 1
            ? 0
            : active + 1
          : active <= 0
            ? shown.length - 1
            : active - 1;
      highlight(next);
    } else if (key === "Enter" && event.shiftKey) {
      event.preventDefault();
      const play = document.querySelector<HTMLElement>(`#${id}-option-${active} .picker-play`);
      if (play) hear(play);
    } else if (key === "Enter") {
      event.preventDefault();
      const choice = shown[active];
      if (choice) choose(choice);
    } else if (key === "Escape") {
      // A search field clears itself on Escape and leaves the list open; here Escape closes the list,
      // as it does everywhere else, whatever is typed.
      event.preventDefault();
      close();
    } else if (key === "Tab") {
      close();
    }
  });
  // The pointer takes over from the keyboard: the hover tint shows the row, the ring goes.
  list.addEventListener("pointermove", () => list.removeAttribute("data-keyboard"));
  list.addEventListener("click", (event) => {
    // A voice's play control hears its sample and leaves the list open and the choice as it was.
    const play = (event.target as Element).closest<HTMLElement>(".picker-play");
    if (play) {
      hear(play);
      return;
    }
    const item = (event.target as Element).closest<HTMLElement>("[role=option]");
    const choice = item ? shown[Number(item.dataset.index)] : undefined;
    if (choice) choose(choice);
  });
  // Pressing a row must not take the focus off the search first, or a touch scroll would blur it.
  list.addEventListener("pointerdown", (event) => event.preventDefault());

  window.addEventListener("resize", () => {
    if (isOpen()) place();
  });
  // The list is placed under its button once. A scroll of the page or the sheet carries the button
  // away from it, so it closes then, as the speed panel does; the list's own scroll is its own.
  document.addEventListener(
    "scroll",
    (event) => {
      if (isOpen() && !pop.contains(event.target as Node)) close();
    },
    { capture: true, passive: true },
  );
  // Shown rows follow the list when the page changes it (the voices arrive after the page).
  const refresh = (): void => {
    sync();
    if (isOpen()) {
      choices = readChoices();
      draw(input.value);
    }
  };
  select.addEventListener("picker:sync", refresh);
  select.addEventListener("change", sync);
  new MutationObserver(refresh).observe(select, {
    childList: true,
    attributes: true,
    attributeFilter: ["aria-label"],
  });

  sync();
}

/**
 * Turns every select marked `data-picker` under the root into a searchable list, and marks the root
 * (`data-pickers`) once they are, so a test, or a script, knows the buttons are there.
 */
export function mountPickers(root: ParentNode = document): void {
  for (const select of root.querySelectorAll<HTMLSelectElement>("select[data-picker]")) {
    mountPicker(select);
  }
  if (root instanceof HTMLElement) root.dataset.pickers = "";
}
