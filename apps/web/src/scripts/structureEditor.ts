/**
 * The Structure view on the Preferences page (D170, docs/design/podcast-structure.md "The screen"):
 * a tab for each podcast kind, its blocks as rows, Add and Reorder under them. A row moves by its
 * dots (Move up, Move down) or, once Reorder is pressed, by its grip (pulled with a finger or a mouse,
 * or the arrow keys), and Edit opens the
 * block's sheet: its depth, its stories, how many may come from one source (a rule code holds it
 * to), a close's length, an owner block's title and brief, and, closed
 * under Writing instructions, the block's prompt in this kind (D182). Every change saves
 * itself as the topics editor's do (autosave.ts, D115): a kind's blocks go as one structure.set and a
 * prompt as one structure.prompt; a removal leaves at once and waits with Undo (D142).
 *
 * Loaded by topicsPage.ts when the view first shows, after the store and this device's saved edits
 * have been read, so the list starts from what is saved, not from the build.
 */
import type { StructureBlock, StructureKind } from "@singularity/core";
import { hasSaved, storeOn } from "../lib/savedKey";
import {
  addOffers,
  blockName,
  builtinPrompt,
  fitLine,
  insertAt,
  isFrame,
  isStoryBlock,
  KIND_LABEL,
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
import { mountSegmentedNav, selectTab } from "./segmentedNav";

const KINDS: readonly StructureKind[] = ["daily", "weekly", "catch_up"];

/**
 * A kind as one of the literals, never the address's or a control's own text, so nothing typed
 * into the URL or the page reaches the rows' markup.
 */
const kindOf = (value: string | null): StructureKind =>
  value === "weekly" ? "weekly" : value === "catch_up" ? "catch_up" : "daily";

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
  kind: StructureKind;
  block: StructureBlock;
  index: number;
}

