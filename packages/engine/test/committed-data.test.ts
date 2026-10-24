import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  JudgmentsFile,
  LastRunFile,
  ModelRouting,
  Preferences,
  ScheduleFile,
  SeenFile,
  SourceHealthFile,
  SourceStatsFile,
  SourcesFile,
  TopicJudgmentsFile,
  TopicsFile,
  UsageFile,
} from "@singularity/core";
import { describe, expect, it } from "vitest";
import { parseQueries } from "../src/fetch/queries.js";
import { parseVoice } from "../src/voice/voice.js";
import { REPO_ROOT } from "./score-factories.js";

// Tests read frozen copies of the owner-editable config (fixtures/config). This file is the one
// place that reads the live files: a schema change that strands the bot's own config or state is
// the costly failure, so each committed file must still parse with the current schema.
const SCHEMAS: Record<string, { parse: (value: unknown) => unknown }> = {
  "config/preferences.json": Preferences,
  "config/schedule.json": ScheduleFile,
  "config/sources.json": SourcesFile,
  "config/topics.json": TopicsFile,
  "config/models.json": ModelRouting,
  "config/queries.json": { parse: parseQueries },
  "state/judgments.json": JudgmentsFile,
  "state/last-run.json": LastRunFile,
  "state/seen.json": SeenFile,
  "state/source-health.json": SourceHealthFile,
  "state/source-stats.json": SourceStatsFile,
  "state/topic-judgments.json": TopicJudgmentsFile,
  "state/usage.json": UsageFile,
};

describe("committed data", () => {
  it.each(Object.keys(SCHEMAS))("%s parses with the current schema", (rel) => {
    const path = join(REPO_ROOT, rel);
    if (!existsSync(path)) return;
    const schema = SCHEMAS[rel];
    if (!schema) throw new Error(`no schema for ${rel}`);
    expect(() => schema.parse(JSON.parse(readFileSync(path, "utf8")))).not.toThrow();
  });

  it("config/voice.md parses into banned words and limits", () => {
    const voice = parseVoice(readFileSync(join(REPO_ROOT, "config", "voice.md"), "utf8"));
    expect(voice.bannedWords.length).toBeGreaterThan(0);
  });
});
