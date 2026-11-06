/**
 * The health ring's pillars, one place for the Overview's ring and the Health page, whose sections are
 * these same pillars in the same order: what the ring says on one page is where to look on the other
 * (2026-11-04, the owner: Health's overview "just like the overview page's"). The pillars are the
 * places to look, not the kinds of fault: a fault class (errors) cuts across them, so each error check
 * sits with what it breaks. Content is what readers get, Pipeline is what makes it, Site is what the
 * browser sees, Server is what answers it, Budgets is the daily check's card (D360). Each row keeps
 * the id the route answers by and a name that stands alone under its pillar.
 */
import { HEALTH_DEVICES, HEALTH_GROUPS, HEALTH_SPEED } from "../../../web/src/lib/healthRows";

export interface Pillar {
  id: string;
  title: string;
  rows: Array<{ id: string; label: string }>;
}

const labelOf = new Map<string, string>(
  HEALTH_GROUPS.flatMap((group) =>
    group.rows.map((row) => [`${group.id}.${row.id}`, row.label] as const),
  ),
);
const rows = (...ids: string[]): Pillar["rows"] =>
  ids.map((key) => ({ id: key.split(".")[1] ?? key, label: labelOf.get(key) ?? key }));

export const PILLARS: Pillar[] = [
  {
    id: "content",
    title: "Content",
    rows: rows("briefings.daily", "briefings.weekly", "briefings.catch_up", "briefings.narration"),
  },
  {
    id: "pipeline",
    title: "Pipeline",
    rows: [
      ...rows(
        "jobs.job_run",
        "jobs.job_podcast",
        "jobs.job_audio",
        "jobs.job_content",
        "jobs.job_health",
      ).map((row) => ({ ...row, label: `Job: ${row.label}` })),
      ...rows("times.time_daily", "times.time_weekly").map((row) => ({
        ...row,
        label: `${row.label} run time`,
      })),
      ...rows("briefings.fallbacks", "services.sources"),
    ],
  },
  {
    id: "site",
    title: "Site",
    rows: [
      ...HEALTH_SPEED.flatMap((metric) =>
        HEALTH_DEVICES.map((device) => ({
          id: `${metric.id}.${device.id}`,
          label: `${metric.label} on ${device.label.toLowerCase()}`,
        })),
      ),
      ...rows("errors.page_errors", "errors.blocked_scripts"),
    ],
  },
  {
    id: "server",
    title: "Server",
    rows: rows("errors.server_errors", "errors.timeouts", "services.database", "services.content"),
  },
  {
    id: "budgets",
    title: "Budgets",
    rows: rows(
      "budgets.budget_cost",
      "budgets.budget_speed",
      "budgets.budget_tests",
      "budgets.budget_bugs",
      "budgets.budget_security",
      "budgets.budget_keys",
    ).map((row) => ({ ...row, label: `Budget: ${row.label}` })),
  },
];
