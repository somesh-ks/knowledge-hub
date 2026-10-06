import { deg } from "./math.js";
import type { Rng } from "./prng.js";
import { n } from "./svg.js";
import type { Point } from "./types.js";

/** Hard-edged vector shapes with a signed distance function, so fields can react to their edge. */

export type ShapeKind = "disc" | "ring" | "arch" | "half" | "box" | "diamond" | "triangle";

export interface Shape {
  kind: ShapeKind;
  /** Signed distance in px: negative inside. */
  sdf: (p: Point) => number;
  /** SVG for the shape, filled with `fill`. */
  draw: (fill: string) => string;
  /** Shape element(s) for use inside a clipPath, covering the same area as `draw`. */
  clip: string;
}

const circleSdf = (p: Point, c: Point, r: number): number => Math.hypot(p.x - c.x, p.y - c.y) - r;

function boxSdf(p: Point, c: Point, hx: number, hy: number, angle: number): number {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const x = Math.abs(dx * cos - dy * sin) - hx;
  const y = Math.abs(dx * sin + dy * cos) - hy;
  return Math.hypot(Math.max(x, 0), Math.max(y, 0)) + Math.min(Math.max(x, y), 0);
}

function edgeDistance(p: Point, a: Point, b: Point): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  return ((p.x - a.x) * ey - (p.y - a.y) * ex) / Math.hypot(ex, ey);
}

/** A shape of nominal radius `r` centered on `c`. Parameters beyond the kind come from `rng`. */
export function makeShape(rng: Rng, kind: ShapeKind, c: Point, r: number): Shape {
  switch (kind) {
    case "ring": {
      const thickness = r * rng.range(0.28, 0.42);
      const mid = r - thickness / 2;
      return {
        kind,
        sdf: (p) => Math.abs(circleSdf(p, c, mid)) - thickness / 2,
        draw: (fill) =>
          `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(mid)}" fill="none" stroke="${fill}" stroke-width="${n(thickness)}"/>`,
        clip: `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(r)}"/>`,
      };
    }
    case "arch": {
      const hx = r * 0.82;
      const top = c.y - r * 0.2;
      const d = `M${n(c.x - hx)} ${n(c.y + r * 1.2)}V${n(top)}A${n(hx)} ${n(hx)} 0 0 1 ${n(c.x + hx)} ${n(top)}V${n(c.y + r * 1.2)}Z`;
      return {
        kind,
        sdf: (p) =>
          Math.min(
            circleSdf(p, { x: c.x, y: top }, hx),
            boxSdf(p, { x: c.x, y: c.y + r * 0.5 }, hx, r * 0.7, 0),
          ),
        draw: (fill) => `<path d="${d}" fill="${fill}"/>`,
        clip: `<path d="${d}"/>`,
      };
    }
    case "half": {
      const flip = rng.sign();
      const d = `M${n(c.x - r)} ${n(c.y)}A${n(r)} ${n(r)} 0 0 ${flip > 0 ? 1 : 0} ${n(c.x + r)} ${n(c.y)}Z`;
      return {
        kind,
        sdf: (p) => Math.max(circleSdf(p, c, r), (p.y - c.y) * flip),
        draw: (fill) => `<path d="${d}" fill="${fill}"/>`,
        clip: `<path d="${d}"/>`,
      };
    }
    case "box":
    case "diamond": {
      const diamond = kind === "diamond";
      const angle = diamond ? deg(45) : deg(rng.pick([0, 0, 12, -12]));
      const hx = r * (diamond ? 0.78 : rng.range(0.62, 0.95));
      const hy = r * (diamond ? 0.78 : rng.range(0.62, 1.0));
      const rect = `<rect x="${n(c.x - hx)}" y="${n(c.y - hy)}" width="${n(hx * 2)}" height="${n(hy * 2)}" transform="rotate(${n((angle * 180) / Math.PI, 2)} ${n(c.x)} ${n(c.y)})"`;
      return {
        kind,
        sdf: (p) => boxSdf(p, c, hx, hy, angle),
        draw: (fill) => `${rect} fill="${fill}"/>`,
        clip: `${rect}/>`,
      };
    }
    case "triangle": {
      const angle = deg(rng.range(0, 360));
      const pts = [0, 1, 2].map((i) => ({
        x: c.x + r * 1.1 * Math.cos(angle + (i * Math.PI * 2) / 3),
        y: c.y + r * 1.1 * Math.sin(angle + (i * Math.PI * 2) / 3),
      })) as [Point, Point, Point];
      const list = pts.map((p) => `${n(p.x)} ${n(p.y)}`).join(" ");
      return {
        kind,
        sdf: (p) =>
          Math.max(
            edgeDistance(p, pts[0], pts[1]),
            edgeDistance(p, pts[1], pts[2]),
            edgeDistance(p, pts[2], pts[0]),
          ),
        draw: (fill) => `<polygon points="${list}" fill="${fill}"/>`,
        clip: `<polygon points="${list}"/>`,
      };
    }
    default:
      return {
        kind: "disc",
        sdf: (p) => circleSdf(p, c, r),
        draw: (fill) => `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(r)}" fill="${fill}"/>`,
        clip: `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(r)}"/>`,
      };
  }
}
