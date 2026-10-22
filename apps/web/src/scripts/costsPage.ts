/**
 * Costs page (/analytics). Asks /api/costs for the report and draws it: the period's total first, one
 * stacked column chart of spend over time split by the chosen grouping, a ranked breakdown that is
 * also the chart's legend, and a table view. Plain DOM and inline SVG, no framework and no chart
 * library: the numbers are one fetch, and this page loads nothing else.
 */
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
  report: {
    buckets: Array<{ bucket: string; total: Rollup; groups: Record<string, Rollup> }>;
    total: Rollup;
    per_run_usd: number;
    per_user_usd: number;
    users: number;
  };
}
type Period = "day" | "week" | "month";
interface Series {
  key: string;
  label: string;
  /** Slot 1 to 4, or 0 for the folded "Other". */
  slot: number;
  usd: number;
  runs: number;
  unpriced: boolean;
  members: string[];
}

const SVG = "http://www.w3.org/2000/svg";
// Past four series the tail folds into "Other": a fifth hue would not stay distinct.
const MAX_SERIES = 4;
const HEIGHT = 200;
const PAD = { top: 8, right: 0, bottom: 24, left: 48 };
const BAR_MAX = 24;
const GAP = 2;
const RADIUS = 4;

// Colour follows the entity, never its rank: a stable order per grouping picks the slots.
const ORDER: Record<string, string[]> = {
  kind: ["daily", "weekly", "catch_up", "on_demand", "narration_on_play", "config"],
  scope: ["shared", "user"],
};
const NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  exa: "Exa",
  firecrawl: "Firecrawl",
  gemini: "Gemini",
  speechify: "Speechify",
  typesafe: "TypeSafe",
  daily: "Daily edition",
  weekly: "Weekly edition",
  catch_up: "Catch-up",
  on_demand: "On demand",
  narration_on_play: "Narration on Play",
  config: "Config",
  shared: "Shared",
  owner: "Owner",
};
const GROUP_HEAD: Record<string, string> = {
  provider: "By provider",
  kind: "By kind",
  scope: "Shared or personal",
  user: "By user",
};
const RANGE_LABEL: Record<Period, string> = {
  day: "Spent in the last 30 days",
  week: "Spent in the last 13 weeks",
  month: "Spent in the last 12 months",
};

const nameOf = (by: string, key: string): string => {
  if (by === "scope" && key === "user") return "Personal";
  return NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replaceAll("_", " ");
};

/** Dollars: cents from a dime up, four places below one (a call often costs a fraction of a cent). */
const usd = (n: number): string => (n === 0 ? "$0.00" : `$${n.toFixed(Math.abs(n) < 0.1 ? 4 : 2)}`);
/** An axis tick: as few places as the step needs. */
const tick = (n: number, step: number): string =>
  `$${n.toFixed(step >= 1 ? 0 : step >= 0.01 ? 2 : 3)}`;

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

// ---- the series ----------------------------------------------------------------------------

function seriesOf(data: CostResponse, by: string): Series[] {
  const sums = new Map<string, Rollup & { unpriced: boolean }>();
  for (const { groups } of data.report.buckets) {
    for (const [key, group] of Object.entries(groups)) {
      const sum = sums.get(key) ?? { usd: 0, runs: 0, shared_usd: 0, unpriced: false };
      sum.usd += group.usd;
      sum.runs += group.runs;
      sum.unpriced ||= Boolean(group.unpriced);
      sums.set(key, sum);
    }
  }
  const ranked = [...sums.entries()].sort(([, a], [, b]) => b.usd - a.usd);
  const kept = ranked.length > MAX_SERIES ? ranked.slice(0, MAX_SERIES - 1) : ranked;
  const order = ORDER[by];
  const stable = [...kept].sort(([a], [b]) =>
    order ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b),
  );
  const slots = new Map(stable.map(([key], index) => [key, index + 1]));
  const series: Series[] = kept.map(([key, sum]) => ({
    key,
    label: nameOf(by, key),
    slot: slots.get(key) ?? 1,
    usd: sum.usd,
    runs: sum.runs,
    unpriced: sum.unpriced,
    members: [key],
  }));
  const rest = ranked.slice(kept.length);
  if (rest.length > 0) {
    series.push({
      key: "__other",
      label: `Other (${rest.length})`,
      slot: 0,
      usd: rest.reduce((n, [, s]) => n + s.usd, 0),
      runs: rest.reduce((n, [, s]) => n + s.runs, 0),
      unpriced: rest.some(([, s]) => s.unpriced),
      members: rest.map(([key]) => key),
    });
  }
  return series;
}

