/**
 * Pure logic for the Daily podcast page's model combobox: the options for each vendor, the filter
 * a typed query applies, and the key that moves the highlight. No DOM, so it is unit tested and
 * the page script stays small.
 */
import { CLAUDE_MODELS, contextLabel, modelParts } from "./modelId";
import { shortlist } from "./modelRank";

export interface ModelOption {
  /** The model id; "" is Nebius's Automatic. */
  id: string;
  label: string;
  hint: string;
  group: "" | "rec" | "rest";
}

export interface LiveModel {
  id: string;
  context_length: number | null;
}

export const AUTOMATIC: ModelOption = {
  id: "",
  label: "Automatic",
  hint: "The engine's own setting",
  group: "",
};

/** The two Claude models, in the order they are offered. */
export const CLAUDE_OPTIONS: readonly ModelOption[] = CLAUDE_MODELS.map((model) => ({
  id: model.id,
  label: model.label,
  hint: model.hint,
  group: "",
}));

/** The line under a Nebius model's name: its vendor and context window. */
function nebiusHint(entry: LiveModel, listed: boolean): string {
  const { vendor } = modelParts(entry.id);
  return [vendor, listed ? contextLabel(entry.context_length) : "Not in the live list"]
    .filter((part) => part !== "")
    .join(", ");
}

/**
 * Automatic, then the recommended models, then every other live one. A saved model the live list
 * no longer has is added first among the rest, flagged. Without a live list (null) there is
 * nothing to rank: Automatic and the saved model only.
 */
export function nebiusOptions(
  live: readonly LiveModel[] | null,
  saved: string | null,
): ModelOption[] {
  const options: ModelOption[] = [AUTOMATIC];
  const entries = [...(live ?? [])];
  if (saved !== null && !entries.some((entry) => entry.id === saved)) {
    entries.unshift({ id: saved, context_length: null });
  }
  const top = new Set(live === null ? [] : shortlist(entries));
  const listed = new Set((live ?? []).map((entry) => entry.id));
  const make = (entry: LiveModel, group: "rec" | "rest"): ModelOption => ({
    id: entry.id,
    label: modelParts(entry.id).name,
    hint: nebiusHint(entry, live === null || listed.has(entry.id)),
    group,
  });
  const ranked = [...top].map((id) => entries.find((entry) => entry.id === id) as LiveModel);
  for (const entry of ranked) options.push(make(entry, "rec"));
  for (const entry of entries) if (!top.has(entry.id)) options.push(make(entry, "rest"));
  return options;
}

/** Options whose name or id contains the query, ignoring case. An empty query keeps them all. */
export function filterOptions(options: readonly ModelOption[], query: string): ModelOption[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...options];
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(needle) || option.id.toLowerCase().includes(needle),
  );
}

/** What the live region says about the open list. */
export function countText(count: number): string {
  if (count === 0) return "No models match";
  return `${count} ${count === 1 ? "model" : "models"}`;
}

/**
 * Where the highlight goes for a key; -1 means none yet. Arrows wrap around the list. Keys that
 * do not move the highlight return it unchanged.
 */
export function moveIndex(current: number, count: number, key: string): number {
  if (count === 0) return -1;
  if (key === "ArrowDown") return current < 0 || current >= count - 1 ? 0 : current + 1;
  if (key === "ArrowUp") return current <= 0 ? count - 1 : current - 1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return current;
}

/** The label the field shows for a chosen model. */
export function labelFor(options: readonly ModelOption[], id: string | null): string {
  const found = options.find((option) => option.id === (id ?? ""));
  return found ? found.label : id === null ? AUTOMATIC.label : modelParts(id).name;
}
