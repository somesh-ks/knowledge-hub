import { CATEGORIES, COVER_TEMPLATES, CoverSpec } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { DARK_PALETTE_IDS, groundDistance, PALETTE_IDS } from "./palettes.js";
import { pickCover } from "./pick.js";
import { TEMPLATES } from "./templates/index.js";
import type { PickInput } from "./types.js";

function dayId(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
}

function input(offset: number, extra: Partial<PickInput> = {}): PickInput {
  const id = dayId(offset);
  return { id, date: id, kind: "regular", ...extra };
}

describe("pickCover", () => {
  it("is deterministic from the digest id", () => {
    expect(pickCover(input(10))).toEqual(pickCover(input(10)));
    expect(pickCover(input(10))).not.toEqual(pickCover(input(11)));
  });

  it("returns a spec the core schema accepts", () => {
    for (let i = 0; i < 40; i += 1) {
      const spec = pickCover(input(i));
      expect(CoverSpec.safeParse(spec).success).toBe(true);
      expect(PALETTE_IDS).toContain(spec.palette);
    }
  });

  it("exposes the same template list as core", () => {
    expect([...TEMPLATES]).toEqual([...COVER_TEMPLATES]);
  });

  it("never repeats the previous template or palette across 500 consecutive digests", () => {
    let previous: { template: string; palette: string } | undefined;
    for (let i = 0; i < 500; i += 1) {
      const spec = pickCover(input(i, { previous }));
      if (previous) {
        expect(spec.template, `digest ${i}`).not.toBe(previous.template);
        expect(spec.palette, `digest ${i}`).not.toBe(previous.palette);
      }
      previous = { template: spec.template, palette: spec.palette };
    }
  });

  it("uses every template and every palette over a long run", () => {
    const templates = new Set<string>();
    const palettes = new Set<string>();
    let previous: { template: string; palette: string } | undefined;
    for (let i = 0; i < 500; i += 1) {
      const spec = pickCover(input(i, { previous }));
      templates.add(spec.template);
      palettes.add(spec.palette);
      previous = { template: spec.template, palette: spec.palette };
    }
    expect(templates.size).toBe(8);
    expect(palettes.size).toBe(PALETTE_IDS.length);
  });

  it("never repeats a template or palette on consecutive days over a 60-day run", () => {
    let previous: { template: string; palette: string } | undefined;
    for (let i = 0; i < 60; i += 1) {
      const spec = pickCover(input(i, { previous }));
      if (previous) {
        expect(spec.template, `day ${i}`).not.toBe(previous.template);
        expect(spec.palette, `day ${i}`).not.toBe(previous.palette);
      }
      previous = { template: spec.template, palette: spec.palette };
    }
  });

  it("spreads a run so neighbours in a grid rarely match: nothing from the last three covers", () => {
    const history: { template: string; palette: string }[] = [];
    for (let i = 0; i < 120; i += 1) {
      const [previous, ...recent] = history.slice(0, 3);
      const spec = pickCover(input(i, { previous, recent }));
      for (const old of history.slice(0, 3)) {
        expect(spec.template, `day ${i}`).not.toBe(old.template);
        expect(spec.palette, `day ${i}`).not.toBe(old.palette);
      }
      history.unshift({ template: spec.template, palette: spec.palette });
    }
  });

  it("steers away from a palette that looks like the previous one", () => {
    let similar = 0;
    let total = 0;
    let previous: { template: string; palette: string } | undefined;
    for (let i = 0; i < 300; i += 1) {
      const spec = pickCover(input(i, { previous }));
      if (previous) {
        total += 1;
        if (groundDistance(spec.palette, previous.palette) < 0.28) similar += 1;
      }
      previous = { template: spec.template, palette: spec.palette };
    }
    expect(similar / total).toBeLessThan(0.1);
  });

  it("covers a user-made episode with any palette", () => {
    const palettes = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      const spec = pickCover({ ...input(i), id: `${dayId(i)}-2`, kind: "episode" });
      expect(CoverSpec.safeParse(spec).success).toBe(true);
      palettes.add(spec.palette);
    }
    expect(palettes.size).toBe(PALETTE_IDS.length);
  });

  it("draws weekly digests from the dark family, still never repeating the previous palette", () => {
    let previous: { template: string; palette: string } | undefined;
    for (let i = 0; i < 200; i += 1) {
      const id = `${dayId(i * 7)}-weekly`;
      const spec = pickCover({ id, date: dayId(i * 7), kind: "weekly", previous });
      expect(DARK_PALETTE_IDS).toContain(spec.palette);
      if (previous) expect(spec.palette).not.toBe(previous.palette);
      previous = { template: spec.template, palette: spec.palette };
    }
  });

  it("still avoids a regular digest's palette when a weekly follows it", () => {
    const dark = DARK_PALETTE_IDS[0] as string;
    for (let i = 0; i < 60; i += 1) {
      const spec = pickCover({
        id: `${dayId(i)}-weekly`,
        date: dayId(i),
        kind: "weekly",
        previous: { template: "orbit", palette: dark },
      });
      expect(spec.palette).not.toBe(dark);
    }
  });

  const share = (lead: PickInput["lead_category"], templates: string[], runs = 600): number => {
    let hits = 0;
    for (let i = 0; i < runs; i += 1) {
      if (templates.includes(pickCover(input(i, { lead_category: lead })).template)) hits += 1;
    }
    return hits / runs;
  };

  it.each([
    ["design_engineering_craft", ["spring", "contour"]],
    ["css_canvas_motion_techniques", ["spring", "contour"]],
    ["ai_ux_interaction_patterns", ["dither"]],
    ["frontier_model_releases", ["dither"]],
    ["hci_empirical_research", ["contour", "lattice"]],
    ["developer_tool_launches", ["lattice", "aperture"]],
    ["taste_and_design_philosophy", ["orbit", "numeral"]],
    ["consumer_tech_releases", ["aperture", "numeral"]],
    ["watch", ["band"]],
  ] as const)("biases %s toward %j", (lead, favored) => {
    const baseline = favored.length / 8;
    expect(share(lead, [...favored])).toBeGreaterThan(baseline + 0.2);
  });

  it("gives every category with a template bias one and leaves the two without alone", () => {
    const UNBIASED: readonly string[] = ["venture_capital_and_gossip", "generic_ai_hype_listicles"];
    for (const category of CATEGORIES) {
      // An unbiased template is drawn about one time in eight; a favored one at least twice that.
      const favored = TEMPLATES.filter((template) => share(category, [template]) > 0.2);
      if (UNBIASED.includes(category)) expect(favored, category).toEqual([]);
      else expect(favored.length, category).toBeGreaterThanOrEqual(1);
    }
  });

  it("leaves unknown or non-publishing categories unbiased", () => {
    for (const lead of [undefined, "venture_capital_and_gossip"] as const) {
      for (const template of TEMPLATES) {
        const s = share(lead, [template]);
        expect(s, `${lead} ${template}`).toBeGreaterThan(0.06);
        expect(s, `${lead} ${template}`).toBeLessThan(0.2);
      }
    }
  });

  it("keeps bias soft: a biased digest still sometimes picks other templates", () => {
    expect(share("watch", ["band"])).toBeLessThan(0.8);
  });
});
