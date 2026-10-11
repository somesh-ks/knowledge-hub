import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_WRITER, WriterFile } from "@dispatch/core";
import { CLAUDE_MODELS, nebiusName } from "./modelId";
import { findRepoRoot } from "./repoRoot";
import { usesFixtures } from "./site";

/**
 * The writer settings the Model page shows, read from the repository at build time. A missing or
 * invalid config/writer.json means Automatic, which is what the engine runs on too.
 */
export interface WriterView {
  provider: "nebius" | "anthropic";
  /** The model chosen in Settings, or null for the engine's own setting. */
  model: string | null;
  /** What the Settings row says: a top model's name, the id's last segment, or "Automatic". */
  label: string;
}

/** The name the Settings row and the Model field show, the same one the model list uses. */
export function writerLabel(
  model: string | null,
  provider: "nebius" | "anthropic" = "nebius",
): string {
  if (model === null) return "Automatic";
  if (provider === "anthropic") {
    return CLAUDE_MODELS.find((entry) => entry.id === model)?.label ?? model;
  }
  return nebiusName(model);
}

export async function loadWriterView(
  options: { root?: string; env?: Record<string, string | undefined> } = {},
): Promise<WriterView> {
  const env = options.env ?? process.env;
  const repo = options.root ?? findRepoRoot(process.cwd(), env);
  const base = usesFixtures(env) ? join(repo, "apps", "web", "src", "fixtures") : repo;
  let json: unknown = null;
  try {
    json = JSON.parse(await readFile(join(base, "config", "writer.json"), "utf8"));
  } catch {
    json = null;
  }
  const parsed = WriterFile.safeParse(json);
  const { provider, model } = parsed.success ? parsed.data : DEFAULT_WRITER;
  return { provider, model, label: writerLabel(model, provider) };
}
