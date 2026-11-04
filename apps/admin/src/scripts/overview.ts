/**
 * The overview's numbers. Asks the reader's /api/health and /api/costs (the same origin once the
 * command center is served beside the reader) and fills the static shell: nothing moves when the
 * answers arrive, and a failed ask says so in place. Plain DOM and one inline SVG, as the reader's
 * own pages do it (costsPage.ts, healthPage.ts, beside this file).
 */

import { askKept } from "../lib/kept";
import { PILLARS, type Pillar } from "../lib/pillars";
import { href } from "../lib/sections";
import { drawRing, type HealthBody as RingBody } from "./healthRing";

interface HealthBody extends RingBody {
  parts?: { content?: string; database?: string; github?: string };
  tiles: Record<string, string>;
}
interface Rollup {
  usd: number;
  runs: number;
}
interface CostBody {
  time_zone: string;
  site?: string;
  engine?: string;
  billing?: string;
  report: {
    buckets: Array<{ bucket: string; total: Rollup; groups: Record<string, Rollup> }>;
    total: Rollup;
    per_run_usd: number;
  };
}

const SVG = "http://www.w3.org/2000/svg";
const NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  exa: "Exa",
  firecrawl: "Firecrawl",
  gemini: "Gemini",
  speechify: "Speechify",
  typesafe: "TypeSafe",
};
const DAYS = 30;
/** The week strip: the last seven days, the most the phone's width gives a 44px press each. */
const WEEK = 7;

const usd = (n: number): string => (n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`);
const nameOf = (key: string): string => NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
const pick = <T extends Element>(selector: string): T | null => document.querySelector<T>(selector);
const svgEl = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
};
const element = (tag: string, className: string, text?: string): HTMLElement => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
const shift = (date: string, days: number): string => {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};
const today = (zone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};
const dayLabel = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

// ---- health ----------------------------------------------------------------------------------

function renderHealth(body: HealthBody, pillars: Pillar[]): void {
  const root = pick<HTMLElement>("[data-overview-health]");
  if (!root) return;
  const missing = [
    body.parts?.content === "fallback" && "the content store answered from this build's copy",
    body.parts?.content === "saved" && "the content store answered from its last saved list",
    body.parts?.database === "unavailable" && "the database did not answer",
    body.parts?.github === "unavailable" && "GitHub did not answer",
    body.parts?.github === "partial" && "GitHub answered for some workflows only",
  ].filter(Boolean);
  const note = pick<HTMLElement>("[data-health-note]");
  if (note) {
    note.textContent = missing.length ? `Partial: ${missing.join("; ")}.` : "";
    note.hidden = missing.length === 0;
  }
  // A flagged line opens the Health page at its pillar's section.
  drawRing(root, body, pillars, (pillar) => href(`/health#c-${pillar}`));
  root.removeAttribute("data-loading");
}

// ---- spend -----------------------------------------------------------------------------------

interface Day {
  date: string;
  usd: number;
  runs: number;
  groups: Array<[string, number]>;
}

/** A day spent something if it ran or was billed: spend can land with no run counted against it. */
const spent = (day: Day): boolean => day.runs > 0 || day.usd > 0;

/** The week strip and the line under it: the days are radios, the pick sets the line, grey at rest and blue when picked. */
function drawWeek(body: CostBody): void {
  const holder = pick<HTMLElement>("[data-spend-days]");
  if (!holder) return;
  const end = today(body.time_zone);
  const byDay = new Map(body.report.buckets.map((b) => [b.bucket, b]));
  const days: Day[] = Array.from({ length: WEEK }, (_, i) => {
    const date = shift(end, i - (WEEK - 1));
    const bucket = byDay.get(date);
    return {
      date,
      usd: bucket?.total.usd ?? 0,
      runs: bucket?.total.runs ?? 0,
      groups: Object.entries(bucket?.groups ?? {})
        .map(([key, g]): [string, number] => [key, g.usd])
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]),
    };
  });
  const max = Math.max(0.01, ...days.map((d) => d.usd));
  const figure = pick<HTMLElement>("[data-day-figure]");
  const detail = pick<HTMLElement>("[data-day-sub]");
  const pickDay = (day: Day, last: boolean): void => {
    const name = last
      ? "Today"
      : new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-GB", {
          weekday: "long",
          timeZone: "UTC",
        });
    if (figure) figure.textContent = spent(day) ? usd(day.usd) : "No runs";
    if (detail)
      detail.textContent = [
        `${name}, ${dayLabel(day.date)}`,
        day.runs ? `${day.runs} ${day.runs === 1 ? "run" : "runs"}` : "",
        ...day.groups.slice(0, 2).map(([k, v]) => `${nameOf(k)} ${usd(v)}`),
      ]
        .filter(Boolean)
        .join(" · ");
  };
  // The newest day with a run is the one open on arrival; none ran, today.
  const open = days.reduce((a, d, i) => (spent(d) ? i : a), WEEK - 1);
  holder.replaceChildren(
    ...days.map((day, i) => {
      const last = i === WEEK - 1;
      const label = element("label", "ov-day");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "ov-day";
      input.checked = i === open;
      input.setAttribute(
        "aria-label",
        `${last ? "Today" : dayLabel(day.date)}: ${spent(day) ? usd(day.usd) : "no runs"}`,
      );
      input.addEventListener("change", () => pickDay(day, last));
      const dial = svgEl("svg", { class: "ov-dial", viewBox: "0 0 28 28", "aria-hidden": "true" });
      dial.append(svgEl("circle", { class: "ov-dial-track", cx: 14, cy: 14, r: 11 }));
      // A day with no spend draws no fill: a zero-length dash under a round cap would show as a dot.
      if (spent(day))
        dial.append(
          svgEl("circle", {
            class: "ov-dial-fill",
            cx: 14,
            cy: 14,
            r: 11,
            pathLength: 1,
            style: `--fill:${Math.max(0.06, day.usd / max).toFixed(3)};--i:${i}`,
          }),
        );
      label.append(
        input,
        element(
          "span",
          "ov-day-name",
          last
            ? "Today"
            : new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-GB", {
                weekday: "short",
                timeZone: "UTC",
              }),
        ),
        dial,
        element("span", "ov-day-date", String(Number(day.date.slice(8)))),
      );
      return label;
    }),
  );
  const chosen = days[open];
  if (chosen) pickDay(chosen, open === WEEK - 1);
}

