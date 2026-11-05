/**
 * The health summary: one mark a pillar (lib/pillars.ts) in the tone of its worst check, its name and
 * state with it; a press opens that pillar's report under it, and each line of the report links to
 * where the page shows that check (`linkFor`). Two marks draw the same judgement: the Overview's ring
 * (an arc a pillar) and the Health page's tiles and issues (healthSummary.ts), which use its parts.
 * Plain DOM and one inline SVG; the glyphs come from the page's template (StatusGlyphs.astro).
 */
import type { Pillar } from "../lib/pillars";

export type Tone = "good" | "warn" | "bad" | "none";
export interface HealthBody {
  attention: { count: number; tone: Tone };
  rows: Array<{ id: string; value: string; detail: string; tone: Tone }>;
}

const SVG = "http://www.w3.org/2000/svg";
/** The ring's geometry in its 200 unit square: arcs on one radius, a stroke wide, with gaps. */
const RING = { c: 100, r: 84, stroke: 5, groupGap: 12 };

const svgEl = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
};
export const element = (tag: string, className: string, text?: string): HTMLElement => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
/** A copy of a status glyph from the page's template, so no markup is drawn here. */
export const glyph = (tone: Tone | "more"): Node | null =>
  document
    .querySelector<HTMLTemplateElement>("template[data-glyphs]")
    ?.content.querySelector(`[data-glyph="${tone}"] > svg`)
    ?.cloneNode(true) ?? null;

export const WEIGHT: Record<Tone, number> = { bad: 0, warn: 1, good: 2, none: 3 };
export const isFlag = (tone: Tone): boolean => tone === "warn" || tone === "bad";

type Row = HealthBody["rows"][number];
export interface Judged {
  id: string;
  title: string;
  items: Array<{ label: string; row: Row }>;
}

/**
 * One check on one line: its name, then its reading with the glyph right before it, so every name
 * starts on one edge whether or not it is flagged (2026-11-04, the owner); the full line is its tooltip.
 */
export function line(label: string, r: Row, link: string): HTMLElement {
  const item = element("a", "ov-flag");
  item.setAttribute("href", link);
  item.setAttribute("title", r.detail);
  item.dataset.tone = r.tone;
  const value = element("span", "ov-flag-value");
  const mark = isFlag(r.tone) ? glyph(r.tone) : null;
  if (mark) {
    const icon = element("span", "ov-flag-icon");
    icon.append(mark);
    value.append(icon);
  }
  value.append(r.value);
  item.append(element("span", "ov-flag-name", label), value);
  return item;
}

