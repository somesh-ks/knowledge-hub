/**
 * The overview's numbers. Asks the reader's /api/health and /api/costs (the same origin once the
 * command center is served beside the reader) and fills the static shell: nothing moves when the
 * answers arrive, and a failed ask says so in place. Plain DOM and one inline SVG, as the reader's
 * own pages do it (scripts/costsPage.ts, healthPage.ts).
 */

type Tone = "good" | "warn" | "bad" | "none";
interface HealthBody {
  attention: { count: number; tone: Tone };
  parts?: { content?: string; database?: string; github?: string };
  tiles: Record<string, string>;
  rows: Array<{ id: string; value: string; detail: string; tone: Tone }>;
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
const PAD = { top: 8, bottom: 24, left: 36 };
const GAP = 2;

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
const tile = (value: string, label: string): HTMLElement => {
  const item = element("li", "stat-tile");
  item.append(
    element("strong", "stat-tile-value", value),
    " ",
    element("span", "stat-tile-label", label),
  );
  return item;
};
const row = (label: string, hint: string, value: string, tone?: Tone): HTMLElement => {
  const item = element("div", "settings-row health-row");
  const text = element("span", "settings-text");
  text.append(element("span", "settings-label", label), element("span", "settings-hint", hint));
  const reading = element("span", "health-value");
  if (tone && tone !== "none") {
    const dot = element("span", "status-dot");
    dot.dataset.tone = tone;
    reading.append(dot);
  }
  reading.append(value);
  item.append(text, reading);
  return item;
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

function renderHealth(body: HealthBody, labels: Record<string, string>): void {
  const root = pick<HTMLElement>("[data-overview-health]");
  if (!root) return;
  const { count, tone } = body.attention;
  const words = pick<HTMLElement>("[data-attention]");
  if (words)
    words.textContent =
      count === 0
        ? "All good"
        : count === 1
          ? "One thing needs attention"
          : `${count} things need attention`;
  pick<HTMLElement>("[data-attention-dot]")?.setAttribute("data-tone", count === 0 ? "good" : tone);
  for (const el of root.querySelectorAll<HTMLElement>("[data-health-tile]")) {
    el.textContent = body.tiles[el.dataset.healthTile ?? ""] ?? "No data";
  }
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
  const rows = body.rows.filter((r) => r.tone === "warn" || r.tone === "bad");
  const list = pick<HTMLElement>("[data-attention-rows]");
  list?.prepend(...rows.map((r) => row(labels[r.id] ?? r.id, r.detail, r.value, r.tone)));
  root.removeAttribute("data-loading");
}

// ---- spend -----------------------------------------------------------------------------------

/** The axis top: the tallest column rounded up to 2, 4, 6, 8 or 10 of its own tens, so the middle tick is whole too. */
function niceTop(max: number): number {
  const unit = 10 ** Math.floor(Math.log10(max || 1));
  return ([2, 4, 6, 8, 10].find((m) => m * unit >= max) ?? 10) * unit;
}

function drawChart(body: CostBody): void {
  const plot = pick<HTMLElement>("[data-spend-plot]");
  if (!plot) return;
  const end = today(body.time_zone);
  const days = Array.from({ length: DAYS }, (_, i) => shift(end, i - (DAYS - 1)));
  const byDay = new Map(body.report.buckets.map((b) => [b.bucket, b]));
  const max = Math.max(0, ...days.map((d) => byDay.get(d)?.total.usd ?? 0));
  const top = niceTop(max);
  const width = plot.clientWidth;
  const height = plot.clientHeight;
  const inner = { w: width - PAD.left, h: height - PAD.top - PAD.bottom };
  const band = inner.w / DAYS;
  const svg = svgEl("svg", {
    class: "costs-svg",
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    "aria-hidden": "true",
  });
  const grid = svgEl("g", { class: "costs-grid" });
  for (const share of [0, 0.5, 1]) {
    const y = PAD.top + inner.h * (1 - share);
    grid.append(svgEl("line", { x1: PAD.left, x2: width, y1: y, y2: y }));
    const label = svgEl("text", { x: PAD.left - 8, y: y + 4, "text-anchor": "end" });
    label.textContent = `$${+(top * share).toFixed(2)}`;
    grid.append(label);
  }
  svg.append(grid);
  const columns = svgEl("g", { class: "costs-columns" });
  days.forEach((date, i) => {
    const usdDay = byDay.get(date)?.total.usd ?? 0;
    const h = top > 0 ? (usdDay / top) * inner.h : 0;
    const x = PAD.left + i * band + GAP / 2;
    if (h > 0) {
      const mark = svgEl("rect", {
        class: "costs-mark",
        x,
        y: PAD.top + inner.h - h,
        width: Math.max(1, band - GAP),
        height: h,
        rx: 2,
      });
      columns.append(mark);
    }
    if (i === 0 || i === DAYS - 1 || i === Math.round((DAYS - 1) / 2)) {
      const label = svgEl("text", {
        x: PAD.left + i * band + band / 2,
        y: height - 4,
        "text-anchor": i === 0 ? "start" : i === DAYS - 1 ? "end" : "middle",
      });
      label.textContent = dayLabel(date);
      columns.append(label);
    }
  });
  svg.append(columns);
  plot.replaceChildren(svg);
  const peak = days.reduce(
    (a, d) => ((byDay.get(d)?.total.usd ?? 0) > (byDay.get(a)?.total.usd ?? 0) ? d : a),
    days[0] ?? end,
  );
  plot.setAttribute("role", "img");
  plot.setAttribute(
    "aria-label",
    `Spend a day for the last ${DAYS} days, highest ${usd(max)} on ${dayLabel(peak)}`,
  );
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
  const active = inWindow.filter((b) => b.total.usd > 0);
  const totalEl = pick<HTMLElement>("[data-spend-total]");
  if (totalEl) totalEl.textContent = usd(total);
  pick<HTMLElement>("[data-spend-stats]")?.replaceChildren(
    ...(runs > 0
      ? [
          tile(String(runs), runs === 1 ? "run" : "runs"),
          tile(usd(total / runs), "a run"),
          tile(usd(Math.max(0, ...active.map((b) => b.total.usd))), "busiest day"),
          tile(usd(total / Math.max(1, active.length)), "active day"),
        ]
      : []),
  );
  const sums = new Map<string, number>();
  for (const b of inWindow)
    for (const [key, g] of Object.entries(b.groups)) sums.set(key, (sums.get(key) ?? 0) + g.usd);
  const parts = [...sums].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  pick<HTMLElement>("[data-spend-rows]")?.prepend(
    ...parts.map(([key, value]) =>
      row(nameOf(key), `${Math.round((value / total) * 100)}% of the spend`, usd(value)),
    ),
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
  drawChart(body);
  let width = pick<HTMLElement>("[data-spend-plot]")?.clientWidth ?? 0;
  new ResizeObserver(() => {
    const next = pick<HTMLElement>("[data-spend-plot]")?.clientWidth ?? 0;
    if (next !== width) {
      width = next;
      drawChart(body);
    }
  }).observe(root);
  root.removeAttribute("data-loading");
}

// ---- asking ----------------------------------------------------------------------------------

async function ask<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

function failed(selector: string, words: string): void {
  const root = pick<HTMLElement>(selector);
  root?.removeAttribute("data-loading");
  const note = element("p", "settings-note", words);
  root?.querySelector(".card-group")?.append(note);
}

const labels = JSON.parse(pick<HTMLElement>("[data-overview]")?.dataset.labels ?? "{}") as Record<
  string,
  string
>;
void ask<HealthBody>("/api/health").then((body) =>
  body
    ? renderHealth(body, labels)
    : failed("[data-overview-health]", "The health checks did not answer."),
);
void ask<CostBody>(`/api/costs?period=day&by=provider&days=${DAYS}`).then((body) =>
  body ? renderSpend(body) : failed("[data-overview-spend]", "The costs did not answer."),
);
