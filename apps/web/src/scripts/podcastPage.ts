/**
 * The editor of the podcast settings, loaded by podcastEntry.ts. Each page is static HTML with the
 * saved values written in: a profile page (Daily, Weekly). This records what the controls add up
 * to: one schedule.set (every field that changed). autosave.ts sends it a moment later through
 * managePageSave.ts, the step the Topics page uses.
 */
import { hasSaved, storeOn } from "../lib/savedKey";
import type { ConfigOp } from "../types/contracts";
import { mountAutosave } from "./autosave";
import type { Pending } from "./managePageSave";
import type { FieldValues, scheduleOp as ScheduleOp } from "./podcastProfiles";

export { roomFloor } from "../lib/roomFloor";

/**
 * Mounts the editor on whichever settings page holds it: a profile page (Daily, Weekly) has
 * schedule fields. podcastEntry.ts loads this file after the page's first script, so it does not
 * count against the first-load budget. A change is recorded here and sent by autosave.ts a moment later.
 */
export async function mount(root: HTMLElement): Promise<void> {
  const box = root.querySelector<HTMLElement>("[data-panel]") ?? root;
  const controls = root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-f]");
  const changes = new Map<string, Pending>();
  /** The diff, from the profiles script, which loads right after the page is up. */
  let ops: typeof ScheduleOp | undefined;

  /** What the schedule controls hold: the page's starting point and the test for "changed". */
  const fields = (): FieldValues => {
    const out: FieldValues = {};
    for (const control of controls) {
      const key = control.dataset.f ?? "";
      if (control instanceof HTMLInputElement && control.type === "radio") {
        out[key] ??= "";
        if (control.checked) out[key] = control.value;
      } else if (control instanceof HTMLInputElement) out[key] = String(control.checked);
      else out[key] = control.value;
    }
    return out;
  };

  // An edit saved in the last few minutes is not in this page until the next build: the controls
  // show it before they are read as the starting point below, so it is not sent again.
  // With the config store on (D149), what it holds is laid over them the same way, first.
  let saved: ConfigOp[] = [];
  if (hasSaved() || storeOn()) {
    const view = await import("./savedView").catch(() => null);
    if (storeOn()) await view?.loadStore();
    saved = view?.readSaved() ?? [];
    view?.overlayPodcast(root, controls, fields(), saved);
  }

  /** The topic chips: each puts the topics it stands for in or out of this podcast (topic.scope). */
  // A chip of a topic removed since the build is gone (savedView.ts): it neither counts nor sends.
  const scopeBoxes = [...root.querySelectorAll<HTMLInputElement>("input[data-scope]")].filter(
    (box) => box.dataset.gone === undefined,
  );
  for (const box of scopeBoxes) box.dataset.was = String(box.checked);
  const scopeChanges = (): void => {
    for (const box of scopeBoxes) {
      const profile = box.dataset.scope === "weekly" ? "weekly" : "daily";
      const ids = (box.dataset.scopeIds ?? "").split(" ").filter(Boolean);
      const key = `scope:${profile}:${ids.join(",")}`;
      if (ids.length === 0 || String(box.checked) === box.dataset.was) changes.delete(key);
      else
        changes.set(key, {
          op: { op: "topic.scope", ids, [profile]: box.checked },
          el: box,
          now: String(box.checked),
        });
    }
  };

  /** Topic chips all off: the episode has nothing to cover, which the hint under them says. */
  const noTopics = root.querySelector<HTMLElement>("[data-no-topics]");
  const showNoTopics = (): void => {
    if (noTopics) noTopics.hidden = scopeBoxes.some((box) => box.checked);
  };

  /** Records what the controls now differ by. `save` is false while a typed id is still being typed. */
  const update = (save = true): void => {
    scopeChanges();
    showNoTopics();
    const now = fields();
    const op = ops?.(JSON.parse(box.dataset.was ?? "{}") as FieldValues, now);
    if (op) changes.set("schedule", { op, el: box, now: JSON.stringify(now) });
    else changes.delete("schedule");
    if (save) autosave.changed();
  };

  const autosave = mountAutosave(root, changes, () => update(false));

  root.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-profile]")) update();
  });

  box.dataset.was = JSON.stringify(fields());
  showNoTopics();
  if (root.querySelector("[data-profile]")) {
    void import("./podcastProfiles").then((module) => {
      ops = module.scheduleOp;
      module.mountProfiles(root, () => update(false));
    });
    // The time zone and the voices are chosen from a list with a search field.
    void import("./picker").then((module) => module.mountPickers(root));
  }
  root.dataset.ready = "";
}
