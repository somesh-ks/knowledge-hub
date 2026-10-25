/**
 * The Blocked outlets page. The field filters the list of those blocked; Block (or Enter when the
 * filter finds nothing) opens the sheet of known sources (blockedSheet.ts), which also takes a pasted
 * address. A domain picked is normalised as the server does (lib/blockedOutlets.ts), listed at once and saved a moment later as profile.block; a removal waits
 * five seconds with Undo in the toast, then goes as profile.unblock (autosave.ts). The list is the
 * one built into the page with the edits saved since laid over it, so it is right before the next
 * build (lib/savedOverlay.ts).
 */
import { filterBlocked, outletsSummary, savedBlocked } from "../lib/blockedOutlets";
import { hasSaved, SAVED_KEY, storeOn } from "../lib/savedKey";
import { parseSaved, withStore } from "../lib/savedOverlay";
import type { ConfigReadBody } from "../types/contracts";
import { mountAutosave } from "./autosave";
import type { Pending } from "./managePageSave";

/**
 * The edits saved in the last few minutes, oldest first, after what the config store holds when it
 * is on (D149); none when storage is refused.
 */
function readSaved(store: ConfigReadBody | null = null) {
  try {
    return withStore(parseSaved(localStorage.getItem(SAVED_KEY), Date.now()), store, Date.now());
  } catch {
    return store?.ops ?? [];
  }
}

