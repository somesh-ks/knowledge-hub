import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILES, StructureFile } from "@singularity/core";

export class StructureError extends Error {
  constructor(problems: string[]) {
    super(`${CONFIG_FILES.structure} is invalid: ${problems.slice(0, 5).join("; ")}`);
    this.name = "StructureError";
  }
}

/** config/structure.json as written, or null when it does not exist, so every kind runs its defaults. */
export async function loadStructureFile(root: string): Promise<StructureFile | null> {
  let text: string;
  try {
    text = await readFile(join(root, CONFIG_FILES.structure), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new StructureError(["not valid JSON"]);
  }
  const parsed = StructureFile.safeParse(json);
  if (!parsed.success) {
    throw new StructureError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return parsed.data;
}

/** Stable text for the file: the profile, its blocks, the prompts by key, two-space indent, trailing newline. */
export function serializeStructure(file: StructureFile): string {
  const checked = StructureFile.parse(file);
  const prompts = Object.fromEntries(
    Object.entries(checked.prompts ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const body = {
    version: checked.version,
    ...(checked.profile === undefined ? {} : { profile: checked.profile }),
    // The resolved list is kept for a named profile too: it holds the owner's topic sections.
    ...(checked.blocks === undefined ? {} : { blocks: checked.blocks }),
    // The owner's own list while a named profile runs, for a return to Custom (2026-10-27).
    ...(checked.custom_blocks === undefined ? {} : { custom_blocks: checked.custom_blocks }),
    ...(Object.keys(prompts).length > 0 ? { prompts } : {}),
  };
  return `${JSON.stringify(body, null, 2)}
`;
}
