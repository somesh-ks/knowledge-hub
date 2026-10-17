/**
 * Pure logic for the Settings page's one model select: the options of both vendors in one list. No
 * DOM, so it is unit tested and the page script stays small.
 */
import { CLAUDE_MODELS, NEBIUS_TOP, nebiusName } from "./modelId";
import { topModels } from "./modelRank";

export interface ModelOption {
  /** The model id. */
  id: string;
  label: string;
  /** The heading the option sits under; "" is none (the saved model neither list offers). */
  group: "" | "Claude" | "Nebius";
}

export interface LiveModel {
  id: string;
  context_length: number | null;
}

/** The Claude families offered, each as its newest model. */
const FAMILIES = ["opus", "sonnet", "haiku"] as const;
/** How many of the curated Nebius models are offered. */
export const NEBIUS_OFFERED = 5;

const TOP_IDS: readonly string[] = NEBIUS_TOP.map((model) => model.id);

/**
 * The options of the one model select. Claude: Opus, Sonnet and Haiku, each the first model of its
 * family in Anthropic's list (newest first), or the built-in one without a list (null) or when the
 * list has none of that family. Nebius: the first five curated models the live list still serves
 * (topModels), or the first five curated ones without a list. The saved model comes last, flagged
 * "(current)", when it is none of those, so a saved choice is never changed by opening the page.
 */
export function writerOptions(
  selected: string | null,
  claude: readonly { id: string; label: string }[] | null = null,
  nebius: readonly LiveModel[] | null = null,
): ModelOption[] {
  const options: ModelOption[] = [];
  for (const family of FAMILIES) {
    const known = CLAUDE_MODELS.find((model) => model.id.includes(family));
    const live = claude?.find((model) => model.id.includes(family));
    const id = live?.id ?? known?.id;
    if (id === undefined) continue;
    options.push({
      id,
      label: live?.label ?? known?.label ?? id,
      group: "Claude",
    });
  }
  for (const id of topModels(nebius, TOP_IDS).slice(0, NEBIUS_OFFERED)) {
    options.push({ id, label: nebiusName(id), group: "Nebius" });
  }
  if (selected !== null && !options.some((option) => option.id === selected)) {
    const label = selected.startsWith("claude-")
      ? (claude?.find((model) => model.id === selected)?.label ?? selected)
      : nebiusName(selected);
    options.push({ id: selected, label: `${label} (current)`, group: "" });
  }
  return options;
}
