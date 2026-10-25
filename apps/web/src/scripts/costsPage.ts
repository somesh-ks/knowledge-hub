/**
 * Costs page (/analytics). Asks /api/costs for the report and draws it into one card: the total and
 * its supporting line, a column chart of what each day, week or month cost, and a breakdown by the
 * chosen split, largest first. One series, so one colour: the split lives in the breakdown and the
 * tooltip, not in stacked colours (2026-10-22). Plain DOM and inline SVG, no framework and no chart
 * library: the numbers are one fetch, and this page loads nothing else.
 */
import { BRAND_MARKS } from "../lib/brandMarks";
import { mountSegmentedNav } from "./segmentedNav";

interface Rollup {
  usd: number;
  runs: number;
  shared_usd: number;
  unpriced?: boolean;
}
interface CostResponse {
  time_zone: string;
  prices_as_of: string;
  unconfirmed: string[];
  site: "ok" | "unavailable";
  /** Anthropic's own bill: "off" until the owner sets an Admin key. */
  billing?: "ok" | "unavailable" | "off";
  report: {
    buckets: Array<{ bucket: string; total: Rollup; groups: Record<string, Rollup> }>;
    total: Rollup;
    per_run_usd: number;
    per_user_usd: number;
    users: number;
  };
}
type Period = "day" | "week" | "month";
interface Part {
  key: string;
  label: string;
  usd: number;
  unpriced: boolean;
}

const SVG = "http://www.w3.org/2000/svg";
// The plot box's height comes from costs.css (12rem, 15rem from 40rem), the axis labels included;
// the pads match the empty note's inset there.
const PAD = { top: 8, right: 0, bottom: 32, left: 40 };
// Columns are at most 24px and keep a 2px gap to the next (the dataviz mark spec).
const BAR_MAX = 24;
const GAP = 2;
const RADIUS = 4;

const NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  exa: "Exa",
  firecrawl: "Firecrawl",
  gemini: "Gemini",
  speechify: "Speechify",
  typesafe: "TypeSafe",
  daily: "Daily",
  weekly: "Weekly",
  catch_up: "Catch up",
  on_demand: "Episodes on request",
  narration_on_play: "Narration on Play",
  config: "Settings changes",
  outside_app: "Outside the app",
  shared: "Shared editions",
  owner: "You",
};
const SPLIT_HEAD: Record<string, string> = {
  provider: "By provider",
  kind: "By use",
  scope: "Shared or own",
  user: "By person",
};
const PER: Record<Period, string> = { day: "day", week: "week", month: "month" };
const WINDOW: Record<Period, string> = {
  day: "the last 30 days",
  week: "the last 3 months",
  month: "the last 12 months",
};

const nameOf = (by: string, key: string): string => {
  if (by === "scope" && key === "user") return "Personal";
  return NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replaceAll("_", " ");
};

/** Dollars, always to the cent; a spend too small to show a cent says so rather than reading as zero. */
const usd = (n: number): string => (n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`);
/** An axis tick: as few places as the step needs. */
const tick = (n: number, step: number): string =>
  `$${n.toFixed(step >= 1 ? 0 : step >= 0.01 ? 2 : 3)}`;
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

const pick = <T extends Element>(selector: string): T | null => document.querySelector<T>(selector);
const svgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
};

// ---- the window ----------------------------------------------------------------------------

function todayIn(zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const shift = (date: string, days: number): string => {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};
const monday = (date: string): string =>
  shift(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Every bucket of the window, oldest first, labelled as the core labels them: so empty ones show. */
function windowBuckets(period: Period, days: number, zone: string): string[] {
  const today = todayIn(zone);
  const out = new Set<string>();
  for (let back = days - 1; back >= 0; back -= 1) {
    const date = shift(today, -back);
    out.add(period === "day" ? date : period === "week" ? monday(date) : date.slice(0, 7));
  }
  return [...out];
}

/** A bucket's name; on the month axis the first label and every January carry the year. */
function bucketLabel(bucket: string, period: Period, long = false, first = false): string {
  const at = new Date(`${bucket.length === 7 ? `${bucket}-01` : bucket}T00:00:00Z`);
  if (period === "month")
    return at.toLocaleDateString("en-GB", {
      month: long ? "long" : "short",
      ...(long || first || at.getUTCMonth() === 0 ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  const day = at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return period === "week" && long ? `Week of ${day}` : day;
}

const longDate = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

// ---- the breakdown -------------------------------------------------------------------------

/** Each group's spend over the window, largest first. */
function partsOf(data: CostResponse, by: string): Part[] {
  const sums = new Map<string, Part>();
  for (const { groups } of data.report.buckets) {
    for (const [key, group] of Object.entries(groups)) {
      const part = sums.get(key) ?? { key, label: nameOf(by, key), usd: 0, unpriced: false };
      part.usd += group.usd;
      part.unpriced ||= Boolean(group.unpriced);
      sums.set(key, part);
    }
  }
  return [...sums.values()].filter((part) => part.usd > 0).sort((a, b) => b.usd - a.usd);
}

/** A clean axis: 0, step, 2 x step, with the top at or above the tallest column. */
function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.5 };
  const raw = max / 2;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
  return { top: step * 2, step };
}

// ---- the chart -----------------------------------------------------------------------------

/** A column with a rounded data end and a square foot on the baseline. */
function column(x: number, y: number, w: number, h: number): SVGPathElement {
  const r = Math.min(RADIUS, w / 2, h);
  const d = `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  return svgEl("path", { d, class: "costs-mark" });
}