const valueIn = (groups: Record<string, Rollup> | undefined, series: Series): number =>
  series.members.reduce((n, key) => n + (groups?.[key]?.usd ?? 0), 0);

/** A clean axis: 0, step, 2 x step, with the top at or above the tallest column. */
function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.5 };
  const raw = max / 2;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
  return { top: step * 2, step };
}

// ---- the chart -----------------------------------------------------------------------------

/** A column segment with a rounded top when it is the column's data end, square at the baseline. */
function segment(x: number, y: number, w: number, h: number, round: boolean): SVGPathElement {
  const r = round ? Math.min(RADIUS, w / 2, h) : 0;
  const d =
    r > 0
      ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
      : `M${x},${y + h}V${y}H${x + w}V${y + h}Z`;
  return svgEl("path", { d });
}

interface Drawn {
  buckets: string[];
  period: Period;
  series: Series[];
  data: CostResponse;
}
let drawn: Drawn | null = null;
let active = -1;

function draw(): void {
  const plot = pick<HTMLElement>("[data-costs-plot]");
  const tip = pick<HTMLElement>("[data-costs-tip]");
  if (!plot || !tip || !drawn) return;
  const { buckets, series, period, data } = drawn;
  plot.querySelector("svg")?.remove();
  const width = Math.max(plot.clientWidth, 240);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const byBucket = new Map(data.report.buckets.map((b) => [b.bucket, b]));
  const totals = buckets.map((b) => byBucket.get(b)?.total.usd ?? 0);
  const { top, step } = niceScale(Math.max(0, ...totals));
  const y = (v: number): number => PAD.top + plotH - (v / top) * plotH;
  const band = plotW / buckets.length;
  const barW = Math.max(2, Math.min(BAR_MAX, band - GAP * 2, band * 0.72));

  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${HEIGHT}`,
    width,
    height: HEIGHT,
    class: "costs-svg",
    "aria-hidden": "true",
  });

  // Recessive frame: three solid hairlines and their ticks; an empty range keeps only the baseline,
  // so no scale is invented for spend that does not exist.
  const grid = svgEl("g", { class: "costs-grid" });
  const empty = totals.every((total) => total === 0);
  for (const value of empty ? [0] : [0, step, top]) {
    const at = Math.round(y(value)) + 0.5;
    grid.append(svgEl("line", { x1: PAD.left, x2: width - PAD.right, y1: at, y2: at }));
    const label = svgEl("text", { x: PAD.left - 8, y: at, "text-anchor": "end", dy: "0.32em" });
    label.textContent = tick(value, step);
    grid.append(label);
  }
  svg.append(grid);

  // Columns: the series stack in slot order, each segment a 2px surface gap from the next.
  const columns = svgEl("g", { class: "costs-columns" });
  const stackOrder = [...series].sort((a, b) => (a.slot || 99) - (b.slot || 99));
  buckets.forEach((bucket, index) => {
    const groups = byBucket.get(bucket)?.groups;
    const x = PAD.left + index * band + (band - barW) / 2;
    const column = svgEl("g", { "data-index": index });
    const parts = stackOrder
      .map((s) => ({ s, v: valueIn(groups, s) }))
      .filter((part) => part.v > 0);
    let base = 0;
    parts.forEach(({ s, v }, i) => {
      const y0 = y(base);
      const y1 = y(base + v);
      base += v;
      const last = i === parts.length - 1;
      // The gap comes off the top of every segment below the data end.
      const h = Math.max(1, y0 - y1 - (last ? 0 : GAP));
      const mark = segment(x, y0 - h, barW, h, last);
      mark.setAttribute("class", `costs-mark s${s.slot}`);
      column.append(mark);
    });
    columns.append(column);
  });
  svg.append(columns);

  // A few dates under the axis: as many as fit, and always the newest.
  const labels = svgEl("g", { class: "costs-axis" });
  const fit = Math.max(2, Math.floor(plotW / 64));
  const every = Math.ceil(buckets.length / fit);
  buckets.forEach((bucket, index) => {
    const last = index === buckets.length - 1;
    if (!last && (index % every !== 0 || buckets.length - 1 - index < every)) return;
    const cx = PAD.left + index * band + band / 2;
    const anchor = last && band < 40 ? "end" : index === 0 && band < 40 ? "start" : "middle";
    const ax = anchor === "end" ? cx + barW / 2 : anchor === "start" ? cx - barW / 2 : cx;
    const text = svgEl("text", { x: ax, y: HEIGHT - 6, "text-anchor": anchor });
    text.textContent = bucketLabel(bucket, period, false, index === 0);
    labels.append(text);
  });
  svg.append(labels);

  // The hover column: a ghost wash behind the active band.
  const wash = svgEl("rect", { class: "costs-wash", y: PAD.top, height: plotH, width: band });
  wash.setAttribute("visibility", "hidden");
  svg.prepend(wash);

  plot.prepend(svg);
  if (active >= 0) focusColumn(active, false);
}

function focusColumn(index: number, announce: boolean): void {
  const plot = pick<HTMLElement>("[data-costs-plot]");
  const tip = pick<HTMLElement>("[data-costs-tip]");
  const wash = plot?.querySelector<SVGRectElement>(".costs-wash");
  if (!plot || !tip || !wash || !drawn) return;
  const { buckets, series, period, data } = drawn;
  active = Math.max(0, Math.min(buckets.length - 1, index));
  const bucket = buckets[active] ?? "";
  const width = plot.clientWidth;
  const band = (width - PAD.left - PAD.right) / buckets.length;
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
  const rows = series
    .map((s) => ({ s, v: valueIn(entry?.groups, s) }))
    .filter((r) => r.v > 0)
    .map(({ s, v }) => {
      const row = document.createElement("p");
      row.className = "costs-tip-row";
      const key = document.createElement("span");
      key.className = `costs-key s${s.slot}`;
      const amount = document.createElement("strong");
      amount.textContent = usd(v);
      const name = document.createElement("span");
      name.textContent = s.label;
      row.append(key, amount, name);
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
  plot.addEventListener("pointermove", (event) => {
    if (!drawn) return;
    const box = plot.getBoundingClientRect();
    const band = (box.width - PAD.left - PAD.right) / drawn.buckets.length;
    const index = Math.floor((event.clientX - box.left - PAD.left) / band);
    if (index < 0 || index >= drawn.buckets.length) return clearColumn();
    if (index !== active) focusColumn(index, false);
  });
  plot.addEventListener("pointerleave", clearColumn);
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

// ---- the summary, the ranking and the table --------------------------------------------------

function renderSummary(data: CostResponse, period: Period): void {
  const { report } = data;
  const empty = report.total.usd === 0 && report.total.runs === 0;
  const set = (selector: string, text: string): void => {
    const el = pick(selector);
    if (el) el.textContent = text;
  };
  set("[data-costs-spent-label]", RANGE_LABEL[period]);
  set("[data-costs-total]", usd(report.total.usd));
  set("[data-costs-per-run]", report.total.runs > 0 ? usd(report.per_run_usd) : "No runs");
  set("[data-costs-runs]", String(report.total.runs));
  set("[data-costs-per-user]", usd(report.per_user_usd));
  const users = pick<HTMLElement>("[data-costs-users]");
  if (users) users.hidden = report.users < 2;
  const estimate = pick<HTMLElement>("[data-costs-estimate]");
  if (estimate) estimate.hidden = empty || data.unconfirmed.length === 0;
}

function renderRank(series: Series[], data: CostResponse, by: string): void {
  const list = pick<HTMLElement>("[data-costs-rank]");
  const head = pick("[data-costs-rank-head]");
  if (head) head.textContent = GROUP_HEAD[by] ?? "Breakdown";
  if (!list) return;
  const total = data.report.total.usd;
  const unconfirmed = new Set(data.unconfirmed.map((entry) => entry.split("/")[0]));
  const ranked = [...series].sort((a, b) => (a.slot === 0 ? 1 : b.slot === 0 ? -1 : b.usd - a.usd));
  if (ranked.length === 0) {
    const none = document.createElement("li");
    none.className = "costs-rank-none";
    none.textContent = "Nothing to break down yet.";
    list.replaceChildren(none);
    return;
  }
  const most = Math.max(...ranked.map((s) => s.usd));
  list.replaceChildren(
    ...ranked.map((s) => {
      const item = document.createElement("li");
      item.className = "costs-rank-row";
      const key = document.createElement("span");
      key.className = `costs-swatch s${s.slot}`;
      const name = document.createElement("span");
      name.className = "costs-rank-name";
      name.textContent = s.label;
      const estimated =
        s.unpriced || (by === "provider" && s.members.some((key) => unconfirmed.has(key)));
      if (estimated) {
        const tag = document.createElement("span");
        tag.className = "costs-tag";
        tag.textContent = s.unpriced ? "Unpriced" : "Estimate";
        name.append(" ", tag);
      }
      const value = document.createElement("span");
      value.className = "costs-rank-value";
      value.textContent = usd(s.usd);
      const share = document.createElement("span");
      share.className = "costs-rank-share";
      share.textContent = total > 0 ? `${Math.round((s.usd / total) * 100)}%` : "";
      const meter = document.createElement("span");
      meter.className = "costs-meter";
      const fill = document.createElement("span");
      fill.className = `costs-meter-fill s${s.slot}`;
      fill.style.inlineSize = `${most > 0 ? (s.usd / most) * 100 : 0}%`;
      meter.append(fill);
      item.append(key, name, value, share, meter);
      return item;
    }),
  );
}

function renderTable(drawnNow: Drawn): void {
  const table = pick<HTMLTableElement>("[data-costs-grid]");
  if (!table) return;
  const { buckets, series, period, data } = drawnNow;
  const byBucket = new Map(data.report.buckets.map((b) => [b.bucket, b]));
  const cell = (tag: "th" | "td", text: string, scope?: string): HTMLElement => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (scope) el.setAttribute("scope", scope);
    return el;
  };
  const head = document.createElement("tr");
  head.append(
    cell("th", "Period", "col"),
    ...series.map((s) => cell("th", s.label, "col")),
    cell("th", "Total", "col"),
  );
  const rows = [...buckets].reverse().map((bucket) => {
    const entry = byBucket.get(bucket);
    const row = document.createElement("tr");
    row.append(
      cell("th", bucketLabel(bucket, period, true), "row"),
      ...series.map((s) => cell("td", usd(valueIn(entry?.groups, s)))),
      cell("td", usd(entry?.total.usd ?? 0)),
    );
    return row;
  });
  const thead = document.createElement("thead");
  thead.append(head);
  const tbody = document.createElement("tbody");
  tbody.append(...rows);
  table.replaceChildren(thead, tbody);
}

function render(data: CostResponse, period: Period, days: number, by: string): void {
  const series = seriesOf(data, by);
  const buckets = windowBuckets(period, days, data.time_zone);
  const empty = data.report.total.usd === 0;
  drawn = { buckets, series, period, data };
  active = -1;
  renderSummary(data, period);
  draw();
  clearColumn();
  const blank = pick<HTMLElement>("[data-costs-empty]");
  if (blank) blank.hidden = !empty;
  const plot = pick<HTMLElement>("[data-costs-plot]");
  if (plot) {
    plot.tabIndex = empty ? -1 : 0;
    plot.setAttribute(
      "aria-label",
      empty
        ? "Spend over time: nothing spent in this range."
        : `Spend over time, ${usd(data.report.total.usd)} in all. Use the arrow keys to read each column.`,
    );
  }
  renderRank(series, data, by);
  renderTable(drawn);
  const table = pick<HTMLElement>("[data-costs-table]");
  if (table) table.hidden = empty;

  const note = pick("[data-costs-note]");
  if (!note) return;
  const parts = [`Days in ${data.time_zone}. Prices as of ${data.prices_as_of}.`];
  if (data.unconfirmed.length > 0)
    parts.push(`Estimated until confirmed: ${data.unconfirmed.join(", ")}.`);
  if (data.site === "unavailable")
    parts.push("Narration on Play could not be read, so it is left out.");
  note.textContent = parts.join(" ");
}

// ---- loading -------------------------------------------------------------------------------

let asked = 0;

async function load(): Promise<void> {
  const range = pick<HTMLInputElement>('input[name="costs-range"]:checked');
  const period = (range?.value ?? "day") as Period;
  const days = Number(range?.dataset.days ?? "30");
  const by = pick<HTMLSelectElement>("#costs-by")?.value ?? "provider";
  const body = pick<HTMLElement>("[data-costs-body]");
  const ask = ++asked;
  // A refetch keeps the last frame, dimmed, so nothing jumps while the numbers change.
  body?.setAttribute("data-loading", "");
  try {
    const response = await fetch(`/api/costs?period=${period}&by=${by}&days=${days}`);
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as CostResponse;
    if (ask === asked) render(data, period, days, by);
  } catch {
    const total = pick("[data-costs-total]");
    if (total && ask === asked) total.textContent = "Unavailable";
    const note = pick("[data-costs-note]");
    if (note && ask === asked) note.textContent = "The costs could not be loaded right now.";
  } finally {
    if (ask === asked) body?.removeAttribute("data-loading");
  }
}

for (const input of document.querySelectorAll('input[name="costs-range"], #costs-by')) {
  input.addEventListener("change", () => void load());
}
wireChart();
void load();
