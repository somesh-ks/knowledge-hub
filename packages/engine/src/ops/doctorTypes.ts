import { readFile } from "node:fs/promises";
import type { Env } from "@singularity/core";
import { z } from "zod";
import type { GitRunner } from "../git/runGit.js";
import type { JevClientLike } from "../judge/jev.js";
import type { BlobClient } from "../publish/blob.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  id: string;
  status: CheckStatus;
  summary: string;
  /** What to do about a warn or fail. */
  hint?: string;
}

export interface DoctorReport {
  version: 1;
  online: boolean;
  /** False when any check failed. Warnings do not fail the run. */
  ok: boolean;
  totals: { ok: number; warn: number; fail: number };
  checks: Check[];
}

/** Everything doctor touches outside the repository files, injectable for tests. */
export interface DoctorDeps {
  fetchImpl: typeof fetch;
  nodeVersion: string;
  git: GitRunner;
  createJev: (env: Env) => JevClientLike;
  createBlob: (token: string) => BlobClient;
  /** Per-request timeout for online checks. */
  timeoutMs: number;
}

export const MIN_NODE_MAJOR = 24;

export const ok = (id: string, summary: string): Check => ({ id, status: "ok", summary });
export const warn = (id: string, summary: string, hint: string): Check => ({
  id,
  status: "warn",
  summary,
  hint,
});
export const fail = (id: string, summary: string, hint: string): Check => ({
  id,
  status: "fail",
  summary,
  hint,
});

export async function readFileIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function firstIssue(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return `${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}`;
  }
  return error instanceof Error ? (error.message.split("\n")[0] ?? "invalid") : "invalid";
}