interface Drawn {
  buckets: string[];
  period: Period;
  by: string;
  data: CostResponse;
}
let drawn: Drawn | null = null;
let active = -1;
// The first paint of data grows the columns from the baseline (costs.css); a resize or a filter redraw does not.
let growNext = true;

function geometry(width: number, count: number): { band: number; barW: number } {
  const band = (width - PAD.left - PAD.right) / count;
  return { band, barW: Math.max(2, Math.min(BAR_MAX, band - GAP, band * 0.64)) };
}

function draw(): void {
  const plot = pick<HTMLElement>("[data-costs-plot]");
  // A plot with no box (hidden by a failed fetch, load; or its panel out of view in table view,
  // costs.css) still gets its resize here: drawing into zero height wrote a negative rect
  // (2026-10-24). Its resize when it shows again draws it.
  if (!plot || !drawn || plot.clientHeight === 0) return;
  const { buckets, period, data } = drawn;
  plot.querySelector("svg")?.remove();
  const width = Math.max(plot.clientWidth, 240);
  const height = plot.clientHeight;
  const plotH = height - PAD.top - PAD.bottom;
  const byBucket = new Map(data.report.buckets.map((b) => [b.bucket, b]));
  const totals = buckets.map((b) => byBucket.get(b)?.total.usd ?? 0);
  const { top, step } = niceScale(Math.max(0, ...totals));
  const y = (v: number): number => PAD.top + plotH - (v / top) * plotH;
  const { band, barW } = geometry(width, buckets.length);

  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    class: "costs-svg",
    "aria-hidden": "true",
  });

  // The hover column: a ghost wash behind the active band, drawn first so the marks sit over it.
  const wash = svgEl("rect", {
    class: "costs-wash",
    y: PAD.top,
    height: plotH,
    width: band,
    rx: 4,
  });
  wash.setAttribute("visibility", "hidden");
  svg.append(wash);

  // Recessive frame: three solid hairlines and their ticks; an empty range keeps only the baseline,
  // so no scale is invented for spend that does not exist.
  const grid = svgEl("g", { class: "costs-grid" });
  const empty = totals.every((total) => total === 0);
  for (const value of empty ? [0] : [0, step, top]) {
    const at = Math.round(y(value)) + 0.5;
    grid.append(svgEl("line", { x1: PAD.left, x2: width - PAD.right, y1: at, y2: at }));
    const label = svgEl("text", { x: 0, y: at, dy: "0.32em" });
    label.textContent = tick(value, step);
    grid.append(label);
  }
  svg.append(grid);

  const columns = svgEl("g", { class: "costs-columns" });
  buckets.forEach((_, index) => {
    const value = totals[index] ?? 0;
    const group = svgEl("g", { "data-index": index });
    if (value > 0) {
      const x = PAD.left + index * band + (band - barW) / 2;
      const h = Math.max(2, y(0) - y(value));
      group.append(column(x, y(0) - h, barW, h));
    }
    columns.append(group);
  });
  if (growNext && !empty) columns.classList.add("is-growing");
  if (!empty) growNext = false;
  svg.append(columns);

  // A few dates under the axis, evenly spaced back from the newest, as many as fit 72px apart. The
  // newest ends at the plot's edge; one too near the start to sit centred on its column is left out.
  const labels = svgEl("g", { class: "costs-axis" });
  const fit = Math.max(2, Math.floor((width - PAD.left) / 72));
  const every = Math.max(1, Math.ceil(buckets.length / fit));
  for (let index = buckets.length - 1; index >= 0; index -= every) {
    const last = index === buckets.length - 1;
    const cx = PAD.left + index * band + band / 2;
    if (!last && cx < PAD.left + 28) break;
    const text = svgEl("text", {
      x: last ? width - PAD.right : cx,
      y: height - 8,
      "text-anchor": last ? "end" : "middle",
    });
    text.textContent = bucketLabel(buckets[index] ?? "", period, false, index - every < 0);
    labels.append(text);
  }
  svg.append(labels);

  plot.prepend(svg);
  if (active >= 0) focusColumn(active, false);
}

