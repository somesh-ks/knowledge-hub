/**
 * Pure logic for the Model page's combobox: the options for each vendor, the filter a typed query
 * applies, and the key that moves the highlight. No DOM, so it is unit tested and the page script
 * stays small.
 */
import { CLAUDE_MODELS, contextLabel, modelParts, NEBIUS_TOP, nebiusName } from "./modelId";
import { topModels } from "./modelRank";

export interface ModelOption {
  /** The model id; "" is Nebius's Automatic. */
  id: string;
  label: string;
  hint: string;
  /** The heading the option sits under; "" is none. */
  group: "" | "top" | "rest";
}

/** The heading over each group of options, which also names the group for a screen reader. */
export const GROUP_NAMES = { top: "Top models", rest: "All models" } as const;

export interface LiveModel {
  id: string;
  context_length: number | null;
}

export const AUTOMATIC: ModelOption = {
  id: "",
  label: "Default",
  // Which model Default stands for is the engine's to say, and the page does not know it: no hint
  // rather than one that only repeats the label.
  hint: "",
  group: "",
};

/** Said in the list when a filter matches nothing, so it never opens as a blank box. */
export function noMatchText(query: string): string {
  return `No model called \u201c${query.trim()}\u201d`;
}

/** The two Claude models, in the order they are offered. */
export const CLAUDE_OPTIONS: readonly ModelOption[] = CLAUDE_MODELS.map((model) => ({
  id: model.id,
  label: model.label,
  hint: model.hint,
  group: "",
}));

const TOP_IDS: readonly string[] = NEBIUS_TOP.map((model) => model.id);

/**
 * Automatic, then the Top models, then every other live model. With a live list the Top models are
 * the curated ones it still serves (topModels), and a saved model it no longer has comes first
 * among the rest, flagged. Without one (null) nothing can be checked: Automatic, the saved model
 * when it is not a top model, then every top model, so a model can be picked by name all the same.
 */
export function nebiusOptions(
  live: readonly LiveModel[] | null,
  saved: string | null,
): ModelOption[] {
  const listed = new Map((live ?? []).map((entry) => [entry.id, entry]));
  const top = topModels(live, TOP_IDS);
  const make = (id: string, group: ModelOption["group"]): ModelOption => {
    const entry = listed.get(id);
    // The line under the name: the vendor, then the context window, or a flag when the live list
    // does not have the model. Without a live list there is nothing to say past the vendor.
    const detail =
      live === null ? "" : entry ? contextLabel(entry.context_length) : "Not in the live list";
    const hint = [modelParts(id).vendor, detail].filter((part) => part !== "").join(", ");
    return { id, label: nebiusName(id), hint, group };
  };
  const options: ModelOption[] = [AUTOMATIC];
  const unlisted = saved !== null && !top.includes(saved) && !listed.has(saved);
  if (live === null) {
    if (unlisted) options.push(make(saved, ""));
    for (const id of top) options.push(make(id, "top"));
    return options;
  }
  for (const id of top) options.push(make(id, "top"));
  if (unlisted) options.push(make(saved, "rest"));
  for (const entry of live) if (!top.includes(entry.id)) options.push(make(entry.id, "rest"));
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
  return found ? found.label : id === null ? AUTOMATIC.label : nebiusName(id);
}
