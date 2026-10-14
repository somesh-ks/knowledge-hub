/**
 * Pure logic for the Model page's select: the options for each vendor. No DOM, so it is unit tested
 * and the page script stays small.
 */
import { CLAUDE_MODELS, contextLabel, NEBIUS_TOP, nebiusName } from "./modelId";
import { topModels } from "./modelRank";

export interface ModelOption {
  /** The model id. */
  id: string;
  label: string;
  hint: string;
  /** The heading the option sits under; "" is none. */
  group: "" | "top" | "rest";
}

export interface LiveModel {
  id: string;
  context_length: number | null;
}

/** The two Claude models, in the order they are offered. */
export const CLAUDE_OPTIONS: readonly ModelOption[] = CLAUDE_MODELS.map((model) => ({
  id: model.id,
  label: model.label,
  hint: model.hint,
  group: "",
}));

/** The Claude models, plus the chosen model when it is none of them, so a saved id stays shown. */
export function claudeOptions(selected: string | null): ModelOption[] {
  const options = [...CLAUDE_OPTIONS];
  if (selected !== null && !options.some((option) => option.id === selected))
    options.push({ id: selected, label: nebiusName(selected), hint: "", group: "" });
  return options;
}

const TOP_IDS: readonly string[] = NEBIUS_TOP.map((model) => model.id);

/**
 * The Top models, then every other live model; there is no Default row, as the page shows what
 * Nebius runs on (NEBIUS_DEFAULT_ID) when nothing is saved. With a live list the Top models are the
 * curated ones it still serves (topModels), and a saved model it no longer has comes first among
 * the rest, flagged. Without one (null) nothing can be checked: the saved model when it is not a
 * top model, then every top model, so a model can be picked by name all the same.
 */
export function nebiusOptions(
  live: readonly LiveModel[] | null,
  saved: string | null,
): ModelOption[] {
  const listed = new Map((live ?? []).map((entry) => [entry.id, entry]));
  const top = topModels(live, TOP_IDS);
  const make = (id: string, group: ModelOption["group"]): ModelOption => {
    const entry = listed.get(id);
    // The line under the name: the context window, or a flag when the live list does not have the
    // model. A model is known by its name; its id and the vendor's prefix in it are never shown.
    const hint =
      live === null ? "" : entry ? contextLabel(entry.context_length) : "Not in the live list";
    return { id, label: nebiusName(id), hint, group };
  };
  const options: ModelOption[] = [];
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
