import { n } from "../svg.js";

/** Exact-geometry primitives shared by the templates. Every shape is flat: one fill, no filters. */

export function circle(cx: number, cy: number, r: number, fill: string, extra = ""): string {
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${extra}/>`;
}

export function ring(cx: number, cy: number, r: number, width: number, stroke: string): string {
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${stroke}" stroke-width="${n(width)}"/>`;
}

export function rect(x: number, y: number, w: number, h: number, fill: string, rx = 0): string {
  const round = rx > 0 ? ` rx="${n(rx)}"` : "";
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${round} fill="${fill}"/>`;
}

export function polygon(points: ReadonlyArray<readonly [number, number]>, fill: string): string {
  return `<polygon points="${points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ")}" fill="${fill}"/>`;
}
