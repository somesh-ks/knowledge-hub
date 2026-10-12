/**
 * The Settings index with an edit saved since the build: each row's line says what the page behind
 * it now holds, not what it held when the site was built (lib/savedOverlay.ts says what was saved,
 * lib/settingsSummary.ts words it as the build does). Loaded by settingsPage.ts only when something
 * saved is kept, so the index's first load never carries it.
 */
import type { StoredWriterChoice } from "../lib/pendingWriter";
import {
  type FieldValues,
  type SourceSpot,
  savedFields,
  savedSources,
  savedTopicCount,
  sourceCounts,
} from "../lib/savedOverlay";
import { dailySummary, modelSummary, topicsSummary, weeklySummary } from "../lib/settingsSummary";
import type { ConfigOp } from "../types/contracts";

const row = (root: ParentNode, name: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-summary="${name}"]`);

function say(target: HTMLElement | null, text: string): boolean {
  const hint = target?.querySelector("[data-hint]");
  if (!hint || hint.textContent === text) return false;
  hint.textContent = text;
  return true;
}

/** Each row's line with the saved edits laid over what it was built from. True when one changed. */
export function overlayIndex(
  root: ParentNode,
  ops: readonly ConfigOp[],
  pending: StoredWriterChoice | null,
): boolean {
  const daily = row(root, "daily");
  const weekly = row(root, "weekly");
  const baked: FieldValues = {
    "daily.hour": daily?.dataset.hour ?? "",
    "daily.cadence": daily?.dataset.cadence ?? "",
    "weekly.enabled": weekly?.dataset.enabled ?? "",
    "weekly.day": weekly?.dataset.day ?? "",
    "weekly.hour": weekly?.dataset.hour ?? "",
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
        }),
      ) || shown;
  if (weekly)
    shown =
      say(
        weekly,
        weeklySummary({
          enabled: now["weekly.enabled"] === "true",
          day: Number(now["weekly.day"]),
          hour: Number(now["weekly.hour"]),
        }),
      ) || shown;

  const topics = row(root, "topics");
  if (topics) {
    const words = (value: string | undefined): string[] => (value ?? "").split(" ").filter(Boolean);
    let read: Record<string, boolean> = {};
    try {
      read = JSON.parse(topics.dataset.sources ?? "{}");
    } catch {
      read = {};
    }
    const base: Record<string, SourceSpot> = {};
    for (const [id, on] of Object.entries(read)) base[id] = { page: "", on: on === true };
    const counts = sourceCounts(savedSources(base, ops, () => ""));
    const count = savedTopicCount(words(topics.dataset.shown), words(topics.dataset.taken), ops);
    shown = say(topics, topicsSummary(count, counts.total, counts.on)) || shown;
  }

  const model = row(root, "model");
  if (model && pending) shown = say(model, modelSummary(pending.provider, pending.model)) || shown;
  return shown;
}
