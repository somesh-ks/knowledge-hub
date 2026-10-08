/**
 * The Topics and Sources pages' script. Both pages are whole static HTML; this records edits,
 * filters the source list and adds topics and sources to the pending changes. Sending them is
 * managePageSave.ts, loaded the first time Save is pressed. Nothing here imports at run time: the
 * first-load budget has almost no room left, so the markup carries what it can (each control holds
 * the edit it stands for in data-op) and the stylesheet does the rest.
 *
 * The pure parts are exported and tested; the rest is wiring.
 */
import type { ConfigOp } from "../types/contracts";
import type { Pending, SaveContext } from "./managePageSave";

/** A topic's id from its name: lowercase letters, digits and hyphens, unique among `taken`. */
export function slugify(name: string, taken: readonly string[]): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  const base = cleaned.length >= 2 ? cleaned : "topic";
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
}

/** Up to 12 distinct keywords from comma separated text. */
export function parseKeywords(text: string): string[] {
  const words = text
    .split(",")
    .map((word) => word.trim().slice(0, 40))
    .filter(Boolean);
  return [...new Set(words)].slice(0, 12);
}

/** A web address from what a person types: "example.com" is "https://example.com/". */
export function webAddress(text: string): string | null {
  const typed = text.trim();
  try {
    const url = new URL(typed.includes("://") ? typed : `https://${typed}`);
    return /^https?:$/.test(url.protocol) && url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

type Control = HTMLInputElement;

/** What a control holds now. A pressed button is a boolean, a slider a number. */
function held(control: Control): boolean | number {
  if (control.type === "range") return Number(control.value);
  return control.type === "checkbox"
    ? control.checked
    : control.getAttribute("aria-pressed") === "true";
}

/** The edit a control stands for: the op in its data-op, with its field set to what it holds. */
function editOf(control: Control): ConfigOp {
  const op = JSON.parse(control.dataset.op ?? "{}");
  const [outer = "", inner] = (control.dataset.field ?? "").split(".");
  if (inner) op[outer][inner] = held(control);
  else if (outer) op[outer] = held(control);
  return op;
}

function mount(root: HTMLElement): void {
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    root.querySelector(selector) as T;
  const bar = one("[data-bar]");
  const text = one("[data-bar-text]");
  const live = one("[data-live]");
  const queued = one("[data-queued]");
  const steps = (root.dataset.steps ?? "").split("|");
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

  /** Brings the row around a control into step with it, and records or drops its change. */
  const update = (control: Control): void => {
    if (control.type === "range") {
      const word = steps[Number(control.value) * 4] ?? "";
      control.style.setProperty("--range-fill", `${Number(control.value) * 100}%`);
      control.setAttribute("aria-valuetext", word);
      (control.nextElementSibling as HTMLElement).textContent = word;
    }
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
    dialog: one("dialog"),
  };

  // ------------------------------------------------------------------------------------ the rows

  const queue = (name: string, op: ConfigOp): void => {
    const template = one<HTMLTemplateElement>("template");
    const row = template.content.firstElementChild?.cloneNode(true) as HTMLElement;
    added += 1;
    row.dataset.key = `new${added}`;
    (row.querySelector("[data-q-name]") as HTMLElement).textContent = name;
    row.querySelector("button")?.setAttribute("aria-label", `Cancel adding ${name}`);
    queued.append(row);
    changes.set(row.dataset.key, { op, el: row, now: "" });
    refresh();
  };

  root.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement;
    // The passphrase dialog is a form too, and closes itself.
    if (form.method === "dialog") return;
    // The search field is a form, and Enter in it would reload the page.
    event.preventDefault();
    const data = new FormData(form);
    const value = (name: string): string => String(data.get(name) ?? "").trim();
    if (form.dataset.add === "topic") {
      const id = slugify(value("name"), taken);
      taken.push(id);
      queue(value("name"), {
        op: "topic.upsert",
        topic: {
          id,
          name: value("name"),
          description: value("description"),
          weight: 0.5,
          enabled: true,
          keywords: parseKeywords(value("keywords")),
          section_id: root.dataset.section ?? "tech",
        },
      });
    } else if (form.dataset.add === "source") {
      const url = webAddress(value("url"));
      const field = form.elements.namedItem("url") as Control;
      if (!url) {
        field.setCustomValidity("Enter a web address, like example.com.");
        field.reportValidity();
        return;
      }
      queue(new URL(url).hostname.replace(/^www\./, ""), { op: "source.add", url });
    } else return;
    form.reset();
  });

  root.addEventListener("input", (event) => {
    const control = event.target as Control;
    control.setCustomValidity("");
    if (control.matches("[data-op]")) update(control);
  });

  root.addEventListener("click", (event) => {
    const button = (event.target as Element).closest("button");
    if (!button) return;
    const act = button.dataset.act;
    const row = button.closest<HTMLElement>("li");
    if (act === "save") void import("./managePageSave").then((module) => module.save(context));
    else if (act === "close") context.dialog.close();
    else if (act === "dismiss") refresh();
    else if (act === "discard") location.reload();
    else if (act === "cancel" && row) {
      changes.delete(row.dataset.key ?? "");
      row.remove();
      refresh();
    } else if (button.dataset.op) {
      const control = button as unknown as Control;
      control.setAttribute("aria-pressed", String(!held(control)));
      update(control);
    }
  });

  // ---------------------------------------------------------------------------- finding sources

  const search = root.querySelector<Control>("[data-search]");
  if (search) {
    const rows = [...root.querySelectorAll<HTMLElement>("[data-find]")];
    const chips = [...root.querySelectorAll<HTMLButtonElement>("[data-filter]")];
    // The chips only name a filter; the stylesheet hides the rows it leaves out. The search hides by text.
    const apply = (): void => {
      for (const row of rows) {
        row.hidden = !(row.dataset.find ?? "").includes(search.value.trim().toLowerCase());
      }
      const shown = rows.filter((row) => row.offsetParent).length;
      one("[data-empty]").hidden = shown > 0;
      one("[data-status]").textContent = `${shown} ${shown === 1 ? "result" : "results"}`;
    };
    search.addEventListener("input", apply);
    for (const chip of chips) {
      chip.addEventListener("click", () => {
        root.dataset.filter = chip.dataset.filter;
        for (const other of chips) other.setAttribute("aria-pressed", String(other === chip));
        apply();
      });
    }
  }

  // Each control remembers how the page loaded, so putting it back drops the change.
  for (const control of root.querySelectorAll<Control>("[data-op]")) {
    control.dataset.was = String(held(control));
  }
  root.dataset.ready = "";
}

export function installManagePage(): void {
  const sync = (): void => {
    const root = document.querySelector<HTMLElement>("[data-manage]");
    if (root && root.dataset.ready === undefined) mount(root);
  };
  document.addEventListener("astro:page-load", sync);
  sync();
}
