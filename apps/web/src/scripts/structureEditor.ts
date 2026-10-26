/**
 * The Structure view on the Preferences page (D170, docs/design/podcast-structure.md "The screen"):
 * the listener profile's select, the one list of blocks as rows, Add and Reorder under them. A row moves by its
 * dots (Move up, Move down) or, once Reorder is pressed, by its grip (pulled with a finger or a mouse,
 * or the arrow keys), and Edit opens the
 * block's sheet: its depth, its stories, how many may come from one source (a rule code holds it
 * to), a close's length, an owner block's title and brief, and, closed
 * under Writing instructions, the block's prompt (D182). Every change saves
 * itself as the topics editor's do (autosave.ts, D115): the profile and blocks go as one structure.set and a
 * prompt as one structure.prompt; a removal leaves at once and waits with Undo (D142).
 *
 * Loaded by topicsPage.ts when the view first shows, after the store and this device's saved edits
 * have been read, so the list starts from what is saved, not from the build.
 */
import type { NamedProfile, StructureBlock, StructureProfile } from "@singularity/core";
import { hasSaved, storeOn } from "../lib/savedKey";
import {
  addOffers,
  blockName,
  builtinPrompt,
  insertAt,
  isFrame,
  isStoryBlock,
  moved,
  promptKey,
  rowsHtml,
  type SkipLists,
  STORIES_MAX,
  type StructureData,
  skipAfter,
  storiesOf,
  withRule,
  withStories,
} from "../lib/structureView";
import type { ConfigOp } from "../types/contracts";
import { mountAutosave } from "./autosave";
import { fitAboveKeyboard } from "./keyboardFit";
import { MAX_BODY_CHARS, type Pending } from "./managePageSave";
import { sheetGestures } from "./pullDismiss";

/** A block as the page holds it, with the defaults a stored op may leave out filled in. */
function normal(block: StructureBlock): StructureBlock {
  if (block.type === "section" || block.type === "top_picks")
    return { ...block, depth: block.depth ?? (block.type === "section" ? "brief" : "deep") };
  if (block.type === "close") return { ...block, length: block.length ?? "short" };
  return { ...block };
}

/** A block's fields in one order, so a field set and cleared again reads as no change. */
const canonical = (block: StructureBlock): string =>
  JSON.stringify(Object.fromEntries(Object.entries(block).sort(([a], [b]) => (a < b ? -1 : 1))));

const same = (a: StructureBlock, b: StructureBlock): boolean => canonical(a) === canonical(b);

interface Removal {
  block: StructureBlock;
  index: number;
}

