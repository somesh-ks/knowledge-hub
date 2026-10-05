import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  EMPTY_JUDGMENTS,
  EMPTY_LAST_RUN,
  EMPTY_SEEN,
  type JudgmentsFile,
  JudgmentsFile as JudgmentsSchema,
  type LastRunFile,
  LastRunFile as LastRunSchema,
  type SeenFile,
  SeenFile as SeenSchema,
  STATE_FILES,
  type UsageFile,
  UsageFile as UsageSchema,
} from "@dispatch/core";
import type { ZodType } from "zod";
import { writeFileAtomic } from "./atomicWrite.js";
import { stableStringify } from "./stableJson.js";

/** A state file that exists but cannot be trusted. Never silently replaced with defaults. */
export class StateError extends Error {
  constructor(file: string, detail: string) {
    super(`${file}: ${detail}`);
    this.name = "StateError";
  }
}

async function readState<T>(
  root: string,
  rel: string,
  schema: ZodType<T>,
  fallback: () => T,
): Promise<T> {
  let text: string;
  try {
    text = await readFile(join(root, rel), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback();
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new StateError(rel, "not valid JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new StateError(
      rel,
      `${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}

/** Validate before writing so a bug cannot put an invalid file into a commit. */
async function writeState<T>(
  root: string,
  rel: string,
  schema: ZodType<T>,
  value: T,
): Promise<void> {
  const checked = schema.parse(value);
  await writeFileAtomic(join(root, rel), stableStringify(checked));
}

export const readSeen = (root: string): Promise<SeenFile> =>
  readState(root, STATE_FILES.seen, SeenSchema, () => structuredClone(EMPTY_SEEN));
export const writeSeen = (root: string, file: SeenFile): Promise<void> =>
  writeState(root, STATE_FILES.seen, SeenSchema, file);

export const readJudgments = (root: string): Promise<JudgmentsFile> =>
  readState(root, STATE_FILES.judgments, JudgmentsSchema, () => structuredClone(EMPTY_JUDGMENTS));
export const writeJudgments = (root: string, file: JudgmentsFile): Promise<void> =>
  writeState(root, STATE_FILES.judgments, JudgmentsSchema, file);

export const readLastRun = (root: string): Promise<LastRunFile> =>
  readState(root, STATE_FILES.lastRun, LastRunSchema, () => structuredClone(EMPTY_LAST_RUN));
export const writeLastRun = (root: string, file: LastRunFile): Promise<void> =>
  writeState(root, STATE_FILES.lastRun, LastRunSchema, file);

export function defaultUsage(now: Date): UsageFile {
  return { version: 1, speechify: { month: now.toISOString().slice(0, 7), characters: 0 } };
}
export const readUsage = (root: string, now: Date): Promise<UsageFile> =>
  readState(root, STATE_FILES.usage, UsageSchema, () => defaultUsage(now));
export const writeUsage = (root: string, file: UsageFile): Promise<void> =>
  writeState(root, STATE_FILES.usage, UsageSchema, file);
