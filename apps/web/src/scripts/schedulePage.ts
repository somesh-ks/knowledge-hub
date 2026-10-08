/**
 * The Schedule page's script. The page is static HTML with the saved values written in; this
 * records the one change the controls add up to and shows it in the shared bar. Sending it is
 * managePageSave.ts, loaded the first time Save is pressed, the same step the Topics page uses.
 *
 * Nothing here imports at run time: it is only the wiring around the markup.
 */
import type { ConfigOp } from "../types/contracts";
import type { Pending, SaveContext } from "./managePageSave";

type Cadence = 1 | 2 | 3 | 7;

/**
 * The edit the controls stand for, or null when no topic is ticked. Every topic ticked is "all
 * enabled topics" (null), so a topic added later is covered without another visit here.
 */
export function scheduleOp(
  hour: number,
  cadence: number,
  covers: readonly { value: string; checked: boolean }[],
): ConfigOp | null {
  const chosen = covers.filter((cover) => cover.checked).map((cover) => cover.value);
  if (chosen.length === 0) return null;
  return {
    op: "schedule.set",
    hour,
    cadence_days: cadence as Cadence,
    sections: chosen.length === covers.length ? null : chosen,
  };
}

function mount(root: HTMLElement): void {
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    root.querySelector(selector) as T;
  const bar = one("[data-bar]");
  const text = one("[data-bar-text]");
  const live = one("[data-live]");
  const panel = one("[data-panel]");
  const hour = one<HTMLSelectElement>("#schedule-hour");
  const cadence = one<HTMLSelectElement>("#schedule-cadence");
  const covers = [...root.querySelectorAll<HTMLInputElement>('input[name="cover"]')];
  const changes = new Map<string, Pending>();

  const show = (message: string, state: string): void => {
    text.textContent = message;
    live.textContent = message;
    bar.dataset.state = state;
    bar.hidden = false;
    root.setAttribute("data-pending", "");
  };
  const hide = (): void => {
    bar.hidden = true;
    root.removeAttribute("data-pending");
  };

  /** What the controls hold, as text: the page's starting point and the test for "changed". */
  const state = (): string =>
    JSON.stringify([hour.value, cadence.value, ...covers.map((cover) => cover.checked)]);

  const update = (): void => {
    delete root.dataset.nothing;
    if (state() === panel.dataset.was) {
      changes.delete("schedule");
      hide();
      return;
    }
    const op = scheduleOp(
      Number(hour.value),
      Number(cadence.value),
      covers.map((cover) => ({ value: cover.value, checked: cover.checked })),
    );
    if (op === null) {
      // Nothing to cover would mean no briefing at all, so it is never sent.
      changes.delete("schedule");
      root.dataset.nothing = "";
      show("Pick at least one topic.", "error");
      return;
    }
    changes.set("schedule", { op, el: panel, now: state() });
    show("1 change", "idle");
  };

  const context: SaveContext = {
    changes,
    show,
    fields: one("[data-fields]"),
    dialog: one("dialog"),
  };

  root.addEventListener("change", (event) => {
    if ((event.target as HTMLElement).closest("[data-panel]")) update();
  });

  root.addEventListener("click", (event) => {
    const button = (event.target as Element).closest("button");
    const act = button?.dataset.act;
    if (act === "save") void import("./managePageSave").then((module) => module.save(context));
    else if (act === "close") context.dialog.close();
    else if (act === "dismiss") hide();
    else if (act === "discard") location.reload();
  });

  panel.dataset.was = state();
  root.dataset.ready = "";
}

export function installSchedulePage(): void {
  const sync = (): void => {
    const root = document.querySelector<HTMLElement>("[data-manage=schedule]");
    if (root && root.dataset.ready === undefined) mount(root);
  };
  document.addEventListener("astro:page-load", sync);
  sync();
}
