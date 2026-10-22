/**
 * The Settings index with an edit saved since the build: each row's line says what the page behind
 * it now holds, not what it held when the site was built (lib/savedOverlay.ts says what was saved,
 * lib/settingsSummary.ts words it as the build does). Loaded by settingsPage.ts only when something
 * saved is kept, so the index's first load never carries it.
 */

import { storeOn } from "../lib/savedKey";
import {
  type FieldValues,
  type SourceSpot,
  savedFields,
  savedSources,
  savedTopicCount,
  sourceCounts,
} from "../lib/savedOverlay";
import { dailySummary, topicsSummary, voicesSummary, weeklySummary } from "../lib/settingsSummary";
import type { ConfigOp } from "../types/contracts";
import { dropUnclaimed, HELD_EVENT, type Held } from "./managePageSave";
import { loadStore, readSaved } from "./savedView";

/** Said on the index when a change held by a page left for it could not be saved. */
export const LOST_NOTE = "Your last change was not saved.";

/**
 * The rows with what was saved since the build (and, with the config store on, what it holds), and
 * following a left page's run still on its way.
 */
export async function showSaved(root: HTMLElement): Promise<void> {
  // Listening first: a left page's run can end while the store is asked.
  followHeld(root);
  if (storeOn()) await loadStore();
  overlayIndex(root, readSaved());
}

/**
 * The index open while a left page's run ends: the rows say what is saved now. Nothing here can take
 * a change that failed (the index has no toast), so it is dropped, and the page says so.
 */
function followHeld(root: HTMLElement): void {
  const off = new AbortController();
  document.addEventListener(
    HELD_EVENT,
    (event) => {
      if (!root.isConnected) return off.abort();
      if (!(event as CustomEvent<Held>).detail.ok) {
        dropUnclaimed();
        if (!root.querySelector("[data-lost]")) {
          const note = document.createElement("p");
          note.className = "settings-note";
          note.dataset.lost = "";
          note.setAttribute("role", "alert");
          note.textContent = LOST_NOTE;
          root.querySelector("#page-title")?.after(note);
        }
      }
      overlayIndex(root, readSaved());
    },
    { signal: off.signal },
  );
  document.addEventListener("astro:after-swap", () => off.abort(), { signal: off.signal });
}

const row = (root: ParentNode, name: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-summary="${name}"]`);

function say(target: HTMLElement | null, text: string): boolean {
  const hint = target?.querySelector("[data-hint]");
  if (!hint || hint.textContent === text) return false;
  hint.textContent = text;
  return true;
}

/** Each row's line with the saved edits laid over what it was built from. True when one changed. */
export function overlayIndex(root: ParentNode, ops: readonly ConfigOp[]): boolean {
  const daily = row(root, "daily");
  const weekly = row(root, "weekly");
  const voice = row(root, "voice");
  // The shared voices are top-level fields of schedule.set, which savedFields files under "daily".
  const baked: FieldValues = {
    "daily.voice": voice?.dataset.voice ?? "",
    "daily.voice_b": voice?.dataset.voiceB ?? "",
    "daily.hour": daily?.dataset.hour ?? "",
    "daily.cadence": daily?.dataset.cadence ?? "",
    "daily.timezone": daily?.dataset.timezone ?? "",
    "weekly.day": weekly?.dataset.day ?? "",
    "weekly.hour": weekly?.dataset.hour ?? "",
    "weekly.timezone": weekly?.dataset.timezone ?? "",
  };
  const now = { ...baked, ...savedFields(baked, ops) };
  let shown = false;
  if (daily)
    shown =
      say(
        daily,
        dailySummary({
          hour: Number(now["daily.hour"]),
          cadenceDays: Number(now["daily.cadence"]),
          timezone: now["daily.timezone"],
        }),
      ) || shown;
  if (weekly)
    shown =
      say(
        weekly,
        weeklySummary({
          day: Number(now["weekly.day"]),
          hour: Number(now["weekly.hour"]),
          timezone: now["weekly.timezone"],
        }),
      ) || shown;
  if (voice)
    shown =
      say(voice, voicesSummary(now["daily.voice"] ?? "", now["daily.voice_b"] ?? "")) || shown;

  const topics = row(root, "topics");
  if (topics) {
    const words = (value: string | undefined): string[] => (value ?? "").split(" ").filter(Boolean);
    let base: Record<string, SourceSpot> = {};
    try {
      base = JSON.parse(topics.dataset.sources ?? "{}");
    } catch {
      base = {};
    }
    // A source moved since the build is filed under the topic it moved to: that topic's page.
    const spots = savedSources(base, ops, (id) => id ?? "");
    const count = savedTopicCount(words(topics.dataset.shown), words(topics.dataset.taken), ops);
    shown = say(topics, topicsSummary(count, sourceCounts(spots).total)) || shown;
  }

  return shown;
}