/** The line that opens the fine ones: a count and a chevron. */
function fineLine(words: string, rows: HTMLElement[]): HTMLElement {
  const box = element("details", "ov-fine");
  const head = element("summary", "ov-fine-head");
  const chevron = element("span", "ov-fine-chevron");
  const more = glyph("more");
  if (more) chevron.append(more);
  head.append(element("span", "ov-flag-name", words), chevron);
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

/** A pillar's state in words: "Fine", "N to check", "N failing" or "N to look at" when both. */
export function stateOf(g: Judged): string {
  const bad = g.items.filter((x) => x.row.tone === "bad").length;
  const warn = g.items.filter((x) => x.row.tone === "warn").length;
  return !bad && !warn
    ? "Fine"
    : bad && warn
      ? `${bad + warn} to look at`
      : bad
        ? `${bad} failing`
        : `${warn} to check`;
}

export const toneOf = (g: Judged): Tone =>
  g.items.reduce<Tone>((w, i) => (WEIGHT[i.row.tone] < WEIGHT[w] ? i.row.tone : w), "good");

export function judge(body: HealthBody, pillars: Pillar[]): Judged[] {
  const byId = new Map(body.rows.map((r) => [r.id, r]));
  return pillars
    .map((pillar) => ({
      id: pillar.id,
      title: pillar.title,
      items: pillar.rows
        .map((g) => ({ label: g.label, row: byId.get(g.id) }))
        .filter((x): x is { label: string; row: Row } => !!x.row && x.row.tone !== "none"),
    }))
    .filter((g) => g.items.length);
}

/** Fills the report under the mark with one pillar's checks: what needs a look, then the fine ones folded. */
function fillReport(report: HTMLElement, g: Judged, link: string): void {
  const flags = g.items
    .filter((x) => isFlag(x.row.tone))
    .sort((a, b) => WEIGHT[a.row.tone] - WEIGHT[b.row.tone]);
  const fine = g.items.filter((x) => !isFlag(x.row.tone));
  const list = element("ul", "ov-flags");
  list.setAttribute("role", "list");
  for (const item of flags) {
    const li = element("li", "ov-flag-item");
    li.append(line(item.label, item.row, link));
    list.append(li);
  }
  const parts: HTMLElement[] = [...(flags.length ? [list] : [])];
  if (fine.length)
    parts.push(
      fineLine(
        flags.length ? `${fine.length} fine` : `All ${fine.length} fine`,
        fine.map((x) => line(x.label, x.row, link)),
      ),
    );
  report.replaceChildren(...parts);
}

/** The pillar to open first: the worst, or the first when all are fine. */
const worstOf = (tones: Tone[]): number =>
  tones.reduce((w, t, i) => (WEIGHT[t] < WEIGHT[tones[w] ?? "none"] ? i : w), 0);

/** A radio per pillar, so the arrow keys walk them; `open` runs on a change. */
function radio(name: string, open: () => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "radio";
  input.name = name;
  input.addEventListener("change", open);
  return input;
}

/**
 * Draws the ring into `root` (index.astro's markup) from an answer of /api/health: one arc a pillar,
 * its name and state on the arc's bearing, the open pillar's name in the middle.
 */
export function drawRing(
  root: HTMLElement,
  body: HealthBody,
  pillars: Pillar[],
  linkFor: (pillar: string) => string,
): void {
  const pick = <T extends Element>(selector: string): T | null => root.querySelector<T>(selector);
  const svg = pick<SVGSVGElement>("[data-ring-svg]");
  const ring = pick<HTMLElement>("[data-ring]");
  const holder = pick<HTMLElement>("[data-quads]");
  const report = pick<HTMLElement>("[data-health-groups]");
  if (!svg || !ring || !holder || !report) return;
  const groups = judge(body, pillars);
  if (!groups.length) {
    const name = pick<HTMLElement>("[data-quad-name]");
    if (name) name.textContent = "No checks";
    return;
  }
  const tones = groups.map(toneOf);
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
  report.style.setProperty("--rows", String(Math.max(...flaggedIn.map((n) => n + 1))));
  const open = (i: number): void => {
    const g = groups[i];
    if (!g) return;
    for (const [at2, p] of paths.entries()) p.toggleAttribute("data-on", at2 === i);
    for (const [at2, r] of radios.entries()) r.checked = at2 === i;
    const fine = g.items.filter((x) => !isFlag(x.row.tone)).length;
    if (nameEl) nameEl.textContent = g.title;
    if (subEl)
      subEl.textContent =
        fine < g.items.length ? `${fine} of ${g.items.length} fine` : `All ${g.items.length} fine`;
    fillReport(report, g, linkFor(g.id));
  };
  holder.replaceChildren(
    ...groups.map((g, i) => {
      const label = element("label", "ov-quad");
      // The label sits where its arc does: out from the middle along the arc's own bearing.
      const mid = (i + 0.5) * slice;
      label.style.setProperty("--x", Math.sin((mid * Math.PI) / 180).toFixed(3));
      label.style.setProperty("--y", (-Math.cos((mid * Math.PI) / 180)).toFixed(3));
      const input = radio("ov-quad", () => open(i));
      radios.push(input);
      const sub = element("span", "ov-quad-sub");
      sub.dataset.tone = flaggedIn[i] ? (tones[i] ?? "none") : "none";
      // Colour is not the only sign: a group that needs a look carries its tone's glyph, a fine one none.
      const mark = flaggedIn[i] ? glyph(tones[i] ?? "none") : null;
      if (mark) sub.append(mark);
      sub.append(stateOf(g));
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
  open(worstOf(tones));
  ring.dataset.drawn = "";
}

/** A point on the ring, `deg` clockwise from the top. */
const at = (deg: number, r: number = RING.r): [number, number] => [
  RING.c + r * Math.sin((deg * Math.PI) / 180),
  RING.c - r * Math.cos((deg * Math.PI) / 180),
];
