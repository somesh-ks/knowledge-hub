import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILES, DEFAULT_WRITER, WriterFile } from "@dispatch/core";

export class WriterConfigError extends Error {
  constructor(problems: string[]) {
    super(`${CONFIG_FILES.writer} is invalid: ${problems.slice(0, 5).join("; ")}`);
    this.name = "WriterConfigError";
  }
}

/** config/writer.json as written, or null when it does not exist yet. */
export async function loadWriterFile(root: string): Promise<WriterFile | null> {
  let text: string;
  try {
    text = await readFile(join(root, CONFIG_FILES.writer), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new WriterConfigError(["not valid JSON"]);
  }
  const parsed = WriterFile.safeParse(json);
  if (!parsed.success) {
    throw new WriterConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return parsed.data;
}

/** The writer settings a run follows: the file, or the defaults when there is none. */
export async function loadWriter(root: string): Promise<WriterFile> {
  return (await loadWriterFile(root)) ?? DEFAULT_WRITER;
}

/**
 * The model the owner chose in Settings, or null. A missing or broken file means null: a bad
 * settings file must never stop a briefing, which then runs on the environment's models.
 */
export function loadWriterModel(root: string): string | null {
  try {
    const parsed = WriterFile.safeParse(
      JSON.parse(readFileSync(join(root, CONFIG_FILES.writer), "utf8")),
    );
    return parsed.success ? parsed.data.model : null;
  } catch {
    return null;
  }
}

/** Stable text for the file: fields in schema order, two-space indent, trailing newline. */
export function serializeWriter(file: WriterFile): string {
  const checked = WriterFile.parse(file);
  return `${JSON.stringify(
    { version: checked.version, provider: checked.provider, model: checked.model },
    null,
    2,
  )}\n`;
}
