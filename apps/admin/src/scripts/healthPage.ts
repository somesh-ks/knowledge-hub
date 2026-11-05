/**
 * Health page (/admin/health). Paints this device's last answer at once, then asks /api/health and
 * paints the fresh one (lib/kept.ts). Each reading the page drew at build is filled by id: a value,
 * a glyph on one that needs a look, and the marks the answer's series give (run columns, job
 * strips, speed meters). The summary is a tile a section of the page and one for all of them
 * (healthRing.ts). The Speed card shows one device at a time and repaints from the same answer. A
 * failed ask with nothing kept says so in the summary and the banner above, and leaves the shell as
 * drawn.
 */
import type {
  HealthBody,
  HealthRow,
  HealthSeries,
  HealthTone,
} from "../../../web/src/lib/healthRows";
import { mountSegmentedNav, selectTab } from "../../../web/src/scripts/segmentedNav";
import { askKept } from "../lib/kept";
import { PILLARS } from "../lib/pillars";
import { drawTiles } from "./healthRing";

const root = document.querySelector<HTMLElement>("[data-health]");
const deviceTabs = document.querySelector<HTMLElement>("[data-device]");
let answer: HealthBody | null = null;
let device = "mobile";
/** The kind of run shown was picked by a press; an answer no longer moves it. */
let kindPicked = false;

const DEVICE_KEY = "singularity:health-device";
/** The run columns' slots (TIMED_RUNS in server/health.ts): the newest run takes the last. */
const SLOTS = 10;
const OUTCOME_WORD = { pass: "passed", fail: "failed", cancel: "cancelled" } as const;
const isFlag = (tone: HealthTone): boolean => tone === "warn" || tone === "bad";

const el = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** A copy of a status glyph from the page's template (StatusGlyphs.astro), so no markup is drawn here. */
function setMark(mark: Element | null, tone: HealthTone): void {
  if (!mark) return;
  mark.setAttribute("data-tone", tone);
  const copy = document
    .querySelector<HTMLTemplateElement>("template[data-glyphs]")
    ?.content.querySelector(`[data-glyph="${tone}"] > svg`)
    ?.cloneNode(true);
  mark.replaceChildren(...(copy ? [copy] : []));
}

