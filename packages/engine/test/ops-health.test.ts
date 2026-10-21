import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestRelPath, serializeDigestFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectHealth, type HealthFetch } from "../src/ops/health.js";
import { makeDigest } from "./audio-fixtures.js";

const NOW = new Date("2026-10-21T12:00:00Z");
const AUDIO = "https://x.public.blob.vercel-storage.com/audio/2026-10-20.mp3";
let root: string;

async function put(rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), text);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dispatch-health-"));
  // A briefing last published eleven days ago, a weekly that failed, two fallbacks.
  await put(
    "state/last-run.json",
    JSON.stringify({
      version: 1,
      regular: {
        at: "2026-10-10T05:00:00Z",
        digest_id: "2026-10-10",
        items: 8,
        outcome: "published",
      },
      weekly: { at: "2026-10-18T05:00:00Z", items: 0, outcome: "failed" },
      spend: { at: "2026-10-18T05:00:00Z", requests: { model_fallback: 2 } },
    }),
  );
  const yesterday = makeDigest({
    id: "2026-10-19",
    date: "2026-10-19",
    generated_at: "2026-10-19T05:00:00Z",
  });
  const newest = makeDigest(
    {
      id: "2026-10-20",
      date: "2026-10-20",
      generated_at: "2026-10-20T05:00:00Z",
      audio: { url: AUDIO, duration_ms: 60_000 },
    },
    3,
  );
  await put(digestRelPath(yesterday.id), serializeDigestFile(yesterday));
  await put(digestRelPath(newest.id), serializeDigestFile(newest));
  await put(digestRelPath("2026-10-16"), "---\nnot: a digest\n---\n");
  await put(
    "state/costs-2026-10.json",
    JSON.stringify({
      version: 1,
      records: [
        {
          id: "r1",
          at: "2026-10-21T06:00:00Z",
          run_id: "run",
          kind: "daily",
          timezone: "Europe/Stockholm",
          user: "owner",
          scope: "shared",
          stage: "write",
          provider: "anthropic",
          product: "claude",
          units: { input_tokens: 1 },
          usd: 7.5,
        },
      ],
    }),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const codes = (findings: ReadonlyArray<{ code: string; severity: string }>, severity: string) =>
  findings.filter((each) => each.severity === severity).map((each) => each.code);

describe("dispatch health", () => {
  // Each of these was an ordinary line in `dispatch status` that nobody read.
  it("faults a failed run, a missed run, missing narration, a broken digest, a thin briefing and a runaway spend", async () => {
    const report = await collectHealth({
      root,
      now: NOW,
      monthlyChars: 500_000,
      ceilingUsd: 5,
      site: null,
    });
    expect(report.ok).toBe(false);
    expect(codes(report.findings, "fault")).toEqual(
      expect.arrayContaining([
        "run_failed",
        "run_overdue",
        "audio_missing",
        "digest_invalid",
        "cost_over_ceiling",
      ]),
    );
    expect(codes(report.findings, "warning")).toEqual(
      expect.arrayContaining(["model_fallback", "digest_thin"]),
    );
  });

  // A deploy Vercel skipped (a wrong author on Hobby) or one that lost vercel.json looks fine to CI.
  it("faults a live site that lost its headers, serves an old briefing and lost the narration file", async () => {
    const asked: string[] = [];
    const answer = (status: number, body = "", headers: Record<string, string> = {}) => ({
      status,
      headers: { get: (name: string) => headers[name] ?? null },
      text: async () => body,
    });
    const fake: HealthFetch = async (url, init) => {
      asked.push(`${init?.method ?? "GET"} ${url}`);
      if (url === AUDIO) return answer(404);
      if (url.endsWith("/api/podcast")) return answer(405);
      if (url.endsWith("/latest.json")) return answer(200, '{"id":"2026-10-19"}');
      return answer(200, "<html>", { "x-content-type-options": "nosniff" });
    };
    const report = await collectHealth({
      root,
      now: NOW,
      monthlyChars: 500_000,
      ceilingUsd: 50,
      site: "https://news.example",
      fetch: fake,
    });
    expect(codes(report.findings, "fault")).toEqual(
      expect.arrayContaining(["site_headers", "site_stale", "audio_unreachable"]),
    );
    expect(codes(report.findings, "fault")).not.toContain("site_api");
    expect(asked).toContain(`HEAD ${AUDIO}`);
  });
});