function renderSpend(body: CostBody): void {
  const root = pick<HTMLElement>("[data-overview-spend]");
  if (!root) return;
  const { report } = body;
  const end = today(body.time_zone);
  const start = shift(end, -(DAYS - 1));
  const inWindow = report.buckets.filter((b) => b.bucket >= start && b.bucket <= end);
  const total = inWindow.reduce((sum, b) => sum + b.total.usd, 0);
  const runs = inWindow.reduce((sum, b) => sum + b.total.runs, 0);
  const totalEl = pick<HTMLElement>("[data-spend-total]");
  if (totalEl) totalEl.textContent = usd(total);
  const sub = pick<HTMLElement>("[data-spend-sub]");
  if (sub)
    sub.textContent =
      runs > 0 ? `Last ${DAYS} days, ${runs} ${runs === 1 ? "run" : "runs"}` : `Last ${DAYS} days`;
  const sums = new Map<string, number>();
  for (const b of inWindow)
    for (const [key, g] of Object.entries(b.groups)) sums.set(key, (sums.get(key) ?? 0) + g.usd);
  const parts = [...sums].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  // One hue, darkest for the largest: the split is a magnitude, and the design system has one accent.
  const tint = (rank: number): string => `${Math.max(18, 100 - rank * 22)}%`;
  const share = pick<HTMLElement>("[data-spend-share]");
  share?.setAttribute(
    "aria-label",
    `Spend by service: ${parts.map(([k, v]) => `${nameOf(k)} ${usd(v)}`).join(", ")}`,
  );
  share?.replaceChildren(
    ...parts.map(([key, value], rank) => {
      const seg = element("span", "ov-share-seg");
      seg.style.flexGrow = String(value);
      seg.style.setProperty("--tint", tint(rank));
      seg.title = `${nameOf(key)} ${usd(value)}`;
      return seg;
    }),
  );
  pick<HTMLElement>("[data-spend-legend]")?.replaceChildren(
    ...parts.map(([key, value], rank) => {
      const item = element("li", "ov-legend-item");
      const swatch = element("span", "ov-swatch");
      swatch.style.setProperty("--tint", tint(rank));
      item.append(
        swatch,
        element("span", "ov-legend-name", nameOf(key)),
        element("span", "ov-legend-value", usd(value)),
        element("span", "ov-legend-share", `${Math.round((value / total) * 100)}%`),
      );
      return item;
    }),
  );
  const unread = [
    body.site === "unavailable" && "the site's own spend",
    body.engine === "unavailable" && "the engine's ledger",
    body.billing === "unavailable" && "Anthropic's bill",
  ].filter(Boolean);
  const note = pick<HTMLElement>("[data-spend-note]");
  if (note) {
    note.textContent = unread.length ? `Not counted: ${unread.join(", ")} did not answer.` : "";
    note.hidden = unread.length === 0;
  }
  drawWeek(body);
  root.removeAttribute("data-loading");
}

// ---- asking ----------------------------------------------------------------------------------

/** A card whose ask failed and has nothing kept says so where its answer would be; the banner above
    says why (lib/problem.ts). */
function failed(selector: string): void {
  const root = pick<HTMLElement>(selector);
  if (!root) return;
  root.removeAttribute("data-loading");
  root.dataset.failed = "";
  const title = root.querySelector<HTMLElement>("[data-quad-name], [data-spend-total]");
  if (title) title.textContent = "No answer";
  const sub = root.querySelector<HTMLElement>("[data-quad-sub], [data-spend-sub]");
  if (sub) sub.textContent = "";
}

// Each card paints this device's last answer at once and the fresh one when it lands (lib/kept.ts);
// only a card with neither says it did not answer.
void askKept<HealthBody>("/api/health", "health", (body) => renderHealth(body, PILLARS), {
  title: "Health checks didn't load",
}).then((asked) => {
  if (!asked.shown) failed("[data-overview-health]");
});
void askKept<CostBody>(`/api/costs?period=day&by=provider&days=${DAYS}`, "spend", renderSpend, {
  title: "Spend didn't load",
}).then((asked) => {
  if (!asked.shown) failed("[data-overview-spend]");
});
