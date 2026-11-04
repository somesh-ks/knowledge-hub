import { describe, expect, it } from "vitest";
import { contrastRatio, hexToOklch } from "./color.js";
import { glyphSheet } from "./glyphs.js";
import { COVER_SLOTS, coverCentre, renderLiveCoverSvg } from "./live.js";
import type { CoverMode } from "./mode.js";
import { pickCover } from "./pick.js";
import { STYLE_RULES, styleHex } from "./style.js";
import type { CoverKind, CoverMeta, CoverSpec } from "./types.js";

/**
 * A style recolours a cover in the page's CSS, so nothing is drawn per style and the one thing that
 * can fail silently is a month whose type stops reading under a style (D314). These cover every month
 * the schemes have, every kind and both themes, through the formula `cover.css` writes in CSS.
 */

const KINDS: CoverKind[] = ["regular", "weekly", "on-demand", "episode"];
const MONTHS = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"];

interface Slot {
  light: string;
  dark: string;
  held: boolean;
}

/** What the page reads from a live cover: its slots, whether each is held to the ground, its centre. */
function slotsOf(svg: string): { slots: Slot[]; centre: number } {
  const number = (name: string): string =>
    new RegExp(`--${name}:(#[0-9a-f]{6})`).exec(svg)?.[1] ?? "";
  const held = new Set(
    [...svg.matchAll(/class="[ks] [ks](\d) h"/g)].map((match) => Number(match[1])),
  );
  const slots: Slot[] = [];
  for (let i = 0; i < COVER_SLOTS; i += 1) {
    const light = number(`k${i}`);
    if (!light) break;
    slots.push({ light, dark: number(`k${i}d`), held: held.has(i) });
  }
  return { slots, centre: Number(/--ctr:([\d.]+)/.exec(svg)?.[1]) };
}

function specs(): Array<{ spec: CoverSpec; meta: CoverMeta }> {
  const out: Array<{ spec: CoverSpec; meta: CoverMeta }> = [];
  for (const month of MONTHS) {
    for (const day of [2, 5, 9, 12, 16, 20, 24, 28]) {
      for (const kind of KINDS) {
        const date = `${month}-${String(day).padStart(2, "0")}`;
        const meta: CoverMeta = { id: `${kind}-${date}`, date, kind };
        out.push({ spec: pickCover({ ...meta }), meta });
      }
    }
  }
  return out;
}

describe("a live cover", () => {
  it("names every colour as a slot the page's CSS covers, and letters itself from the sheet", () => {
    for (const { spec, meta } of specs()) {
      const svg = renderLiveCoverSvg(spec, meta);
      const { slots } = slotsOf(svg);
      expect(slots.length, meta.id).toBeGreaterThan(1);
      expect(slots.length, meta.id).toBeLessThanOrEqual(COVER_SLOTS);
      expect(svg, meta.id).not.toMatch(/(?:fill|stroke)="#/);
      expect(svg, meta.id).not.toContain("<text");
    }
  });

  it("has an outline in the sheet for every glyph it uses", () => {
    const sheet = glyphSheet();
    const used = new Set<string>();
    for (const { spec, meta } of specs()) {
      for (const match of renderLiveCoverSvg(spec, meta).matchAll(/#(g\d-[0-9a-f]+)"/g)) {
        used.add(match[1] as string);
      }
    }
    expect(used.size).toBeGreaterThan(20);
    for (const id of used) expect(sheet, id).toContain(`id="${id}"`);
  });
});

describe("every style on every month", () => {
  const modes: CoverMode[] = ["light", "dark"];

  it("keeps type and figures reading on the ground where they read before", () => {
    let held = 0;
    for (const { spec, meta } of specs()) {
      const svg = renderLiveCoverSvg(spec, meta);
      const { slots, centre } = slotsOf(svg);
      expect(centre, meta.id).toBeCloseTo(coverCentre(spec, meta), 1);
      for (const [style, rule] of STYLE_RULES) {
        for (const mode of modes) {
          const hex = (slot: Slot) => (mode === "light" ? slot.light : slot.dark);
          const ground = slots[0] as Slot;
          const groundL = hexToOklch(hex(ground)).l;
          const styled = (slot: Slot) =>
            styleHex(rule, {
              base: hexToOklch(hex(slot)),
              centre,
              mode,
              ...(slot.held ? { ground: groundL } : {}),
            });
          const styledGround = styled(ground);
          for (const slot of slots.filter((candidate) => candidate.held)) {
            const was = contrastRatio(hex(slot), hex(ground));
            // Type must keep 4.5, a figure 3, where it had them; anything lower was not type to begin with.
            const floor = was >= 4.5 ? 4.5 : was >= 3 ? 3 : 0;
            if (floor === 0) continue;
            held += 1;
            expect(
              contrastRatio(styled(slot), styledGround),
              `${meta.id} ${mode} ${style} ${hex(slot)} on ${hex(ground)}`,
            ).toBeGreaterThanOrEqual(floor);
          }
        }
      }
    }
    expect(held).toBeGreaterThan(500);
  });

  it("gives every style its own look, and Default none", () => {
    const { spec, meta } = specs()[7] as { spec: CoverSpec; meta: CoverMeta };
    const { slots, centre } = slotsOf(renderLiveCoverSvg(spec, meta));
    const base = hexToOklch((slots[0] as Slot).light);
    const looks = [...STYLE_RULES.values()].map((rule) =>
      styleHex(rule, { base, centre, mode: "light" }),
    );
    expect(new Set(looks).size).toBe(looks.length);
    expect(looks).not.toContain((slots[0] as Slot).light);
  });

  it("moves a style's whole look with a reader's hue", () => {
    const { spec, meta } = specs()[7] as { spec: CoverSpec; meta: CoverMeta };
    const { slots, centre } = slotsOf(renderLiveCoverSvg(spec, meta));
    const base = hexToOklch((slots[0] as Slot).light);
    const [rule] = [...STYLE_RULES.values()];
    if (!rule) throw new Error("no style rules");
    const at = (shift: number) =>
      hexToOklch(styleHex(rule, { base, centre, mode: "light", shift }));
    const hueOf = (shift: number) => at(shift).h;
    const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;
    expect(Math.abs(turn(hueOf(0), hueOf(90)))).toBeGreaterThan(40);
  });
});
