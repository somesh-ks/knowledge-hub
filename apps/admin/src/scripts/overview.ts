/**
 * The overview's numbers. Asks the reader's /api/health and /api/costs (the same origin once the
 * command center is served beside the reader) and fills the static shell: nothing moves when the
 * answers arrive, and a failed ask says so in place. Plain DOM and one inline SVG, as the reader's
 * own pages do it (scripts/costsPage.ts, healthPage.ts).
 */

import { href } from "../lib/sections";

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
/** A copy of a status glyph from the page's template (index.astro), so no markup is drawn here. */
const glyph = (tone: Tone): Node | null =>
  pick<HTMLTemplateElement>("template[data-glyphs]")
    ?.content.querySelector(`[data-glyph="${tone}"] > svg`)
    ?.cloneNode(true) ?? null;

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

interface Group {
  id: string;
  title: string;
  rows: Array<{ id: string; label: string }>;
}

const WEIGHT: Record<Tone, number> = { bad: 0, warn: 1, good: 2, none: 3 };

/** One flagged check on one line: its glyph, its name and its reading; the full line is its tooltip. */
function flagged(label: string, r: HealthBody["rows"][number]): HTMLElement {
  const item = element("a", "ov-flag");
  item.setAttribute("href", href("/health"));
  item.setAttribute("title", r.detail);
  item.dataset.tone = r.tone;
  const icon = element("span", "ov-flag-icon");
  const mark = glyph(r.tone);
  if (mark) icon.append(mark);
  item.append(
    icon,
    element("span", "ov-flag-name", label),
    element("span", "ov-flag-value", r.value),
  );
  return item;
}

function renderHealth(body: HealthBody, groups: Group[]): void {
  const root = pick<HTMLElement>("[data-overview-health]");
  if (!root) return;
  const { count, tone } = body.attention;
  const level: Tone = count === 0 ? "good" : tone;
  // A state, never an instruction: the page says how things stand, the lines under it say what.
  const words = pick<HTMLElement>("[data-attention]");
  if (words) words.textContent = count === 0 ? "Healthy" : level === "bad" ? "Failing" : "Degraded";
  const badge = pick<HTMLElement>("[data-badge]");
  if (badge) {
    badge.dataset.tone = level;
    const mark = glyph(level);
    badge.replaceChildren(...(mark ? [mark] : []));
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
  const byId = new Map(body.rows.map((r) => [r.id, r]));
  const judged = groups.map((group) => ({
    title: group.title,
    items: group.rows
      .map((g) => ({ label: g.label, row: byId.get(g.id) }))
      .filter(
        (x): x is { label: string; row: HealthBody["rows"][number] } =>
          !!x.row && x.row.tone !== "none",
      ),
  }));
  // What needs a look is drawn in full, worst first; everything that is fine is a dot in its group's strip.
  const attention = judged
    .flatMap((g) => g.items.map((i) => ({ ...i, label: `${g.title} · ${i.label}` })))
    .filter((i) => i.row.tone === "warn" || i.row.tone === "bad")
    .sort((a, b) => WEIGHT[a.row.tone] - WEIGHT[b.row.tone]);
  const total = judged.reduce((sum, g) => sum + g.items.length, 0);
  const sub = pick<HTMLElement>("[data-health-sub]");
  if (sub)
    sub.textContent =
      count === 0 ? `All ${total} checks passing` : `${count} of ${total} checks flagged`;
  const flags = element("ul", "ov-flags");
  flags.setAttribute("role", "list");
  for (const { label, row } of attention) {
    const li = element("li", "ov-flag-item");
    li.append(flagged(label, row));
    flags.append(li);
  }
  const strips = element("div", "ov-strips");
  for (const group of judged) {
    if (!group.items.length) continue;
    const fine = group.items.filter((i) => i.row.tone === "good").length;
    const line = element("a", "ov-strip");
    line.setAttribute("href", href("/health"));
    line.setAttribute("aria-label", `${group.title}: ${fine} of ${group.items.length} fine`);
    const dots = element("span", "ov-dots");
    for (const { label, row } of group.items.sort(
      (a, b) => WEIGHT[a.row.tone] - WEIGHT[b.row.tone],
    )) {
      const dot = element("span", "status-dot");
      dot.dataset.tone = row.tone;
      dot.title = `${label}: ${row.value}`;
      dots.append(dot);
    }
    line.append(element("span", "ov-strip-name", group.title), dots);
    strips.append(line);
  }
  pick<HTMLElement>("[data-health-groups]")?.replaceChildren(
    ...(attention.length ? [flags] : []),
    strips,
  );
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
  for (const share of [0, 1]) {
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
        "data-i": i,
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
  const tip = element("div", "ov-tip");
  tip.hidden = true;
  plot.replaceChildren(svg, tip);
  const marks = new Map<number, SVGElement>();
  for (const m of columns.querySelectorAll<SVGElement>(".costs-mark"))
    marks.set(Number(m.dataset.i), m);
  svg.addEventListener("pointermove", (event) => {
    const box = svg.getBoundingClientRect();
    const i = Math.floor((event.clientX - box.left - PAD.left) / band);
    if (i < 0 || i >= DAYS) return leave();
    const day = days[i] as string;
    const amount = byDay.get(day)?.total.usd ?? 0;
    for (const [at, m] of marks) m.toggleAttribute("data-on", at === i);
    columns.toggleAttribute("data-hover", true);
    tip.textContent = `${dayLabel(day)}  ${usd(amount)}`;
    tip.hidden = false;
    const x = PAD.left + i * band + band / 2;
    tip.style.insetInlineStart = `${Math.min(Math.max(x, 48), width - 48)}px`;
  });
  const leave = (): void => {
    columns.removeAttribute("data-hover");
    for (const m of marks.values()) m.removeAttribute("data-on");
    tip.hidden = true;
  };
  svg.addEventListener("pointerleave", leave);
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

/** A card whose ask failed says so where its answer would be, and drops what would have drawn on it. */
function failed(selector: string, words: string): void {
  const root = pick<HTMLElement>(selector);
  if (!root) return;
  root.removeAttribute("data-loading");
  root.dataset.failed = "";
  const title = root.querySelector<HTMLElement>("[data-attention], [data-spend-total]");
  if (title) title.textContent = "No answer";
  const sub = root.querySelector<HTMLElement>("[data-health-sub], [data-spend-sub]");
  if (sub) sub.textContent = "";
  const badge = root.querySelector<HTMLElement>("[data-badge]");
  if (badge) {
    badge.dataset.tone = "none";
    const mark = glyph("none");
    badge.replaceChildren(...(mark ? [mark] : []));
  }
  root.querySelector(".card-group")?.append(element("p", "settings-note", words));
}

const groups = JSON.parse(pick<HTMLElement>("[data-overview]")?.dataset.groups ?? "[]") as Group[];
void ask<HealthBody>("/api/health").then((body) =>
  body
    ? renderHealth(body, groups)
    : failed("[data-overview-health]", "The health checks did not answer."),
);
void ask<CostBody>(`/api/costs?period=day&by=provider&days=${DAYS}`).then((body) =>
  body ? renderSpend(body) : failed("[data-overview-spend]", "The costs did not answer."),
);
