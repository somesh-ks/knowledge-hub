/**
 * The overview's numbers. Asks the reader's /api/health and /api/costs (the same origin once the
 * command center is served beside the reader) and fills the static shell: nothing moves when the
 * answers arrive, and a failed ask says so in place. Plain DOM and one inline SVG, as the reader's
 * own pages do it (costsPage.ts, healthPage.ts, beside this file).
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
/** The week strip: the last seven days, the most the phone's width gives a 44px press each. */
const WEEK = 7;
/** The ring's geometry in its 200 unit square: arcs on one radius, a stroke wide, with gaps. */
const RING = { c: 100, r: 84, stroke: 5, groupGap: 12 };

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
const glyph = (tone: Tone | "more"): Node | null =>
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
  drawQuads(judged, body.attention.count === 0 ? "good" : body.attention.tone);
  root.removeAttribute("data-loading");
}

/** A point on the ring, `deg` clockwise from the top. */
const at = (deg: number, r: number = RING.r): [number, number] => [
  RING.c + r * Math.sin((deg * Math.PI) / 180),
  RING.c - r * Math.cos((deg * Math.PI) / 180),
];

interface Judged {
  title: string;
  items: Array<{ label: string; row: HealthBody["rows"][number] }>;
}

const isFlag = (tone: Tone): boolean => tone === "warn" || tone === "bad";

/** One check's line, or the line that opens the fine ones: a count and a chevron. */
function fineLine(words: string, rows: HTMLElement[]): HTMLElement {
  const box = element("details", "ov-fine");
  const head = element("summary", "ov-fine-head");
  const icon = element("span", "ov-flag-icon");
  const mark = glyph("good");
  if (mark) icon.append(mark);
  const chevron = element("span", "ov-fine-chevron");
  const more = glyph("more");
  if (more) chevron.append(more);
  head.append(icon, element("span", "ov-flag-name", words), chevron);
  const list = element("ul", "ov-flags");
  list.setAttribute("role", "list");
  for (const row of rows) {
    const li = element("li", "ov-flag-item");
    li.append(row);
    list.append(li);
  }
  box.append(head, list);
  return box;
}

/**
 * The ring: one arc a judged group, in the tone of its worst check, its name and state beside it.
 * A press on an arc, or on its name, opens that group's report: what needs a look in full, the
 * fine ones behind one line (open when nothing needs a look). The worst group is open on arrival.
 * Nothing moves under it: the report keeps the room of the tallest group's first view.
 */
