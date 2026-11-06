/**
 * What the Health page's Stage times card draws: the store's rows (runsStore.ts, read by
 * api/stages.ts) cut into one group per kind of run, each stage in the order the pipeline runs it.
 */

/** A row of `readStageTimings`, less the cost, which the page does not show. */
export interface StageTimingRow {
  workflow: string;
  kind: string;
  stage: string;
  runs: number;
  p50_ms: number;
  p90_ms: number;
}

export interface StageBar {
  id: string;
  label: string;
  p50: number;
  p90: number;
}

export interface StageGroup {
  id: string;
  title: string;
  /** The runs the slowest-counted stage was timed over. */
  runs: number;
  stages: StageBar[];
}

/** run.yml's stages (STAGES in the engine's run/types.ts), then an episode's (EPISODE_STAGE_IDS). */
const STAGE_ORDER = [
  "gate",
  "fetch",
  "judge",
  "write",
  "validate",
  "commit",
  "select",
  "cover",
  "script",
  "publish",
];

/** An on-demand podcast is a Catch up wherever the owner reads it (2026-10-30). */
const KIND_TITLES: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  catch_up: "Catch up",
  on_demand: "Catch up",
};

const sentence = (text: string): string => {
  const words = text.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const rank = (stage: string): number => {
  const at = STAGE_ORDER.indexOf(stage);
  return at === -1 ? STAGE_ORDER.length : at;
};

export function groupTimings(rows: readonly StageTimingRow[]): StageGroup[] {
  const groups = new Map<string, StageGroup>();
  for (const row of rows) {
    const id = `${row.workflow}.${row.kind}`;
    const group = groups.get(id) ?? {
      id,
      title: KIND_TITLES[row.kind] ?? sentence(row.kind),
      runs: 0,
      stages: [],
    };
    group.runs = Math.max(group.runs, row.runs);
    group.stages.push({
      id: row.stage,
      label: sentence(row.stage),
      p50: row.p50_ms,
      p90: row.p90_ms,
    });
    groups.set(id, group);
  }
  for (const group of groups.values()) {
    group.stages.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  }
  // Daily, Weekly, then the podcasts made on request: the order the Health page lists its runs in.
  const kindRank = (group: StageGroup): number => {
    const at = ["Daily", "Weekly", "Catch up"].indexOf(group.title);
    return at === -1 ? 3 : at;
  };
  return [...groups.values()].sort((a, b) => kindRank(a) - kindRank(b) || a.id.localeCompare(b.id));
}

/** "850 ms", "4.2 s", "45 s", "3.4 min", "1 h 12 min": the Health rows' words (server/health.ts duration). */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${Math.floor(ms / 3_600_000)} h ${Math.round((ms % 3_600_000) / 60_000)} min`;
}
