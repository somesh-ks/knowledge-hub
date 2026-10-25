/**
 * The sheet that blocks sources: every source the catalogue knows, a search over them, and a field
 * that also takes a pasted address for a source it does not list. It is the page's template cloned
 * into a native modal dialog (the Topics panel's way, topicsPanel.ts); picks are collected and
 * handed back together when Block is pressed, and blockedPage.ts saves them.
 */
import { blockedDomainOf, customBlock, matchesQuery } from "../lib/blockedOutlets";
import { fitAboveKeyboard } from "./keyboardFit";
import { sheetGestures } from "./pullDismiss";

export interface BlockedSheet {
  /** The page's template of the sheet. */
  template: HTMLTemplateElement;
  /** What to type in the search field on opening. */
  query: string;
  /** The domains blocked now, which the sheet does not offer again. */
  blocked: () => ReadonlySet<string>;
  /** Called with the domains picked, once, when Block is pressed. */
  onBlock: (domains: string[]) => void;
  /** Gets focus back when the sheet closes. */
  trigger: HTMLElement | null;
}

export function openBlockedSheet(options: BlockedSheet): void {
  const clone = options.template.content.firstElementChild?.cloneNode(true);
  if (!(clone instanceof HTMLDialogElement)) return;
  const sheet = clone;
  // A sheet still sliding out goes now, so its field never shares an id with this one's.
  for (const old of document.querySelectorAll("dialog.blocked-sheet:not([open])")) old.remove();
  document.body.append(sheet);

  const one = <T extends Element>(selector: string): T => sheet.querySelector(selector) as T;
  const input = one<HTMLInputElement>("[data-sheet-input]");
  const error = one<HTMLElement>("[data-sheet-error]");
  const go = one<HTMLButtonElement>("[data-sheet-go]");
  const custom = one<HTMLElement>("[data-custom]");
  const rows = [...sheet.querySelectorAll<HTMLElement>("li[data-domain]")];
  const blocked = options.blocked();
  /** The domains picked, in the order they were. */
  const picked = new Set<string>();

  const say = (message: string): void => {
    const text = error.querySelector("span");
    if (text) text.textContent = message;
    error.hidden = message === "";
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };
  const mark = (row: HTMLElement): void => {
    const button = row.querySelector<HTMLButtonElement>("[data-pick]");
    const on = picked.has(row.dataset.domain ?? "");
    button?.classList.toggle("is-added", on);
    button?.setAttribute("aria-pressed", String(on));
  };
  const render = (): void => {
    const query = input.value;
    const typed = customBlock(query, blocked);
    // An address picked and then edited away is no longer in sight, so it is no longer picked.
    for (const domain of picked)
      if (domain !== typed && !rows.some((row) => row.dataset.domain === domain))
        picked.delete(domain);
    for (const row of rows) {
      const domain = row.dataset.domain ?? "";
      // Already blocked stays out. The picked stay in, so a pick can be taken back.
      row.hidden =
        blocked.has(domain) ||
        (!picked.has(domain) && !matchesQuery(row.dataset.search ?? "", query));
    }
    // An address that names no listed source is offered as it is.
    const known = typed !== null && rows.some((row) => row.dataset.domain === typed);
    const showCustom = typed !== null && !known;
    custom.hidden = !showCustom;
    if (showCustom) {
      custom.dataset.domain = typed;
      (custom.querySelector(".source-name") as HTMLElement).textContent = typed;
      (custom.querySelector(".source-initial") as HTMLElement).textContent = typed
        .charAt(0)
        .toUpperCase();
      custom.querySelector("[data-pick]")?.setAttribute("aria-label", `Block ${typed}`);
      mark(custom);
    }
    go.disabled = picked.size === 0;
    go.textContent = picked.size > 1 ? `Block ${picked.size} sources` : "Block";
  };
  const toggle = (row: HTMLElement): void => {
    const domain = row.dataset.domain;
    if (!domain) return;
    if (picked.has(domain)) picked.delete(domain);
    else picked.add(domain);
    say("");
    mark(row);
    render();
  };

  // A tile shows its icon once it has loaded, the letter until then (topics.css, .source-icon).
  for (const image of sheet.querySelectorAll<HTMLImageElement>("img[data-favicon]")) {
    const loaded = (): void => {
      if (image.naturalWidth > 0) image.dataset.loaded = "";
    };
    image.addEventListener("load", loaded);
    if (image.complete) loaded();
  }

  sheet.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-pick]");
    const row = button?.closest<HTMLElement>("li[data-domain]");
    if (row) toggle(row);
  });
  input.addEventListener("input", () => {
    say("");
    render();
  });
  // Enter picks what the typed address names, or the one source the search has left; with
  // something picked and the field empty it blocks.
  const confirm = (): void => {
    const query = input.value.trim();
    if (query === "") {
      if (!go.disabled) go.click();
      return;
    }
    const typed = blockedDomainOf(query);
    if (typed && picked.has(typed)) {
      go.click();
      return;
    }
    if (typed && blocked.has(typed)) {
      say(`${typed} is already blocked.`);
      return;
    }
    const open = [...rows, custom].filter(
      (row) => !row.hidden && !picked.has(row.dataset.domain ?? ""),
    );
    const target = typed
      ? open.find((row) => row.dataset.domain === typed)
      : open.length === 1
        ? open[0]
        : undefined;
    if (!target) {
      say(
        open.length === 0 && !typed
          ? "Enter a domain like example.com, or paste the address of a page on the source."
          : "Pick a source from the list.",
      );
      return;
    }
    toggle(target);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    confirm();
  });
  go.addEventListener("click", () => {
    if (picked.size === 0) return;
    options.onBlock([...picked]);
    sheet.close();
  });
  sheet.querySelector("[data-panel-close]")?.addEventListener("click", () => sheet.close());
  sheetGestures(sheet);
  const unfit = matchMedia("(width < 40rem)").matches ? fitAboveKeyboard(sheet) : () => {};

  // Browser Back closes the sheet and stays on the page; the sheet takes one history entry.
  let entry = true;
  const onBack = (event: Event): void => {
    if (!entry) return;
    entry = false;
    event.preventDefault();
    removeEventListener("singularity:back", onBack);
    if (sheet.open) sheet.close();
  };
  history.pushState({ ...history.state, blockedSheet: true }, "");
  addEventListener("singularity:back", onBack);
  sheet.addEventListener(
    "close",
    () => {
      unfit();
      if (options.trigger?.isConnected) options.trigger.focus();
      // It slides out as the Create panel does, then goes.
      const exits = sheet
        .getAnimations({ subtree: true })
        .filter((animation) => animation instanceof CSSTransition);
      void Promise.allSettled(exits.map((exit) => exit.finished)).then(() => sheet.remove());
      // Closed any other way: give the entry back. The pop this causes reaches onBack, which swallows it.
      if (entry) history.go(-1);
    },
    { once: true },
  );

  input.value = options.query;
  render();
  sheet.showModal();
  input.focus({ preventScroll: true });
}
