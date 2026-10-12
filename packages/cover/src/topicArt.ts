import { allPalettes } from "./palettes.js";
import { hash32, mulberry32 } from "./prng.js";

/** The side of the art's square, in its own units. */
const SIDE = 96;

const esc = (text: string): string => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The first letter or digit of a name, upper case; "?" when it has none. */
export function topicInitial(name: string): string {
  const letter = /[\p{L}\p{N}]/u.exec(name.trim());
  return letter ? letter[0].toUpperCase() : "?";
}

/**
 * A topic's picture: a small square SVG in the covers' language (a flat ground, a quiet field tint, a
 * mid shade and the figure's accent, from the cover palettes) with the topic's initial over it. A
 * pure function of the topic's id and name, so the same topic always has the same picture and a new
 * one gets its own with no request. The id chooses the palette and the composition; the name only
 * gives the letter.
 */
export function topicArt(id: string, name: string): string {
  const rng = mulberry32(hash32(`topic-art:${id}`));
  const palettes = allPalettes();
  const pal = palettes[Math.floor(rng.next() * palettes.length)] ?? palettes[0];
  if (!pal) return "";
  const n = (value: number): string => String(Math.round(value * 10) / 10);
  const shapes: string[] = [];
  const kind = rng.int(0, 2);
  if (kind === 0) {
    // Rings that grow out of one corner.
    const cx = rng.chance(0.5) ? 0 : SIDE;
    const cy = rng.chance(0.5) ? 0 : SIDE;
    const fills = [pal.field, pal.shade, pal.field, pal.accent];
    for (let i = 3; i >= 0; i -= 1) {
      shapes.push(
        `<circle cx="${cx}" cy="${cy}" r="${n(20 + i * rng.range(17, 21))}" fill="${fills[i]}"/>`,
      );
    }
  } else if (kind === 1) {
    // Three overlapping discs.
    const fills = [pal.field, pal.shade, pal.accent];
    for (const fill of fills) {
      shapes.push(
        `<circle cx="${n(rng.range(10, 86))}" cy="${n(rng.range(10, 86))}" r="${n(rng.range(22, 42))}" fill="${fill}" opacity="0.9"/>`,
      );
    }
  } else {
    // Bands across the square, tilted together.
    const tilt = rng.range(-24, 24);
    const gap = SIDE / 4;
    const fills = [pal.field, pal.shade, pal.accent];
    const bands = fills.map(
      (fill, i) =>
        `<rect x="-40" y="${n(i * gap + gap * rng.range(0.5, 1))}" width="${SIDE + 80}" height="${n(gap * rng.range(0.7, 1.1))}" fill="${fill}"/>`,
    );
    shapes.push(`<g transform="rotate(${n(tilt)} 48 48)">${bands.join("")}</g>`);
  }
  const letter = esc(topicInitial(name));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIDE} ${SIDE}" aria-hidden="true" focusable="false" data-palette="${pal.id}">` +
    `<rect width="${SIDE}" height="${SIDE}" fill="${pal.ground}"/>` +
    shapes.join("") +
    `<text x="48" y="48" text-anchor="middle" dominant-baseline="central" font-family="inherit" font-size="44" font-weight="600" fill="${pal.text}">${letter}</text>` +
    `</svg>`
  );
}