function focusColumn(index: number, announce: boolean): void {
  const plot = pick<HTMLElement>("[data-costs-plot]");
  const tip = pick<HTMLElement>("[data-costs-tip]");
  const wash = plot?.querySelector<SVGRectElement>(".costs-wash");
  if (!plot || !tip || !wash || !drawn) return;
  const { buckets, period, by, data } = drawn;
  active = Math.max(0, Math.min(buckets.length - 1, index));
  const bucket = buckets[active] ?? "";
  const width = plot.clientWidth;
  const { band } = geometry(width, buckets.length);
  wash.setAttribute("x", String(PAD.left + active * band));
  wash.setAttribute("visibility", "visible");
  plot.querySelectorAll(".costs-columns > g").forEach((g, i) => {
    g.classList.toggle("is-active", i === active);
  });

  const entry = data.report.buckets.find((b) => b.bucket === bucket);
  const head = document.createElement("p");
  head.className = "costs-tip-head";
  const value = document.createElement("strong");
  value.textContent = usd(entry?.total.usd ?? 0);
  const when = document.createElement("span");
  when.textContent = bucketLabel(bucket, period, true);
  head.append(value, when);
  // Values lead, names follow; the split is the breakdown's, so the two always agree. One group is
  // the whole total, so the head names it and no split follows.
  const groups = Object.entries(entry?.groups ?? {})
    .filter(([, group]) => group.usd > 0)
    .sort(([, a], [, b]) => b.usd - a.usd);
  const [only] = groups;
  if (groups.length === 1 && only) when.textContent += ` · ${nameOf(by, only[0])}`;
  const rows = (groups.length > 1 ? groups : []).map(([key, group]) => {
    const row = document.createElement("p");
    const amount = document.createElement("strong");
    amount.textContent = usd(group.usd);
    const name = document.createElement("span");
    name.textContent = nameOf(by, key);
    row.append(amount, name);
    return row;
  });
  tip.replaceChildren(head, ...rows);
  tip.hidden = false;
  const center = PAD.left + active * band + band / 2;
  // Beside the column, never over it: to its right while there is room, else to its left.
  const tipW = tip.offsetWidth;
  const right = center + band / 2 + 8;
  const left = center - band / 2 - 8 - tipW;
  const x = right + tipW <= width ? right : left >= 0 ? left : Math.max(0, width - tipW);
  tip.style.translate = `${Math.round(x)}px 0`;
  if (announce) plot.setAttribute("aria-description", tip.textContent ?? "");
}

function clearColumn(): void {
  active = -1;
  const plot = pick<HTMLElement>("[data-costs-plot]");
  const tip = pick<HTMLElement>("[data-costs-tip]");
  plot?.querySelector(".costs-wash")?.setAttribute("visibility", "hidden");
  plot?.querySelectorAll(".costs-columns > g.is-active").forEach((g) => {
    g.classList.remove("is-active");
  });
  if (tip) tip.hidden = true;
}

