import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color.js";
import { buildContext } from "./context.js";
import { COVER_MODES } from "./mode.js";
import { pickCover } from "./pick.js";
import { renderCoverSvg } from "./render.js";
import { isMonthly } from "./season.js";
import { COVER_STYLES, hueCentre } from "./style.js";
import type { CoverKind } from "./types.js";

const KINDS: CoverKind[] = ["regular", "weekly", "on-demand", "episode"];
// Two months of every scheme (they cycle by month) and one before the monthly style.
const MONTHS = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"];

function sweep(
  visit: (date: string, kind: CoverKind, mode: "light" | "dark", style: string) => void,
) {
  for (const month of MONTHS) {
    for (const day of [2, 5, 8, 11, 14, 17, 20, 23]) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      for (const kind of KINDS) {
        for (const mode of COVER_MODES) {
          for (const style of COVER_STYLES) visit(date, kind, mode, style);
        }
      }
    }
  }
}

describe("a cover in a style (D311)", () => {
  it("draws Default exactly as the month dressed it", () => {
    const date = "2026-11-08";
    const meta = { id: date, date, kind: "regular" as const, mode: "dark" as const };
    const spec = pickCover(meta);
    expect(renderCoverSvg(spec, { ...meta, style: "default" })).toBe(renderCoverSvg(spec, meta));
  });

  it("draws every other style differently, from the same month", () => {
    const date = "2026-11-08";
    const meta = { id: date, date, kind: "regular" as const, mode: "light" as const };
    const spec = pickCover(meta);
    const svgs = COVER_STYLES.map((style) => renderCoverSvg(spec, { ...meta, style }));
    expect(new Set(svgs).size).toBe(COVER_STYLES.length);
  });

  // The bug this holds: a style that maps hue, chroma or a lightness flip can drop the type or the
  // figure under the contrast floor the month and the theme had kept, and only a cover in that exact
  // month, series and theme shows it.
  it("keeps the figure at 3:1 and the type at 4.5:1 wherever the month held them", () => {
    const failures: string[] = [];
    sweep((date, kind, mode, style) => {
      const monthly = isMonthly(date);
      const meta = { id: date, date, kind, mode };
      const spec = pickCover(meta);
      const base = buildContext(spec, meta, 256, "standard", monthly).ctx;
      const ctx = buildContext(spec, { ...meta, style }, 256, "standard", monthly).ctx;
      const check = (name: string, a: string, b: string, was: [string, string], floor: number) => {
        if (contrastRatio(...was) >= floor && contrastRatio(a, b) < floor) {
          failures.push(
            `${date} ${kind} ${mode} ${style} ${name} ${contrastRatio(a, b).toFixed(2)}`,
          );
        }
      };
      check("figure", ctx.pal.accent, ctx.pal.ground, [base.pal.accent, base.pal.ground], 3);
      check(
        "type",
        ctx.ink,
        ctx.matte ?? ctx.pal.ground,
        [base.ink, base.matte ?? base.pal.ground],
        4.5,
      );
    });
    expect(failures).toEqual([]);
  });
});

describe("hueCentre", () => {
  it("is the chroma-weighted mean hue, so a grey does not pull it", () => {
    expect(hueCentre(["#808080", "#ff0000"])).toBeCloseTo(hueCentre(["#ff0000"]), 0);
  });

  it("wraps around the hue circle", () => {
    // Two reds on either side of 0 degrees centre on red, not on cyan.
    const centre = hueCentre(["#ff0040", "#ff4000"]);
    expect(centre < 60 || centre > 340).toBe(true);
  });
});