export async function mountStructure(root: HTMLElement, pane: HTMLElement): Promise<void> {
  if (pane.dataset.mounted !== undefined) return;
  pane.dataset.mounted = "";
  const data = JSON.parse(pane.dataset.structure ?? "null") as StructureData | null;
  const list = pane.querySelector<HTMLOListElement>("[data-structure-list]");
  const addButton = pane.querySelector<HTMLButtonElement>(".structure-add > .btn-secondary");
  const profileSelect = pane.querySelector<HTMLSelectElement>("#structure-profile");
  const confirm = pane.querySelector<HTMLElement>("[data-profile-confirm]");
  const live = root.querySelector<HTMLElement>("[data-live]");
  if (!data || !list || !addButton || !profileSelect || !confirm) return;

  // What the store holds and this device saved since the build, laid over what the page was built with.
  const ops: ConfigOp[] =
    hasSaved() || storeOn()
      ? await import("./savedView").then((module) => module.readSaved()).catch(() => [])
      : [];
  let profile: StructureProfile = data.profile;
  let blocks = data.blocks.map(normal);
  const prompts: Record<string, string> = { ...data.prompts };
  for (const op of ops) {
    if (op.op === "structure.set") {
      profile = op.profile;
      blocks = (op.blocks as StructureBlock[]).map(normal);
    }
    if (op.op === "structure.prompt") {
      if (op.prompt === null) delete prompts[op.key];
      else prompts[op.key] = op.prompt;
    }
  }
  profileSelect.value = profile;
  const skip: SkipLists = skipAfter(data.skip, ops);

  // ------------------------------------------------------------------------------- recording

  const changes = new Map<string, Pending>();
  /** One element per pending key: what it was last saved as is its data-was (settle, managePageSave.ts). */
  const markers = new Map<string, HTMLElement>();
  const marker = (key: string, was: string): HTMLElement => {
    let el = markers.get(key);
    if (!el) {
      el = document.createElement("span");
      el.dataset.was = was;
      markers.set(key, el);
    }
    return el;
  };
  const record = (key: string, was: string, now: string, op: ConfigOp): void => {
    const el = marker(key, was);
    if (now === el.dataset.was) changes.delete(key);
    else changes.set(key, { op, el, now });
  };
  const stateOf = (): string => JSON.stringify({ profile, blocks });
  const savedBlocks = stateOf();
  const recordBlocks = (): void =>
    record("structure", savedBlocks, stateOf(), {
      op: "structure.set",
      profile,
      blocks: structuredClone(blocks),
    });
  /** An edit of the list, or of its order, is the owner's own list: the select says Custom. */
  const editedList = (): void => {
    profile = "custom";
    profileSelect.value = "custom";
    confirm.hidden = true;
    recordBlocks();
  };
  const savedPrompts = structuredClone(prompts);
  const recordPrompt = (key: string): void => {
    const now = prompts[key] ?? null;
    record(`prompt:${key}`, savedPrompts[key] ?? "", now ?? "", {
      op: "structure.prompt",
      key,
      prompt: now,
    });
  };

  let removals: Removal[] = [];
  const autosave = mountAutosave(
    root,
    changes,
    () => {
      // A removal sent is no longer one to undo.
      removals = removals.filter(() => changes.has("structure"));
    },
    {
      removing() {
        const waiting = removals.filter(() => changes.has("structure"));
        if (waiting.length === 0) return null;
        return waiting.length === 1
          ? `Removing ${blockName(waiting[0]?.block as StructureBlock, data.sections)}`
          : `Removing ${waiting.length} blocks`;
      },
      undo() {
        const back = removals.reverse();
        removals = [];
        for (const { block, index } of back) {
          if (blocks.some((each) => same(each, block))) continue;
          blocks.splice(Math.min(Math.max(index, 1), blocks.length - 1), 0, block);
          editedList();
        }
        render();
        say("Put back.");
        autosave.changed();
      },
    },
  );

  // ------------------------------------------------------------------------------- drawing

  const say = (message: string): void => {
    if (live) live.textContent = message;
  };

  /** Draws the rows and its Add list; focus goes to `focus`'s row. */
  const render = (focus?: { index: number; part: "more" | "edit" | "grip" }): void => {
    const rows = blocks;
    list.innerHTML = rowsHtml(rows, data, skip);
    const offers = addOffers(rows, data.sections);
    addButton.disabled = offers.length === 0;
    if (!focus) return;
    const row = list.querySelector<HTMLElement>(`[data-index="${focus.index}"]`);
    const target =
      row?.querySelector<HTMLElement>(
        focus.part === "edit"
          ? ".structure-edit"
          : focus.part === "grip"
            ? "[data-grip]"
            : ".structure-more",
      ) ??
      row?.querySelector<HTMLElement>("button") ??
      addButton;
    target.focus({ preventScroll: true });
  };
  render();

  // ------------------------------------------------------------------------------- changes

  const bodyCount = (): number => blocks.length - 2;

  /** `part` takes focus after the move; a pointer's drop leaves focus where it was (null). */
  const move = (from: number, to: number, part: "more" | "grip" | null = "more"): void => {
    const next = moved(blocks, from, to);
    if (JSON.stringify(next) === JSON.stringify(blocks)) return;
    const block = blocks[from] as StructureBlock;
    blocks = next;
    editedList();
    render(part === null ? undefined : { index: to, part });
    say(`${blockName(block, data.sections)}, ${to} of ${bodyCount()}`);
    autosave.changed();
  };

  const remove = (index: number): void => {
    const block = blocks[index];
    if (!block || isFrame(block) || bodyCount() <= 1) return;
    removals.push({ block, index });
    blocks = blocks.filter((_, at) => at !== index);
    editedList();
    render({ index: Math.min(index, blocks.length - 2), part: "more" });
    autosave.changed();
  };

  const add = (block: StructureBlock): number => {
    const at = insertAt(blocks, block);
    blocks = [...blocks.slice(0, at), block, ...blocks.slice(at)];
    editedList();
    render({ index: at, part: "more" });
    say(`${blockName(block, data.sections)} added, ${at} of ${bodyCount()}`);
    autosave.changed();
    return at;
  };

  // A named profile replaces the list with its preset; the owner's own list is only given up after
  // asking, in the page (no window.confirm). Custom keeps the list as it stands.
  let asked: NamedProfile | null = null;
  const label = (id: string): string =>
    profileSelect.querySelector(`option[value="${id}"]`)?.textContent ?? id;
  const chooseProfile = (next: StructureProfile): void => {
    profile = next;
    if (next !== "custom") blocks = data.presets[next].map(normal);
    profileSelect.value = next;
    confirm.hidden = true;
    asked = null;
    recordBlocks();
    render();
    say(`${label(next)} profile.`);
    autosave.changed();
  };
  profileSelect.addEventListener("change", () => {
    const chosen = profileSelect.value as StructureProfile;
    if (chosen === profile) return;
    if (chosen === "custom" || profile !== "custom") {
      chooseProfile(chosen);
      return;
    }
    asked = chosen;
    profileSelect.value = profile;
    const text = confirm.querySelector("[data-profile-confirm-text]");
    if (text) text.textContent = `Replace your list with the ${label(chosen)} profile?`;
    confirm.hidden = false;
    confirm.querySelector<HTMLElement>("[data-profile-replace]")?.focus({ preventScroll: true });
  });
  confirm.querySelector("[data-profile-replace]")?.addEventListener("click", () => {
    if (asked !== null) chooseProfile(asked);
  });
  confirm.querySelector("[data-profile-keep]")?.addEventListener("click", () => {
    asked = null;
    confirm.hidden = true;
    profileSelect.focus({ preventScroll: true });
  });

  // Reorder shows the grips and hides the dots and Add; Done puts them back. Outside it a row has
  // no handle, so nothing a finger does by chance moves a block (owner, 2026-10-24).
  // Two buttons, one shown at a time: the floating one below 64rem and the one by the tabs above.
  const reorders = root.querySelectorAll<HTMLButtonElement>("[data-reorder]");
  for (const reorder of reorders)
    reorder.addEventListener("click", () => {
      const on = pane.dataset.reordering === undefined;
      if (on) pane.dataset.reordering = "";
      else delete pane.dataset.reordering;
      root.toggleAttribute("data-reordering", on);
      for (const each of reorders) {
        if (each.hasAttribute("aria-label")) each.ariaLabel = on ? "Done" : "Reorder";
        const label = each.querySelector("[data-reorder-label]");
        if (label) label.textContent = on ? "Done" : "Reorder";
      }
      say(on ? "Reorder on. Drag a block by its handle, or use the arrow keys." : "Reorder off.");
    });

  pane.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button === addButton) {
      // No selection step: the first block not yet in the list goes to the bottom and its sheet opens
      // at once; when every kind is in, the owner's own block starts empty.
      const block = addOffers(blocks, data.sections).find((each) => each.block !== null)?.block;
      if (!block) openSheet(null, addButton);
      else openSheet(add(block), addButton);
      return;
    }
    const act = button.dataset.act;
    const row = button.closest<HTMLElement>("[data-index]");
    if (!act || !row) return;
    const index = Number(row.dataset.index);
    button.closest<HTMLElement>("[popover]")?.hidePopover();
    if (act === "up") move(index, index - 1);
    else if (act === "down") move(index, index + 1);
    else if (act === "remove") remove(index);
    else if (act === "edit")
      openSheet(index, row.querySelector(".structure-more, .structure-edit"));
  });

  // ------------------------------------------------------------------------------- the grip

  // A body row moves by its grip: pressed and pulled (a finger or a mouse, by pointer events, so a
  // phone drags as a desktop does), the row follows and the rows it passes step aside to show where
  // it lands; Up and Down on the focused grip move it one place. The frames never move.
  const EDGE_PX = 64;
  const STEP_PX = 8;
  interface Drag {
    pointerId: number;
    row: HTMLElement;
    from: number;
    to: number;
    startY: number;
    startScroll: number;
    y: number;
    /** Each body row's middle when the drag began, in page coordinates. */
    middles: { row: HTMLElement; index: number; middle: number }[];
    height: number;
    frame: number;
  }
  let drag: Drag | null = null;

  const placeDrag = (): void => {
    if (!drag) return;
    const shift = drag.y - drag.startY + (window.scrollY - drag.startScroll);
    drag.row.style.translate = `0 ${shift}px`;
    const own = drag.middles.find((each) => each.row === drag?.row);
    const middle = (own?.middle ?? 0) + shift;
    let to = drag.from;
    for (const each of drag.middles) {
      if (each.index < drag.from && middle < each.middle) to = Math.min(to, each.index);
      if (each.index > drag.from && middle > each.middle) to = Math.max(to, each.index);
    }
    drag.to = to;
    for (const each of drag.middles) {
      if (each.row === drag.row) continue;
      const step =
        drag.from < to && each.index > drag.from && each.index <= to
          ? -drag.height
          : to < drag.from && each.index >= to && each.index < drag.from
            ? drag.height
            : 0;
      each.row.style.translate = step === 0 ? "" : `0 ${step}px`;
    }
  };

  /** Near the top or the bottom of the screen, the page scrolls under the held row. */
  const scrollEdge = (): void => {
    if (!drag) return;
    const down = drag.y > window.innerHeight - EDGE_PX;
    const up = drag.y < EDGE_PX;
    if (up || down) {
      window.scrollBy(0, down ? STEP_PX : -STEP_PX);
      placeDrag();
    }
    drag.frame = requestAnimationFrame(scrollEdge);
  };

  const endDrag = (commit: boolean): void => {
    if (!drag) return;
    const { from, to, row, frame } = drag;
    cancelAnimationFrame(frame);
    drag = null;
    list.removeAttribute("data-dragging");
    row.removeAttribute("data-dragging");
    for (const each of list.querySelectorAll<HTMLElement>(".structure-row"))
      each.style.translate = "";
    if (commit && to !== from) move(from, to, null);
  };

  list.addEventListener("pointerdown", (event) => {
    const grip = (event.target as Element).closest<HTMLElement>("[data-grip]");
    const row = grip?.closest<HTMLElement>("[data-index]");
    if (!grip || !row || !event.isPrimary || event.button !== 0 || drag) return;
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    const rows = [...list.querySelectorAll<HTMLElement>(".structure-row:not([data-frame])")];
    const box = row.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      row,
      from: Number(row.dataset.index),
      to: Number(row.dataset.index),
      startY: event.clientY,
      startScroll: window.scrollY,
      y: event.clientY,
      middles: rows.map((each) => {
        const rect = each.getBoundingClientRect();
        return {
          row: each,
          index: Number(each.dataset.index),
          middle: rect.top + rect.height / 2,
        };
      }),
      height: box.height,
      frame: 0,
    };
    list.dataset.dragging = "";
    row.dataset.dragging = "";
    drag.frame = requestAnimationFrame(scrollEdge);
  });
  list.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.y = event.clientY;
    placeDrag();
  });
  list.addEventListener("pointerup", (event) => {
    if (drag && event.pointerId === drag.pointerId) endDrag(true);
  });
  list.addEventListener("pointercancel", (event) => {
    if (drag && event.pointerId === drag.pointerId) endDrag(false);
  });
  list.addEventListener("keydown", (event) => {
    const grip = (event.target as Element).closest<HTMLElement>("[data-grip]");
    const row = grip?.closest<HTMLElement>("[data-index]");
    if (!grip || !row) return;
    if (event.key === "Escape" && drag) {
      event.preventDefault();
      endDrag(false);
      return;
    }
    const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = Number(row.dataset.index);
    move(index, index + step, "grip");
  });

  // ------------------------------------------------------------------------------- the Edit sheet

  /** Opens the sheet for the block at `index`, or for a new block of the owner's own (null). */
  const openSheet = (index: number | null, trigger: HTMLElement | null): void => {
    const template = document.querySelector<HTMLTemplateElement>("#structure-sheet-template");
    const sheet = template?.content.firstElementChild?.cloneNode(true) as HTMLDialogElement | null;
    if (!sheet) return;
    const adding = index === null;
    const block: StructureBlock = adding
      ? { type: "custom", title: "", brief: "" }
      : (blocks[index] as StructureBlock);
    const one = <T extends Element>(selector: string): T => sheet.querySelector(selector) as T;
    const part = (name: string, shown: boolean): void => {
      const el = sheet.querySelector<HTMLElement>(`[data-part="${name}"]`);
      if (el) el.hidden = !shown;
    };
    const builtin = builtinPrompt(data, block);
    const key = promptKey(block);
    const stories = storiesOf(block);
    one<HTMLElement>("[data-sheet-title]").textContent = adding
      ? "Your own block"
      : blockName(block, data.sections);
    part("title", block.type === "custom");
    part("brief", block.type === "custom");
    part("depth", block.type === "section" || block.type === "top_picks");
    part("length", block.type === "close");
    part("stories", stories !== undefined);
    part("per-source", isStoryBlock(block));
    part("rules", stories !== undefined);
    part("prompt", builtin !== null);
    part("spoken", block.type !== "custom" && builtin === null);
    part("own", block.type === "custom");
    if (adding) one<HTMLButtonElement>("[data-sheet-done]").textContent = "Add";

    const title = one<HTMLInputElement>('input[name="title"]');
    const brief = one<HTMLTextAreaElement>('textarea[name="brief"]');
    const storiesSelect = one<HTMLSelectElement>('select[name="stories"]');
    const perSource = one<HTMLSelectElement>('select[name="per_source"]');
    const prompt = one<HTMLTextAreaElement>('textarea[name="prompt"]');
    const count = one<HTMLElement>("[data-count]");
    if (block.type === "custom") {
      title.value = block.title;
      brief.value = block.brief;
    }
    const check = (name: string, value: string): void => {
      const input = sheet.querySelector<HTMLInputElement>(
        `input[name="${name}"][value="${value}"]`,
      );
      if (input) input.checked = true;
    };
    if (block.type === "section" || block.type === "top_picks") check("depth", block.depth);
    if (block.type === "close") check("length", block.length);
    // Each a number to read, or Auto for the app's own.
    if (stories !== undefined) {
      const most = STORIES_MAX[block.type] ?? 8;
      for (let count = 1; count <= most; count += 1)
        storiesSelect.add(new Option(String(count), String(count)));
      storiesSelect.value = stories === null ? "" : String(stories);
    }
    if (isStoryBlock(block))
      perSource.value = block.per_source === undefined ? "" : String(block.per_source);
    const state = one<HTMLElement>("[data-prompt-state]");
    const counted = (): void => {
      count.textContent = `${prompt.value.length} of ${prompt.maxLength} characters`;
      state.textContent =
        builtin !== null && prompt.value.trim() !== builtin.trim() ? "Your own" : "Built-in";
    };
    if (builtin !== null) {
      prompt.maxLength = 6000;
      prompt.value = prompts[key] ?? builtin;
      counted();
      prompt.addEventListener("input", counted);
      one<HTMLButtonElement>("[data-reset]").addEventListener("click", () => {
        prompt.value = builtin;
        counted();
        prompt.focus();
      });
    }

    const error = (name: string, on: boolean): void => {
      const message = sheet.querySelector<HTMLElement>(`[data-error="${name}"]`);
      if (message) message.hidden = !on;
    };
    /** The block as the sheet now holds it, or null when an owner's block lacks its words. */
    const edited = (): StructureBlock | null => {
      let next: StructureBlock = { ...block };
      if (next.type === "custom") {
        const words = { title: title.value.trim(), brief: brief.value.trim() };
        error("title", words.title === "");
        error("brief", words.brief === "");
        if (words.title === "" || words.brief === "") return null;
        next = { ...next, ...words };
      }
      const value = (name: string): string | undefined =>
        sheet.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
      if (next.type === "section" || next.type === "top_picks")
        next = { ...next, depth: value("depth") === "brief" ? "brief" : "deep" };
      if (next.type === "close")
        next = { ...next, length: value("length") === "long" ? "long" : "short" };
      const number = (select: HTMLSelectElement): number | null =>
        select.value === "" ? null : Number(select.value);
      if (stories !== undefined) next = withStories(next, number(storiesSelect));
      if (isStoryBlock(next)) next = withRule(next, "per_source", number(perSource));
      return next;
    };
    /** The prompt to keep: null for the built-in one (also when cleared or typed back to it). */
    const promptNow = (): string | null => {
      const text = prompt.value.trim();
      return builtin === null || text === "" || text === builtin.trim() ? null : text;
    };
    const fitsOneRequest = (): boolean => {
      const text = promptNow();
      const op = { op: "structure.prompt", key, prompt: text };
      const fits = text === null || JSON.stringify({ op }).length <= MAX_BODY_CHARS;
      error("prompt", !fits);
      // The message is inside the closed section: open it, so it is seen.
      if (!fits) one<HTMLDetailsElement>("details").open = true;
      return fits;
    };

    let done = false;
    /** Takes what the sheet holds: one structure.set for the block, one structure.prompt for its prompt. */
    const apply = (): boolean => {
      const next = edited();
      if (next === null || !fitsOneRequest()) return false;
      done = true;
      let at = index ?? -1;
      let changed = false;
      const current = blocks;
      if (adding) {
        at = insertAt(current, next);
        blocks = [...current.slice(0, at), next, ...current.slice(at)];
        editedList();
        changed = true;
        say(`${blockName(next, data.sections)} added, ${at} of ${blocks.length - 2}`);
      } else if (!same(next, block)) {
        blocks = current.map((each, position) => (position === at ? next : each));
        editedList();
        changed = true;
      }
      const text = promptNow();
      if (builtin !== null && text !== (prompts[key] ?? null)) {
        if (text === null) delete prompts[key];
        else prompts[key] = text;
        recordPrompt(key);
        changed = true;
      }
      if (changed) {
        render();
        autosave.changed();
      }
      focusAt = at;
      return true;
    };
    let focusAt = index ?? -1;

    one<HTMLButtonElement>("[data-sheet-done]").addEventListener("click", () => {
      if (apply()) sheet.close();
    });
    sheet.querySelector("[data-panel-close]")?.addEventListener("click", () => sheet.close());
    sheet.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());
    sheetGestures(sheet);
    const unfit = matchMedia("(width < 40rem)").matches ? fitAboveKeyboard(sheet) : () => {};

    // Browser Back closes the sheet and stays on the page, as it closes the Topics panel.
    let entry = true;
    const onBack = (event: Event): void => {
      if (!entry) return;
      entry = false;
      event.preventDefault();
      removeEventListener("singularity:back", onBack);
      if (sheet.open) sheet.close();
    };
    history.pushState({ ...history.state, structureSheet: true }, "");
    addEventListener("singularity:back", onBack);
    sheet.addEventListener(
      "close",
      () => {
        // Closed by its Close, a pull, Escape or Back: an edit keeps what it holds, as every setting
        // does; a new block of the owner's own is only added by Add.
        if (!done && !adding) apply();
        unfit();
        removeEventListener("singularity:back", onBack);
        const row = focusAt >= 0 ? list.querySelector(`[data-index="${focusAt}"]`) : null;
        const back =
          row?.querySelector<HTMLElement>(".structure-more, .structure-edit") ??
          (trigger?.isConnected ? trigger : addButton);
        back.focus({ preventScroll: true });
        const exits = sheet
          .getAnimations({ subtree: true })
          .filter((animation) => animation instanceof CSSTransition);
        void Promise.allSettled(exits.map((exit) => exit.finished)).then(() => sheet.remove());
        if (entry) history.go(-1);
      },
      { once: true },
    );
    document.body.append(sheet);
    sheet.showModal();
    if (adding) title.focus({ preventScroll: true });
  };
}
