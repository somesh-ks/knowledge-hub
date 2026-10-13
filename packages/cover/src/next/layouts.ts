import { mixHex } from "../color.js";
import { FONT_STACK } from "../fonts.js";
import { CAP_HEIGHT, measureNumeral } from "../metrics.js";
import { hash32, mulberry32 } from "../prng.js";
import { escapeXml, n } from "../svg.js";
import { shuffled, themeFor } from "./themes.js";
import type { Box, NextCoverInput, Theme } from "./types.js";
import { isoWeek, MONTH_NAMES, parseYmd, rangeLines, WEEKDAY_NAMES, weekdayIndex } from "./week.js";

/**
 * The next cover system: three layers. Layout by kind (this file), theme by year and month
 * (themes.ts), art by episode id (the seeded rng handed to the theme's draw function).
 * The cover is one opaque 1024 square with its own ground, so it sits the same on a light or dark app.
 */
const S = 1024;

function text(
  x: number,
  y: number,
  size: number,
  weight: number,
  fill: string,
  value: string,
  extra = "",
): string {
  return `<text x="${n(x)}" y="${n(y)}" font-family="${FONT_STACK}" font-size="${n(size)}" font-weight="${weight}" fill="${fill}"${extra}>${escapeXml(value)}</text>`;
}

/** Largest size at which the numeral's ink fits `maxInk`, capped at `cap`. */
function fitNumeral(digits: string, maxInk: number, cap: number): { size: number; left: number } {
  const unit = measureNumeral(digits, 900, 1000, -40);
  const size = Math.min(cap, (maxInk / unit.ink) * 1000);
  return { size, left: measureNumeral(digits, 900, size, -0.04 * size).left };
}

/** Daily: art above, a dark type band below. The day of the month is the anchor. */
function daily(input: NextCoverInput, theme: Theme, art: (box: Box) => string): string {
  const { day, month } = parseYmd(input.date);
  const artH = 600;
  const digits = String(day);
  const num = fitNumeral(digits, 560, 400);
  const baseline = S - 56;
  const mute = mixHex(theme.light, theme.dark, 0.35);
  return (
    art({ x: 0, y: 0, w: S, h: artH }) +
    `<rect x="0" y="${artH}" width="${S}" height="${S - artH}" fill="${theme.dark}"/>` +
    text(
      60 - num.left,
      baseline,
      num.size,
      900,
      theme.light,
      digits,
      ` letter-spacing="${n(-0.04 * num.size)}"`,
    ) +
    text(
      S - 60,
      baseline,
      58,
      700,
      theme.light,
      WEEKDAY_NAMES[weekdayIndex(input.date)] ?? "",
      ' text-anchor="end"',
    ) +
    text(S - 60, baseline - 76, 58, 500, mute, MONTH_NAMES[month - 1] ?? "", ' text-anchor="end"')
  );
}

/** Weekly: a pale column on the left, art in a tall panel on the right. The ISO week is the anchor. */
function weekly(input: NextCoverInput, theme: Theme, art: (box: Box) => string): string {
  const col = 450;
  const week = String(isoWeek(input.date));
  const num = fitNumeral(week, col - 100, 330);
  const [line1, line2] = rangeLines(input.date);
  const ink = theme.dark;
  const mute = mixHex(theme.dark, theme.light, 0.38);
  const numBase = 440 + (CAP_HEIGHT * num.size) / 2;
  return (
    `<rect width="${S}" height="${S}" fill="${theme.light}"/>` +
    art({ x: col, y: 0, w: S - col, h: S }) +
    text(56, 150, 120, 900, mixHex(theme.dark, theme.art[0] ?? theme.dark, 0.35), "W") +
    text(
      56 - num.left,
      numBase,
      num.size,
      900,
      ink,
      week,
      ` letter-spacing="${n(-0.04 * num.size)}"`,
    ) +
    text(56, S - 128, 54, 700, ink, line1) +
    text(56, S - 62, 54, 500, mute, line2)
  );
}