function drawQuads(judged: Judged[], level: Tone): void {
  const svg = pick<SVGSVGElement>("[data-ring-svg]");
  const ring = pick<HTMLElement>("[data-ring]");
  const holder = pick<HTMLElement>("[data-quads]");
  const report = pick<HTMLElement>("[data-health-groups]");
  if (!svg || !ring || !holder || !report) return;
  const groups = judged.filter((g) => g.items.length);
  if (!groups.length) return;
  const tones = groups.map((g) =>
    g.items.reduce<Tone>((w, i) => (WEIGHT[i.row.tone] < WEIGHT[w] ? i.row.tone : w), "good"),
  );
  const flaggedIn = groups.map((g) => g.items.filter((i) => isFlag(i.row.tone)).length);
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  const flaggedTotal = flaggedIn.reduce((sum, n) => sum + n, 0);
  holder.setAttribute(
    "aria-label",
    flaggedTotal
      ? `Groups, ${flaggedTotal} of ${total} checks flagged`
      : `Groups, all ${total} checks fine`,
  );
  const slice = 360 / groups.length;
  const cap = (RING.stroke / 2 / RING.r) * (180 / Math.PI);
  svg.querySelector(".ov-arcs")?.remove();
  const arcs = svgEl("g", { class: "ov-arcs" });
  groups.forEach((_, i) => {
    const from = i * slice + RING.groupGap / 2 + cap;
    const to = (i + 1) * slice - RING.groupGap / 2 - cap;
    const [x0, y0] = at(from);
    const [x1, y1] = at(to);
    arcs.append(
      svgEl("path", {
        class: "ov-arc",
        d: `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${RING.r} ${RING.r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
        pathLength: 1,
        "data-tone": tones[i] ?? "none",
        style: `--i:${i}`,
      }),
    );
  });
  svg.append(arcs);
  const paths = [...arcs.querySelectorAll<SVGElement>(".ov-arc")];

  const nameEl = pick<HTMLElement>("[data-quad-name]");
  const subEl = pick<HTMLElement>("[data-quad-sub]");
  const radios: HTMLInputElement[] = [];
  // The report's room: the most lines any group shows at first (its flags and the fine line), a touch target each.
  const lines = flaggedIn.map((n) => n + 1);
  report.style.setProperty("--rows", String(Math.max(...lines)));
  const open = (i: number): void => {
    const g = groups[i];
    if (!g) return;
    for (const [at2, p] of paths.entries()) p.toggleAttribute("data-on", at2 === i);
    for (const [at2, r] of radios.entries()) r.checked = at2 === i;
    const flags = g.items
      .filter((x) => isFlag(x.row.tone))
      .sort((a, b) => WEIGHT[a.row.tone] - WEIGHT[b.row.tone]);
    const fine = g.items.filter((x) => !isFlag(x.row.tone));
    if (nameEl) nameEl.textContent = g.title;
    if (subEl)
      subEl.textContent = flags.length
        ? `${fine.length} of ${g.items.length} fine`
        : `All ${g.items.length} fine`;
    const list = element("ul", "ov-flags");
    list.setAttribute("role", "list");
    for (const item of flags) {
      const li = element("li", "ov-flag-item");
      li.append(flagged(item.label, item.row));
      list.append(li);
    }
    const body: HTMLElement[] = [...(flags.length ? [list] : [])];
    if (fine.length)
      body.push(
        fineLine(
          flags.length ? `${fine.length} fine` : `All ${fine.length} fine`,
          fine.map((x) => flagged(x.label, x.row)),
        ),
      );
    report.replaceChildren(...body);
  };
  holder.replaceChildren(
    ...groups.map((g, i) => {
      const label = element("label", "ov-quad");
      // The label sits where its arc does: out from the middle along the arc's own bearing.
      const mid = (i + 0.5) * slice;
      label.style.setProperty("--x", Math.sin((mid * Math.PI) / 180).toFixed(3));
      label.style.setProperty("--y", (-Math.cos((mid * Math.PI) / 180)).toFixed(3));
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "ov-quad";
      input.addEventListener("change", () => open(i));
      radios.push(input);
      const bad = g.items.filter((x) => x.row.tone === "bad").length;
      const warn = (flaggedIn[i] ?? 0) - bad;
      const state = !flaggedIn[i]
        ? "Fine"
        : bad && warn
          ? `${flaggedIn[i]} flagged`
          : bad
            ? `${bad} failing`
            : `${warn} to check`;
      const sub = element("span", "ov-quad-sub");
      sub.dataset.tone = flaggedIn[i] ? (tones[i] ?? "none") : "none";
      // Colour is not the only sign: a group that needs a look carries its tone's glyph, a fine one none.
      const mark = flaggedIn[i] ? glyph(tones[i] ?? "none") : null;
      if (mark) sub.append(mark);
      sub.append(state);
      label.append(input, element("span", "ov-quad-name", g.title), sub);
      return label;
    }),
  );
  svg.onpointerdown = (event) => {
    const box = svg.getBoundingClientRect();
    const k = 200 / box.width;
    const dx = (event.clientX - box.left) * k - RING.c;
    const dy = (event.clientY - box.top) * k - RING.c;
    if (Math.hypot(dx, dy) < 52) return;
    const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    open(Math.min(groups.length - 1, Math.floor(deg / slice)));
  };
  const worst = tones.reduce((w, t, i) => (WEIGHT[t] < WEIGHT[tones[w] ?? "none"] ? i : w), 0);
  open(level === "good" ? 0 : worst);
  ring.dataset.drawn = "";
}

// ---- spend -----------------------------------------------------------------------------------

interface Day {
  date: string;
  usd: number;
  runs: number;
  groups: Array<[string, number]>;
}

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
    if (figure) figure.textContent = day.runs ? usd(day.usd) : "No runs";
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
  const open = days.reduce((a, d, i) => (d.runs ? i : a), WEEK - 1);
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
        `${last ? "Today" : dayLabel(day.date)}: ${day.runs ? usd(day.usd) : "no runs"}`,
      );
      input.addEventListener("change", () => pickDay(day, last));
      const dial = svgEl("svg", { class: "ov-dial", viewBox: "0 0 28 28", "aria-hidden": "true" });
      dial.append(
        svgEl("circle", { class: "ov-dial-track", cx: 14, cy: 14, r: 11 }),
        svgEl("circle", {
          class: "ov-dial-fill",
          cx: 14,
          cy: 14,
          r: 11,
          pathLength: 1,
          style: `--fill:${day.runs ? Math.max(0.06, day.usd / max).toFixed(3) : 0};--i:${i}`,
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
  const title = root.querySelector<HTMLElement>("[data-quad-name], [data-spend-total]");
  if (title) title.textContent = "No answer";
  const sub = root.querySelector<HTMLElement>("[data-quad-sub], [data-spend-sub]");
  if (sub) sub.textContent = "";
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