function wireChart(): void {
  const plot = pick<HTMLElement>("[data-costs-plot]");
  if (!plot) return;
  // A pointer over a column shows it; a tap shows it too, since a touch may send no move first.
  const point = (event: PointerEvent): void => {
    if (!drawn || drawn.data.report.total.usd === 0) return;
    const box = plot.getBoundingClientRect();
    const { band } = geometry(box.width, drawn.buckets.length);
    const index = Math.floor((event.clientX - box.left - PAD.left) / band);
    if (index < 0 || index >= drawn.buckets.length) clearColumn();
    else if (index !== active) focusColumn(index, false);
  };
  plot.addEventListener("pointermove", point);
  plot.addEventListener("pointerdown", point);
  // A lifted finger leaves at once; a tapped column stays shown until a tap elsewhere on the page.
  // Safari does not blur the plot on a tap outside it, so the page listens for that tap itself.
  plot.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch") clearColumn();
  });
  pick<HTMLElement>("[data-costs]")?.addEventListener("pointerdown", (event) => {
    if (!plot.contains(event.target as Node)) clearColumn();
  });
  plot.addEventListener("blur", clearColumn);
  plot.addEventListener("focus", () => {
    if (drawn && active < 0) focusColumn(drawn.buckets.length - 1, true);
  });
  plot.addEventListener("keydown", (event) => {
    if (!drawn) return;
    const moves: Record<string, number> = {
      ArrowLeft: active - 1,
      ArrowRight: active + 1,
      Home: 0,
      End: drawn.buckets.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    focusColumn(next, true);
  });
  new ResizeObserver(() => draw()).observe(plot);
}

// ---- the answer, the breakdown and the table -----------------------------------------------

function renderAnswer(data: CostResponse, period: Period): void {
  const { report } = data;
  const set = (selector: string, text: string): void => {
    const el = pick(selector);
    if (el) el.textContent = text;
  };
  set("[data-costs-total]", usd(report.total.usd));
  renderStats(data, period);
  set("[data-costs-empty]", `No paid runs in ${WINDOW[period]}.`);
}

/** Runs, the average a run, the busiest period and the average a period or a person, as pills. */
function renderStats(data: CostResponse, period: Period): void {
  const list = pick<HTMLElement>("[data-costs-stats]");
  if (!list) return;
  const { report } = data;
  const figures: Array<[string, string]> = [];
  if (report.total.runs > 0) {
    const spans = report.buckets.filter((b) => b.total.usd > 0);
    const peak = Math.max(0, ...spans.map((b) => b.total.usd));
    figures.push(
      [String(report.total.runs), report.total.runs === 1 ? "run" : "runs"],
      [usd(report.per_run_usd), "a run"],
      [usd(peak), `in the busiest ${PER[period]}`],
      report.users > 1
        ? [usd(report.per_user_usd), "a person"]
        : [usd(report.total.usd / Math.max(1, spans.length)), `a ${PER[period]} with runs`],
    );
  }
  list.hidden = figures.length === 0;
  list.replaceChildren(
    ...figures.map(([value, label]) => {
      const item = document.createElement("li");
      item.className = "costs-stat";
      const strong = document.createElement("strong");
      strong.textContent = value;
      const text = document.createElement("span");
      text.textContent = label;
      item.append(strong, text);
      return item;
    }),
  );
}

/** Where a column sits in a sentence: "on 20 Oct", "in the week of 13 Oct", "in August 2026". */
const atBucket = (bucket: string, period: Period): string =>
  period === "day"
    ? `on ${bucketLabel(bucket, period)}`
    : period === "week"
      ? `in the week of ${bucketLabel(bucket, period)}`
      : `in ${bucketLabel(bucket, period, true)}`;

function renderBreakdown(data: CostResponse, by: string): void {
  const list = pick<HTMLElement>("[data-costs-rank]");
  const head = pick("[data-costs-rank-head]");
  if (head) head.textContent = SPLIT_HEAD[by] ?? "Breakdown";
  if (!list) return;
  const parts = partsOf(data, by);
  list.hidden = parts.length === 0;
  const total = data.report.total.usd;
  const most = Math.max(0, ...parts.map((part) => part.usd));
  list.replaceChildren(
    ...parts.map((part) => {
      const item = document.createElement("li");
      item.className = "costs-rank-row";
      const name = document.createElement("span");
      name.className = "costs-rank-name";
      const mark = by === "provider" ? BRAND_MARKS[part.key] : undefined;
      if (mark) {
        const logo = svgEl("svg", {
          viewBox: mark.viewBox,
          class: "costs-rank-mark",
          "aria-hidden": "true",
          focusable: "false",
        });
        logo.append(
          svgEl("path", { d: mark.d, ...(mark.evenodd ? { "fill-rule": "evenodd" } : {}) }),
        );
        name.append(logo);
      }
      const label = document.createElement("span");
      label.textContent = part.unpriced ? `${part.label}, no price yet` : part.label;
      name.append(label);
      const value = document.createElement("span");
      value.className = "costs-rank-value";
      value.textContent = usd(part.usd);
      const share = document.createElement("span");
      share.className = "costs-rank-share";
      share.textContent = total > 0 ? `${Math.round((part.usd / total) * 100)}%` : "";
      const meter = document.createElement("span");
      meter.className = "costs-meter";
      meter.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.className = "costs-meter-fill";
      fill.style.inlineSize = `${most > 0 ? (part.usd / most) * 100 : 0}%`;
      meter.append(fill);
      item.append(name, value, share, meter);
      return item;
    }),
  );
}