/** Largest title size (and its lines) that fits the box, wrapping on words. */
function setTitle(
  title: string,
  width: number,
  maxLines: number,
): { size: number; lines: string[] } {
  const words = title.trim().split(/\s+/);
  for (let size = 190; size >= 64; size -= 6) {
    const perLine = Math.floor(width / (size * 0.58));
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= perLine) current = next;
      else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    if (lines.length <= maxLines && lines.every((l) => l.length <= perLine)) return { size, lines };
  }
  const size = 64;
  const perLine = Math.floor(width / (size * 0.58));
  const all = words.join(" ");
  return {
    size,
    lines: [all.length > perLine * 3 ? `${all.slice(0, perLine * 3 - 1)}…` : all]
      .flatMap((s) => s.match(new RegExp(`.{1,${perLine}}`, "g")) ?? [s])
      .slice(0, 3),
  };
}

/** On demand: full-bleed art under a deep scrim, the title in heavy type. No date anchor. */
function onDemand(
  input: NextCoverInput,
  theme: Theme,
  art: (box: Box) => string,
  uid: string,
): string {
  const title = input.title?.trim();
  if (!title) throw new Error("An on_demand cover needs a title");
  const { size, lines } = setTitle(title, S - 120, 4);
  const lead = size * 1.02;
  const bottom = S - 70;
  const sid = `${uid}s`;
  const scrim = `<defs><linearGradient id="${sid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.dark}" stop-opacity="0"/><stop offset="1" stop-color="${theme.dark}" stop-opacity="0.92"/></linearGradient></defs>`;
  const top = bottom - (lines.length - 1) * lead - CAP_HEIGHT * size;
  const scrimTop = Math.max(0, top - 220);
  let type = "";
  lines.forEach((line, i) => {
    type += text(
      60,
      bottom - (lines.length - 1 - i) * lead,
      size,
      900,
      theme.light,
      line,
      ` letter-spacing="${n(-0.025 * size)}"`,
    );
  });
  return (
    art({ x: 0, y: 0, w: S, h: S }) +
    scrim +
    `<rect x="0" y="${n(scrimTop)}" width="${S}" height="${n(S - scrimTop)}" fill="url(#${sid})"/>` +
    type
  );
}

/** Square cover SVG, viewBox 0 0 1024 1024. A pure function of kind, id, date and title. */
export function renderNextCoverSvg(input: NextCoverInput): string {
  const { year, month } = parseYmd(input.date);
  const theme = themeFor(year, month);
  const uid = `n${hash32(`${input.kind}:${input.id}`).toString(36)}`;
  const rng = mulberry32(hash32(`${theme.id}:${year}-${month}:${input.id}`));
  const colors = { dark: theme.dark, light: theme.light, art: shuffled(rng, theme.art) };
  let defs = "";
  const art = (box: Box): string => {
    const drawn = theme.draw({ box, rng, colors, uid });
    defs += drawn.defs ?? "";
    const clip = `${uid}c`;
    defs += `<clipPath id="${clip}"><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}"/></clipPath>`;
    return `<g clip-path="url(#${clip})">${drawn.body}</g>`;
  };
  const layout =
    input.kind === "daily"
      ? daily(input, theme, art)
      : input.kind === "weekly"
        ? weekly(input, theme, art)
        : onDemand(input, theme, art, uid);
  const label =
    input.kind === "on_demand"
      ? `Singularity, ${input.title ?? "on demand"}`
      : input.kind === "weekly"
        ? `Singularity, week ${isoWeek(input.date)}`
        : `Singularity, ${parseYmd(input.date).day} ${MONTH_NAMES[month - 1]}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="${escapeXml(label)}"><title>${escapeXml(label)}</title><defs>${defs}</defs><rect width="${S}" height="${S}" fill="${theme.dark}"/>${layout}</svg>`;
}