export async function mountStructure(root: HTMLElement, pane: HTMLElement): Promise<void> {
  if (pane.dataset.mounted !== undefined) return;
  pane.dataset.mounted = "";
  const data = JSON.parse(pane.dataset.structure ?? "null") as StructureData | null;
  const list = pane.querySelector<HTMLOListElement>("[data-structure-list]");
  const addButton = pane.querySelector<HTMLButtonElement>(".structure-add > .btn-secondary");
  const addItems = pane.querySelector<HTMLElement>("#structure-add-menu .menu-sheet-items");
  const fit = root.querySelector<HTMLElement>("[data-structure-fit]");
  const live = root.querySelector<HTMLElement>("[data-live]");
  if (!data || !list || !addButton || !addItems) return;

  // What the store holds and this device saved since the build, laid over what the page was built with.
  const ops: ConfigOp[] =
    hasSaved() || storeOn()
      ? await import("./savedView").then((module) => module.readSaved()).catch(() => [])
      : [];
  const blocks = {} as Record<StructureKind, StructureBlock[]>;
  const prompts = {} as Record<StructureKind, Record<string, string>>;
  for (const kind of KINDS) {
    blocks[kind] = data.blocks[kind].map(normal);
    prompts[kind] = { ...data.prompts[kind] };
  }
  for (const op of ops) {
    if (op.op === "structure.set") blocks[op.kind] = (op.blocks as StructureBlock[]).map(normal);
    if (op.op === "structure.prompt") {
      if (op.prompt === null) delete prompts[op.kind][op.key];
      else prompts[op.kind][op.key] = op.prompt;
    }
  }
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
  const savedBlocks = Object.fromEntries(
    KINDS.map((kind) => [kind, JSON.stringify(blocks[kind])]),
  ) as Record<StructureKind, string>;
  const recordBlocks = (kind: StructureKind): void =>
    record(`structure:${kind}`, savedBlocks[kind], JSON.stringify(blocks[kind]), {
      op: "structure.set",
      kind,
      blocks: structuredClone(blocks[kind]),
    });
  const savedPrompts = structuredClone(prompts);
  const recordPrompt = (kind: StructureKind, key: string): void => {
    const now = prompts[kind][key] ?? null;
    record(`prompt:${kind}:${key}`, savedPrompts[kind][key] ?? "", now ?? "", {
      op: "structure.prompt",
      kind,
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
      removals = removals.filter((removal) => changes.has(`structure:${removal.kind}`));
    },
    {
      removing() {
        const waiting = removals.filter((removal) => changes.has(`structure:${removal.kind}`));
        if (waiting.length === 0) return null;
        return waiting.length === 1
          ? `Removing ${blockName(waiting[0]?.block as StructureBlock, data.sections)}`
          : `Removing ${waiting.length} blocks`;
      },
      undo() {
        const back = removals.reverse();
        removals = [];
        for (const { kind: from, block, index } of back) {
          const kept = blocks[from];
          if (kept.some((each) => same(each, block))) continue;
          kept.splice(Math.min(Math.max(index, 1), kept.length - 1), 0, block);
          recordBlocks(from);
        }
        render();
        say("Put back.");
        autosave.changed();
      },
    },
  );

  // ------------------------------------------------------------------------------- drawing

  const chosen = new URLSearchParams(location.search).get("kind");
  let kind: StructureKind = kindOf(chosen);
  const kindTabs = pane.querySelector<HTMLElement>(".structure-kinds");
  const panel = pane.querySelector<HTMLElement>("[data-structure-panel]");
  if (kindTabs) selectTab(kindTabs, kind);

  const say = (message: string): void => {
    if (live) live.textContent = message;
  };

  /** Draws the kind's rows, its Add list and the line under the card; focus goes to `focus`'s row. */
  const render = (focus?: { index: number; part: "more" | "edit" | "grip" }): void => {
    const rows = blocks[kind];
    list.innerHTML = rowsHtml(kind, rows, data, skip);
    list.setAttribute("aria-label", `${KIND_LABEL[kind]} blocks`);
    panel?.setAttribute("aria-labelledby", `structure-kind-${kind}`);
    if (fit) fit.textContent = fitLine(kind, rows, data.sections, skip);
    const offers = addOffers(kind, rows, data.sections);
    addItems.replaceChildren(
      ...offers.map((offer) => {
        const button = document.createElement("button");
        button.className = "hero-menu-item";
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.dataset.add = offer.key;
        button.textContent = offer.name;
        return button;
      }),
    );
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

  const bodyCount = (): number => blocks[kind].length - 2;

  /** `part` takes focus after the move; a pointer's drop leaves focus where it was (null). */
  const move = (from: number, to: number, part: "more" | "grip" | null = "more"): void => {
    const next = moved(blocks[kind], from, to);
    if (JSON.stringify(next) === JSON.stringify(blocks[kind])) return;
    const block = blocks[kind][from] as StructureBlock;
    blocks[kind] = next;
    recordBlocks(kind);
    render(part === null ? undefined : { index: to, part });
    say(`${blockName(block, data.sections)}, ${to} of ${bodyCount()}`);
    autosave.changed();
  };

  const remove = (index: number): void => {
    const block = blocks[kind][index];
    if (!block || isFrame(block) || bodyCount() <= 1) return;
    removals.push({ kind, block, index });
    blocks[kind] = blocks[kind].filter((_, at) => at !== index);
    recordBlocks(kind);
    render({ index: Math.min(index, blocks[kind].length - 2), part: "more" });
    autosave.changed();
  };

  const add = (block: StructureBlock): void => {
    const at = insertAt(blocks[kind], block);
    blocks[kind] = [...blocks[kind].slice(0, at), block, ...blocks[kind].slice(at)];
    recordBlocks(kind);
    render({ index: at, part: "more" });
    say(`${blockName(block, data.sections)} added, ${at} of ${bodyCount()}`);
    autosave.changed();
  };

  // The kind's tabs keep their choice in the address (?kind=, segmentedNav.ts), so a reload finds it.
  if (kindTabs)
    mountSegmentedNav(kindTabs, (value) => {
      kind = kindOf(value);
      render();
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
    const offer = button.dataset.add;
    if (offer !== undefined) {
      button.closest<HTMLElement>("[popover]")?.hidePopover();
      if (offer === "custom") {
        openSheet(null, addButton);
        return;
      }
      const block = addOffers(kind, blocks[kind], data.sections).find(
        (each) => each.key === offer,
      )?.block;
      if (block) add(block);
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
    const editing = kind;
    const adding = index === null;
    const block: StructureBlock = adding
      ? { type: "custom", title: "", brief: "" }
      : (blocks[editing][index] as StructureBlock);
    const one = <T extends Element>(selector: string): T => sheet.querySelector(selector) as T;
    const part = (name: string, shown: boolean): void => {
      const el = sheet.querySelector<HTMLElement>(`[data-part="${name}"]`);
      if (el) el.hidden = !shown;
    };
    const builtin = builtinPrompt(data, editing, block);
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
      prompt.value = prompts[editing][key] ?? builtin;
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
      const op = { op: "structure.prompt", kind: editing, key, prompt: text };
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
      const kindBlocks = blocks[editing];
      if (adding) {
        at = insertAt(kindBlocks, next);
        blocks[editing] = [...kindBlocks.slice(0, at), next, ...kindBlocks.slice(at)];
        recordBlocks(editing);
        changed = true;
        say(`${blockName(next, data.sections)} added, ${at} of ${blocks[editing].length - 2}`);
      } else if (!same(next, block)) {
        blocks[editing] = kindBlocks.map((each, position) => (position === at ? next : each));
        recordBlocks(editing);
        changed = true;
      }
      const text = promptNow();
      if (builtin !== null && text !== (prompts[editing][key] ?? null)) {
        if (text === null) delete prompts[editing][key];
        else prompts[editing][key] = text;
        recordPrompt(editing, key);
        changed = true;
      }
      if (changed) {
        if (editing === kind) render();
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
        const row =
          focusAt >= 0 && editing === kind ? list.querySelector(`[data-index="${focusAt}"]`) : null;
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