/** The chart as a table: each period that spent something, newest first, split as the breakdown. */
function renderTable(now: Drawn): void {
  const table = pick<HTMLTableElement>("[data-costs-grid]");
  if (!table) return;
  const { buckets, period, by, data } = now;
  const parts = partsOf(data, by);
  const byBucket = new Map(data.report.buckets.map((b) => [b.bucket, b]));
  const cell = (tag: "th" | "td", text: string, scope?: string): HTMLElement => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (scope) el.setAttribute("scope", scope);
    return el;
  };
  const head = document.createElement("tr");
  head.append(
    cell("th", period === "day" ? "Day" : period === "week" ? "Week" : "Month", "col"),
    ...parts.map((part) => cell("th", part.label, "col")),
    cell("th", "Total", "col"),
  );
  const rows = [...buckets]
    .reverse()
    .filter((bucket) => (byBucket.get(bucket)?.total.usd ?? 0) > 0)
    .map((bucket) => {
      const entry = byBucket.get(bucket);
      const row = document.createElement("tr");
      row.append(
        cell("th", bucketLabel(bucket, period, true), "row"),
        ...parts.map((part) => cell("td", usd(entry?.groups[part.key]?.usd ?? 0))),
        cell("td", usd(entry?.total.usd ?? 0)),
      );
      return row;
    });
  const thead = document.createElement("thead");
  thead.append(head);
  const tbody = document.createElement("tbody");
  tbody.append(...rows);
  table.replaceChildren(thead, tbody);
  syncTableScroll();
}

/**
 * A table wider than its card scrolls sideways (a phone): then it is a tab stop, so a keyboard can
 * scroll it (WCAG 2.1.1; axe, 2026-10-24). A table that fits adds no dead stop. Run after each render
 * and on every resize of its box, which the table view's first showing is. While it scrolls, its
 * edge fade begins past the pinned period column (--scroll-fade-inset, primitives.css), so the dates
 * stay whole.
 */
function syncTableScroll(): void {
  const scroller = pick<HTMLElement>("[data-costs-table-scroll]");
  if (!scroller) return;
  const overflows = scroller.scrollWidth > scroller.clientWidth;
  if (overflows) scroller.tabIndex = 0;
  else scroller.removeAttribute("tabindex");
  const pinned = scroller.querySelector("table")?.rows[0]?.cells[0];
  if (overflows && pinned)
    scroller.style.setProperty(
      "--scroll-fade-inset",
      `${Math.round(pinned.getBoundingClientRect().width)}px`,
    );
  else scroller.style.removeProperty("--scroll-fade-inset");
}

/** The newest day with a run, kept from the daily view: a week or month bucket only names its start. */
let lastDay = "";

/** Two lines: when the newest run was, and what the figures leave out. */
function renderNote(data: CostResponse, period: Period): void {
  const note = pick("[data-costs-note]");
  if (!note) return;
  const newest = data.report.buckets
    .filter((b) => b.total.usd > 0)
    .map((b) => b.bucket)
    .sort()
    .at(-1);
  if (newest && period === "day") lastDay = newest;
  const day = period === "day" ? (newest ?? "") : lastDay || (newest?.length === 10 ? newest : "");
  const first = document.createElement("p");
  first.textContent = day ? `Last updated ${longDate(day)}` : "Nothing spent yet";
  const second = document.createElement("p");
  second.textContent =
    "This is a rough estimate of days following Swedish time zone. Please note spends on evals and code reviews are not counted yet.";
  note.replaceChildren(first, second);
}

