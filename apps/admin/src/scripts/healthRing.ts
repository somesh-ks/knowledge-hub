/**
 * The health summary: one mark a pillar (lib/pillars.ts) in the tone of its worst check, its name and
 * state with it; a press opens that pillar's report under it, and each line of the report links to
 * where the page shows that check (`linkFor`). Two marks draw the same judgement: the Overview's ring
 * (an arc a pillar) and the Health page's pulse (a heartbeat trace, a beat a pillar, 2026-11-04, the
 * owner: "something health-related"). Plain DOM and one inline SVG; the glyphs come from the page's
 * template (StatusGlyphs.astro).
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
const element = (tag: string, className: string, text?: string): HTMLElement => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
/** A copy of a status glyph from the page's template, so no markup is drawn here. */
const glyph = (tone: Tone | "more"): Node | null =>
  document
    .querySelector<HTMLTemplateElement>("template[data-glyphs]")
    ?.content.querySelector(`[data-glyph="${tone}"] > svg`)
    ?.cloneNode(true) ?? null;

const WEIGHT: Record<Tone, number> = { bad: 0, warn: 1, good: 2, none: 3 };
const isFlag = (tone: Tone): boolean => tone === "warn" || tone === "bad";

type Row = HealthBody["rows"][number];
interface Judged {
  id: string;
  title: string;
  items: Array<{ label: string; row: Row }>;
}

/**
 * One check on one line: its name, then its reading with the glyph right before it, so every name
 * starts on one edge whether or not it is flagged (2026-11-04, the owner); the full line is its tooltip.
 */
function line(label: string, r: Row, link: string): HTMLElement {
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

/** A pillar's state in words: "Fine", "N to check", "N failing" or "N flagged" when both. */
function stateOf(g: Judged): string {
  const bad = g.items.filter((x) => x.row.tone === "bad").length;
  const warn = g.items.filter((x) => x.row.tone === "warn").length;
  return !bad && !warn
    ? "Fine"
    : bad && warn
      ? `${bad + warn} flagged`
      : bad
        ? `${bad} failing`
        : `${warn} to check`;
}

const toneOf = (g: Judged): Tone =>
  g.items.reduce<Tone>((w, i) => (WEIGHT[i.row.tone] < WEIGHT[w] ? i.row.tone : w), "good");

function judge(body: HealthBody, pillars: Pillar[]): Judged[] {
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

/** A beat's state under it, in one word. */
const BEAT_WORD: Record<Tone, string> = {
  good: "Fine",
  warn: "Check",
  bad: "Failing",
  none: "Fine",
};

/** The pulse's geometry: a beat a pillar, each in a box this wide, on one baseline, this tall at most. */
const PULSE = { w: 100, base: 80, h: 70 };

/**
 * One beat in a box from x, on the pulse's baseline. Its shape says its state as well as its tone:
 * fine is a clean spike with its small waves, a check is a low, uneven beat, failing is a sharp drop
 * and a flat line, so colour is never the only sign.
 */
function beat(x: number, tone: Tone): string {
  const { w, base: y, h } = PULSE;
  const c = x + w / 2;
  const p = (dx: number, dy: number): string =>
    `${(c + dx * w).toFixed(1)} ${(y + dy * h).toFixed(1)}`;
  if (tone === "bad")
    return `M${x} ${y} L${p(-0.1, 0)} L${p(-0.04, -0.55)} L${p(0.02, 0.4)} L${p(0.06, 0)} L${x + w} ${y}`;
  if (tone === "warn")
    return `M${x} ${y} L${p(-0.18, 0)} L${p(-0.1, -0.3)} L${p(-0.04, 0.1)} L${p(0.02, -0.45)} L${p(0.08, 0.15)} L${p(0.14, 0)} L${x + w} ${y}`;
  return `M${x} ${y} L${p(-0.22, 0)} Q${p(-0.17, -0.12)} ${p(-0.12, 0)} L${p(-0.05, 0)} L${p(-0.02, 0.12)} L${p(0.01, -0.85)} L${p(0.05, 0.3)} L${p(0.08, 0)} L${p(0.18, 0)} Q${p(0.25, -0.22)} ${p(0.32, 0)} L${x + w} ${y}`;
}

/**
 * Draws the pulse into `root` (health.astro's markup): one heartbeat trace across the card, a beat a
 * pillar in its tone and shape, its name and state under it as a radio; a press on a beat or its name
 * opens that pillar's report under it. The worst is open on arrival.
 */
export function drawPulse(
  root: HTMLElement,
  body: HealthBody,
  pillars: Pillar[],
  linkFor: (pillar: string) => string,
): void {
  const pick = <T extends Element>(selector: string): T | null => root.querySelector<T>(selector);
  const svg = pick<SVGSVGElement>("[data-pulse-svg]");
  const holder = pick<HTMLElement>("[data-beats]");
  const report = pick<HTMLElement>("[data-health-groups]");
  if (!svg || !holder || !report) return;
  const groups = judge(body, pillars);
  const tones = groups.map(toneOf);
  svg.setAttribute("viewBox", `0 0 ${Math.max(1, groups.length) * PULSE.w} 120`);
  const trace = svgEl("g", { class: "hl-trace" });
  groups.forEach((_, i) => {
    trace.append(
      svgEl("path", {
        class: "hl-beat-line",
        d: beat(i * PULSE.w, tones[i] ?? "none"),
        "data-tone": tones[i] ?? "none",
        style: `--i:${i}`,
      }),
    );
  });
  svg.replaceChildren(trace);
  const lines = [...trace.querySelectorAll<SVGElement>(".hl-beat-line")];
  const radios: HTMLInputElement[] = [];
  report.style.setProperty(
    "--rows",
    String(Math.max(1, ...groups.map((g) => g.items.filter((x) => isFlag(x.row.tone)).length + 1))),
  );
  const open = (i: number): void => {
    const g = groups[i];
    if (!g) return;
    for (const [at2, l] of lines.entries()) l.toggleAttribute("data-on", at2 === i);
    for (const [at2, r] of radios.entries()) r.checked = at2 === i;
    fillReport(report, g, linkFor(g.id));
  };
  holder.style.setProperty("--beats", String(groups.length));
  holder.replaceChildren(
    ...groups.map((g, i) => {
      const label = element("label", "hl-beat");
      const input = radio("hl-beat", () => open(i));
      radios.push(input);
      // One word, so five fit under the trace on a phone; the counts are in the report.
      const state = element("span", "hl-beat-state", BEAT_WORD[tones[i] ?? "none"]);
      label.append(input, element("span", "hl-beat-name", g.title), state);
      return label;
    }),
  );
  svg.onpointerdown = (event) => {
    const box = svg.getBoundingClientRect();
    open(
      Math.min(
        groups.length - 1,
        Math.floor(((event.clientX - box.left) / box.width) * groups.length),
      ),
    );
  };
  open(worstOf(tones));
  root.querySelector<HTMLElement>("[data-pulse]")?.setAttribute("data-drawn", "");
}

/** A point on the ring, `deg` clockwise from the top. */
const at = (deg: number, r: number = RING.r): [number, number] => [
  RING.c + r * Math.sin((deg * Math.PI) / 180),
  RING.c - r * Math.cos((deg * Math.PI) / 180),
];