function mount(root: HTMLElement): void {
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    root.querySelector(selector) as T;
  const list = one("[data-list]");
  const input = one<HTMLInputElement>("[data-input]");
  const form = one<HTMLFormElement>("[data-add]");
  const count = one("[data-count]");
  const nomatch = one("[data-nomatch]");
  /** Each pending change by `block:domain` or `unblock:domain`. */
  const changes = new Map<string, Pending>();

  const rows = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>(".blocked-row")];
  /** A row that is listed: not waiting to be removed, not removed. */
  const shown = (row: HTMLElement): boolean => !row.matches("[data-removing], [data-gone]");
  const rowOf = (domain: string): HTMLElement | undefined =>
    rows().find((row) => row.dataset.domain === domain);
  const recount = (): void => {
    count.textContent = outletsSummary(rows().filter(shown).length);
    filter();
  };
  /** Rows the filter leaves are listed; the others wait hidden (blocked.css). */
  const filter = (): void => {
    const left = new Set(
      filterBlocked(
        rows().map((row) => row.dataset.domain ?? ""),
        input.value,
      ),
    );
    for (const row of rows())
      row.toggleAttribute("data-filtered", !left.has(row.dataset.domain ?? ""));
    nomatch.hidden =
      input.value.trim() === "" ||
      rows().some((row) => shown(row) && !row.hasAttribute("data-filtered"));
  };

  const removals = (): string[] =>
    [...changes.entries()]
      .filter(([key]) => key.startsWith("unblock:"))
      .map(([key]) => key.slice("unblock:".length));
  const autosave = mountAutosave(root, changes, () => {}, {
    removing() {
      const names = removals();
      if (names.length === 0) return null;
      return names.length === 1 ? `Removing ${names[0]}` : `Removing ${names.length} sources`;
    },
    undo() {
      for (const domain of removals()) {
        changes.delete(`unblock:${domain}`);
        rowOf(domain)?.removeAttribute("data-removing");
      }
      recount();
      autosave.changed();
    },
  });

  /** A row for a domain added on this page, in the list's order. */
  const insert = (domain: string): HTMLElement => {
    const row = one<HTMLTemplateElement>("template[data-row]").content.firstElementChild?.cloneNode(
      true,
    ) as HTMLElement;
    row.dataset.domain = domain;
    (row.querySelector(".settings-label") as HTMLElement).textContent = domain;
    row.querySelector("button")?.setAttribute("aria-label", `Unblock ${domain}`);
    const after = rows().find((existing) => (existing.dataset.domain ?? "") > domain);
    if (after) after.before(row);
    else list.append(row);
    return row;
  };

  // Edits saved since the build: the list as it will be, shown now. With the config store on (D149),
  // again once it answers with what it holds; a domain changed here meanwhile keeps this page's change.
  const built = rows().map((row) => row.dataset.domain ?? "");
  const showSaved = (store: ConfigReadBody | null): void => {
    const will = savedBlocked(built, readSaved(store));
    const mine = (domain: string): boolean =>
      changes.has(`block:${domain}`) || changes.has(`unblock:${domain}`);
    for (const row of rows()) {
      const domain = row.dataset.domain ?? "";
      if (!will.includes(domain) && !mine(domain)) row.remove();
    }
    for (const domain of will) if (!rowOf(domain) && !mine(domain)) insert(domain);
    recount();
  };
  if (hasSaved()) showSaved(null);
  if (storeOn()) {
    void import("./configStoreRead")
      .then((module) => module.loadStore())
      .then((store) => {
        if (store && root.isConnected) showSaved(store);
      })
      .catch(() => {});
  }

  const add = (domain: string): void => {
    const waiting = changes.get(`unblock:${domain}`);
    const row = rowOf(domain);
    if (waiting && row) {
      // Removed a moment ago and blocked again: nothing needs to go.
      changes.delete(`unblock:${domain}`);
      row.removeAttribute("data-removing");
    } else if (!row || !shown(row)) {
      const made = row ?? insert(domain);
      // A row whose removal was saved keeps data-removing (settle adds data-gone): both go.
      made.removeAttribute("data-gone");
      made.removeAttribute("data-removing");
      changes.set(`block:${domain}`, {
        op: { op: "profile.block", domain },
        el: made.querySelector<HTMLElement>(".settings-label") as HTMLElement,
        now: "1",
      });
    }
    recount();
    autosave.changed();
  };

  const remove = (button: HTMLButtonElement): void => {
    const row = button.closest<HTMLElement>(".blocked-row");
    const domain = row?.dataset.domain;
    if (!row || !domain) return;
    // The row is about to leave the list, so focus moves to the next row's control, else the one
    // before, else the field (the toast's Undo is a Tab away).
    const near = (from: Element | null, next: boolean): HTMLElement | null => {
      for (
        let each = from;
        each;
        each = next ? each.nextElementSibling : each.previousElementSibling
      )
        if (each instanceof HTMLElement && shown(each)) return each.querySelector("button");
      return null;
    };
    const target =
      near(row.nextElementSibling, true) ?? near(row.previousElementSibling, false) ?? input;
    if (changes.has(`block:${domain}`)) {
      // Added and not sent yet: taking it back leaves nothing to send.
      changes.delete(`block:${domain}`);
      row.remove();
    } else {
      row.setAttribute("data-removing", "");
      changes.set(`unblock:${domain}`, {
        op: { op: "profile.unblock", domain },
        el: button,
        now: "1",
      });
    }
    target.focus({ preventScroll: true });
    recount();
    autosave.changed();
  };

  const openSheet = (trigger: HTMLElement | null): void => {
    const template = one<HTMLTemplateElement>("template[data-sheet]");
    void import("./blockedSheet").then((sheet) =>
      sheet.openBlockedSheet({
        template,
        query: input.value,
        trigger,
        blocked: () =>
          new Set(
            rows()
              .filter(shown)
              .map((row) => row.dataset.domain ?? ""),
          ),
        onBlock(domains) {
          for (const domain of domains) add(domain);
          input.value = "";
          clear.hidden = true;
          filter();
        },
      }),
    );
  };
  form.addEventListener("submit", (event) => event.preventDefault());
  form
    .querySelector("button")
    ?.addEventListener("click", (event) => openSheet(event.currentTarget as HTMLElement));
  // Enter blocks only when the filter found nothing to look at.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !nomatch.hidden) openSheet(input);
  });
  const clear = one<HTMLButtonElement>("[data-clear]");
  input.addEventListener("input", () => {
    clear.hidden = input.value === "";
    filter();
  });
  clear.addEventListener("click", () => {
    input.value = "";
    clear.hidden = true;
    filter();
    input.focus();
  });
  list.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-remove]");
    if (button) remove(button);
  });

  recount();
  root.dataset.ready = "";
}

export function installBlockedPage(): void {
  const sync = (): void => {
    const root = document.querySelector<HTMLElement>("[data-blocked]");
    if (root && root.dataset.ready === undefined) mount(root);
  };
  document.addEventListener("astro:page-load", sync);
  sync();
}