function render(data: CostResponse, period: Period, days: number, by: string): void {
  const buckets = windowBuckets(period, days, data.time_zone);
  const empty = data.report.total.usd === 0;
  drawn = { buckets, period, by, data };
  active = -1;
  // A failed fetch hid the chart, the breakdown's head and the view switch (load); a good answer
  // shows them again before the chart measures its box. The breakdown and the table decide their
  // own below.
  for (const part of document.querySelectorAll<HTMLElement>(
    "[data-costs-plot], [data-costs-rank-head], [data-costs-view]",
  ))
    part.hidden = false;
  renderAnswer(data, period);
  draw();
  clearColumn();
  const plot = pick<HTMLElement>("[data-costs-plot]");
  if (plot) {
    plot.tabIndex = empty ? -1 : 0;
    const byBucket = new Map(data.report.buckets.map((b) => [b.bucket, b.total.usd]));
    const peak = buckets.reduce(
      (best, bucket) => ((byBucket.get(bucket) ?? 0) > (byBucket.get(best) ?? 0) ? bucket : best),
      buckets[0] ?? "",
    );
    plot.setAttribute(
      "aria-label",
      empty
        ? `Spend per ${PER[period]}: nothing spent in ${WINDOW[period]}.`
        : `Spend per ${PER[period]} over ${WINDOW[period]}, ${usd(data.report.total.usd)} in all, the most ${usd(byBucket.get(peak) ?? 0)} ${atBucket(peak, period)}. Use the arrow keys to read each ${PER[period]}.`,
    );
  }
  const blank = pick<HTMLElement>("[data-costs-empty]");
  if (blank) blank.hidden = !empty;
  // With nothing to show, the chart panel and its note stand in for the table too (costs.css).
  pick<HTMLElement>("[data-costs]")?.toggleAttribute("data-empty", empty);
  renderBreakdown(data, by);
  renderTable(drawn);
  const table = pick<HTMLElement>("[data-costs-table]");
  if (table) table.hidden = empty;
  renderNote(data, period);
  // By person means something only once two people share the app.
  const person = pick<HTMLOptionElement>('#costs-by option[value="user"]');
  if (person) person.hidden = data.report.users < 2;
}

// ---- loading -------------------------------------------------------------------------------

/** What a failed fetch hides: the chart, the breakdown, the table and the switch between them. */
const FAILED_PARTS =
  "[data-costs-plot], [data-costs-rank-head], [data-costs-rank], [data-costs-table], [data-costs-view]";

let asked = 0;

async function load(): Promise<void> {
  const range = pick<HTMLSelectElement>("#costs-range");
  const period = (range?.value ?? "day") as Period;
  const days = Number(range?.selectedOptions[0]?.dataset.days ?? "30");
  const by = pick<HTMLSelectElement>("#costs-by")?.value ?? "provider";
  const body = pick<HTMLElement>("[data-costs]");
  const ask = ++asked;
  // A refetch keeps the last frame, dimmed, so nothing jumps while the numbers change.
  body?.setAttribute("data-loading", "");
  try {
    const response = await fetch(`/api/costs?period=${period}&by=${by}&days=${days}`);
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as CostResponse;
    if (ask === asked) render(data, period, days, by);
  } catch {
    if (ask !== asked) return;
    const total = pick("[data-costs-total]");
    if (total) total.textContent = "Unavailable";
    const stats = pick<HTMLElement>("[data-costs-stats]");
    if (stats) stats.hidden = true;
    const note = pick("[data-costs-note]");
    if (note) note.textContent = "The costs could not be loaded right now.";
    // Nothing to draw, so the chart, the breakdown and the table step out: no blank plot, no stray
    // hairline, no empty table on offer, and no frame of the last range left under the failure
    // (audit, 2026-10-24). The next good answer shows them again (render).
    for (const part of document.querySelectorAll<HTMLElement>(FAILED_PARTS)) part.hidden = true;
  } finally {
    if (ask === asked) body?.removeAttribute("data-loading");
  }
}

for (const select of document.querySelectorAll("#costs-range, #costs-by")) {
  select.addEventListener("change", () => void load());
}
wireChart();
// The table's box changes when its view first shows and when the window resizes.
const tableScroll = pick<HTMLElement>("[data-costs-table-scroll]");
if (tableScroll) new ResizeObserver(() => syncTableScroll()).observe(tableScroll);
// Chart or table: the switch at the end of the filter row sets the card's view (costs.css).
const viewSwitch = pick<HTMLElement>("[data-costs-view]");
const costsCard = pick<HTMLElement>("[data-costs]");
if (viewSwitch && costsCard) {
  mountSegmentedNav(viewSwitch, (value) => {
    costsCard.dataset.view = value;
    // At once, not at the table's next resize: on a cold page that came a second late, after a
    // keyboard's Tab into the panel.
    syncTableScroll();
  });
}
void load();