/** A reading: its value, and a glyph only when it needs a look (a budget tile shows its good one too). */
function paintRow(element: HTMLElement, row: HealthRow | undefined): void {
  const value = element.querySelector<HTMLElement>("[data-value]");
  const detail = element.querySelector<HTMLElement>("[data-detail]");
  if (value) value.textContent = row?.value ?? "No data";
  if (detail) detail.textContent = row?.detail ?? "Not checked";
  if (!("speed" in element.dataset) && (!detail || "budget" in element.dataset))
    element.title = row?.detail ?? "";
  const tone = row?.tone ?? "none";
  // A budget tile takes its tone's fill when it needs a look, as the summary's tiles do.
  if ("budget" in element.dataset) element.dataset.tone = tone;
  const shown = isFlag(tone) || ("budget" in element.dataset && tone === "good") ? tone : "none";
  setMark(element.querySelector("[data-mark]"), shown);
}

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const minutes = (ms: number): string =>
  ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 60_000).toFixed(1)} min`;

/** A kind's last runs as columns, each as tall as its run took against the longest; the median a line. */
function drawRuns(holder: HTMLElement, runs: HealthSeries["times"]["daily"]): void {
  const median = holder.querySelector<HTMLElement>("[data-median]");
  for (const column of holder.querySelectorAll(".hl-column")) column.remove();
  if (runs.length === 0) {
    if (median) median.hidden = true;
    holder.setAttribute("aria-label", "No runs timed yet");
    return;
  }
  const longest = Math.max(...runs.map((run) => run.ms));
  const sorted = runs.map((run) => run.ms).sort((a, b) => a - b);
  const middle =
    sorted.length % 2
      ? (sorted[(sorted.length - 1) / 2] as number)
      : ((sorted[sorted.length / 2 - 1] as number) + (sorted[sorted.length / 2] as number)) / 2;
  holder.prepend(
    ...runs.map((run, index) => {
      const column = el("span", "hl-column");
      column.style.setProperty("--h", String(run.ms / longest));
      column.style.gridColumn = String(SLOTS - runs.length + index + 1);
      if (index === runs.length - 1) column.dataset.last = "";
      column.title = `${shortDate(run.at)}: ${minutes(run.ms)}`;
      return column;
    }),
  );
  if (median) {
    median.hidden = false;
    median.style.setProperty("--h", String(middle / longest));
  }
  const last = runs.at(-1);
  holder.setAttribute(
    "aria-label",
    `${runs.length} runs, median ${minutes(middle)}${last ? `, last ${minutes(last.ms)}` : ""}`,
  );
}

/** A workflow's week of finished runs, oldest first; a failure or cancel takes its tone. */
function drawStrip(holder: HTMLElement, runs: HealthSeries["jobs"][string] | undefined): void {
  // The week's last 28 runs, oldest first: 28 pips and their 4px gaps fit a 320px phone's strip.
  const shown = (runs ?? []).slice(-28);
  holder.replaceChildren(
    ...shown.map((run) => {
      const pip = el("span", "hl-pip");
      pip.dataset.outcome = run.outcome;
      pip.title = `${shortDate(run.at)}: ${OUTCOME_WORD[run.outcome]}`;
      return pip;
    }),
  );
  const failed = shown.filter((run) => run.outcome !== "pass").length;
  holder.setAttribute(
    "aria-label",
    shown.length === 0
      ? "No runs"
      : failed === 0
        ? `${shown.length} runs, all passed`
        : `${shown.length} runs, ${failed} did not pass`,
  );
}

/** Google's bands for a reading (good, needs work, poor) and its p75 as a pin, scaled to 1.5× poor. */
function drawMeter(
  element: HTMLElement,
  reading: HealthSeries["vitals"][string] | undefined,
  tone: HealthTone,
): void {
  const track = element.querySelector<HTMLElement>("[data-track]");
  const pin = element.querySelector<HTMLElement>("[data-pin]");
  if (!track || !pin) return;
  if (!reading) {
    pin.hidden = true;
    track.setAttribute("aria-label", "No data");
    return;
  }
  const [good, poor] = reading.lines;
  const end = poor * 1.5;
  track.style.setProperty("--good", String(good / end));
  track.style.setProperty("--poor", String(poor / end));
  pin.hidden = false;
  pin.dataset.tone = tone;
  pin.style.setProperty("--at", String(Math.min(reading.p75, end) / end));
  track.setAttribute(
    "aria-label",
    reading.p75 <= good
      ? "In the good band"
      : reading.p75 <= poor
        ? "In the needs-work band"
        : "In the poor band",
  );
}

function paintSummary(): void {
  const summary = root?.querySelector<HTMLElement>("[data-health-summary]");
  if (!summary || !answer) return;
  drawTiles(summary, answer, PILLARS, (pillar) => `#c-${pillar}`);
  const at = new Date(answer.checked_at);
  const sameDay = at.toDateString() === new Date().toDateString();
  const checked = `${sameDay ? "" : `${shortDate(answer.checked_at)}, `}${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  const missing = [
    answer.parts.content === "fallback" && "the content store answered from this build's copy",
    answer.parts.content === "saved" && "the content store answered from its last saved list",
    answer.parts.database === "unavailable" && "the database did not answer",
    answer.parts.github === "unavailable" && "GitHub did not answer",
    answer.parts.github === "partial" && "GitHub answered for some workflows only",
  ].filter(Boolean);
  const note = summary.querySelector<HTMLElement>("[data-health-note]");
  if (note)
    note.textContent = `Checked ${checked}.${missing.length ? ` Partial: ${missing.join("; ")}.` : ""}`;
}

function paint(): void {
  if (!root || !answer) return;
  const byId = new Map(answer.rows.map((row) => [row.id, row]));
  const series = answer.series;
  for (const element of root.querySelectorAll<HTMLElement>("[data-health-row]")) {
    const id = element.dataset.healthRow ?? "";
    const key = "speed" in element.dataset ? `${id}.${device}` : id;
    const row = byId.get(key);
    paintRow(element, row);
    if ("speed" in element.dataset) drawMeter(element, series?.vitals[key], row?.tone ?? "none");
    // An error line reads its day and its week in one: "0 today, 2 this week".
    const errors = series?.errors[id];
    const value = element.querySelector<HTMLElement>("[data-value]");
    if ("errors" in element.dataset && value && row && errors) {
      value.textContent = `${row.value} today, ${errors.week} this week`;
    }
  }
  for (const kind of ["daily", "weekly"] as const) {
    const holder = root.querySelector<HTMLElement>(`[data-runs="${kind}"]`);
    if (holder) drawRuns(holder, series?.times[kind] ?? []);
  }
  for (const holder of root.querySelectorAll<HTMLElement>("[data-strip]")) {
    drawStrip(holder, series?.jobs[holder.dataset.strip ?? ""]);
  }
  paintSummary();
}

async function load(): Promise<void> {
  if (!root) return;
  const asked = await askKept<HealthBody>(
    "/api/health",
    "health",
    (body) => {
      answer = body;
      const flagged = body.rows.find((row) => row.id.startsWith("time_") && isFlag(row.tone))?.id;
      if (kindTabs && flagged && !kindPicked) {
        selectTab(kindTabs, flagged.slice(5));
        showKind(flagged.slice(5));
      }
      paint();
      delete root.dataset.loading;
    },
    { title: "Health checks didn't load", repaint: "always" },
  );
  if (!asked.shown) {
    const words = root.querySelector<HTMLElement>("[data-health-state]");
    if (words) words.textContent = "No answer";
    delete root.dataset.loading;
  }
}

// Runs: a kind at a time, the one whose run time needs a look first.
const kindTabs = document.querySelector<HTMLElement>("[data-kinds]");
function showKind(kind: string): void {
  for (const panel of root?.querySelectorAll<HTMLElement>("[data-kind-card]") ?? []) {
    panel.hidden = panel.dataset.kindCard !== kind;
  }
}
if (kindTabs)
  mountSegmentedNav(kindTabs, (kind) => {
    kindPicked = true;
    showKind(kind);
  });

if (deviceTabs) {
  // The device last chosen on this browser; a convenience, so a blocked storage changes nothing.
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored && deviceTabs.querySelector(`[data-value="${CSS.escape(stored)}"]`)) {
      device = stored;
      selectTab(deviceTabs, stored);
    }
  } catch {
    // Storage blocked: the first device stands.
  }
  mountSegmentedNav(deviceTabs, (value) => {
    device = value;
    try {
      localStorage.setItem(DEVICE_KEY, value);
    } catch {
      // Storage blocked: the choice lasts this page.
    }
    paint();
  });
}

void load();
