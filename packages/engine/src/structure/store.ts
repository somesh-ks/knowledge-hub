import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILES, STRUCTURE_KINDS, StructureFile } from "@singularity/core";

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

/** Stable text for the file: kinds in STRUCTURE_KINDS order, two-space indent, trailing newline. */
export function serializeStructure(file: StructureFile): string {
  const checked = StructureFile.parse(file);
  const kinds: StructureFile["kinds"] = {};
  for (const kind of STRUCTURE_KINDS) {
    const blocks = checked.kinds[kind];
    if (blocks !== undefined) kinds[kind] = blocks;
  }
  return `${JSON.stringify({ version: checked.version, kinds }, null, 2)}\n`;
}
