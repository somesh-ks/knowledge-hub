import { describe, expect, it } from "vitest";
import { computeMorph, coverFrame, MORPH_PROPERTIES, morphStyle, restingBox } from "./coverMorph";

/** A 390x844 phone: the bar's thumbnail, and the page's cover once the page is up. */
const thumb = { left: 8, top: 736, width: 44 };
const slot = { left: 26.2, top: 32, width: 337.6 };

describe("cover morph", () => {
  it("measures both ends once: the bar's thumbnail and the page's cover", () => {
    expect(computeMorph(thumb, slot)).toEqual({
      fromX: 8,
      fromY: 736,
      toX: 26.2,
      toY: 32,
      size: 337.6,
      scale: 44 / 337.6,
    });
  });

  it("sits exactly on the thumbnail when collapsed and exactly on the cover when expanded", () => {
    const morph = computeMorph(thumb, slot);
    if (!morph) throw new Error("no morph");
    const collapsed = coverFrame(0, morph);
    expect(collapsed).toEqual({ x: 8, y: 736, scale: 44 / 337.6 });
    // The scaled cover is exactly as wide as the thumbnail.
    expect(collapsed.scale * morph.size).toBeCloseTo(thumb.width, 10);
    expect(coverFrame(1, morph)).toEqual({ x: 26.2, y: 32, scale: 1 });
  });

  it("travels in a straight line between the two, its size in step", () => {
    const morph = computeMorph(thumb, slot);
    if (!morph) throw new Error("no morph");
    const half = coverFrame(0.5, morph);
    expect(half.x).toBeCloseTo(17.1, 10);
    expect(half.y).toBeCloseTo(384, 10);
    expect(half.scale).toBeCloseTo((44 / 337.6 + 1) / 2, 10);
    // Its bottom edge goes straight from the thumbnail's to the cover's, so it never dips below
    // the lower of the two on the way: never into the navigation under the bar.
    for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const frame = coverFrame(p, morph);
      expect(frame.y + frame.scale * morph.size).toBeLessThanOrEqual(thumb.top + thumb.width);
    }
  });

  it("clamps overshoot, so a bouncing spring cannot push the cover past its slot", () => {
    const morph = computeMorph(thumb, slot);
    if (!morph) throw new Error("no morph");
    expect(coverFrame(1.04, morph)).toEqual(coverFrame(1, morph));
    expect(coverFrame(-0.2, morph)).toEqual(coverFrame(0, morph));
  });

  it("returns null when either box has no size, as when the cover is not laid out", () => {
    expect(computeMorph({ left: 0, top: 0, width: 0 }, slot)).toBeNull();
    expect(computeMorph(thumb, { left: 0, top: 0, width: 0 })).toBeNull();
  });

  it("is written as one custom property per number, with units", () => {
    const morph = computeMorph(thumb, { left: 32, top: 140, width: 326 });
    if (!morph) throw new Error("no morph");
    const style = morphStyle(morph);
    expect(Object.keys(style).sort()).toEqual([...MORPH_PROPERTIES].sort());
    expect(style["--art-from-x"]).toBe("8px");
    expect(style["--art-to-y"]).toBe("140px");
    expect(style["--art-size"]).toBe("326px");
    expect(Number(style["--art-scale"])).toBeCloseTo(44 / 326, 10);
  });
});

describe("where a cover rests", () => {
  it("takes out the transform its part has in flight", () => {
    // The page is drawn 728px down, at the bar; its cover sits 32px into it.
    const page = { left: 0, top: 728, width: 390 };
    const cover = { left: 26.2, top: 760, width: 337.6 };
    expect(restingBox(cover, page, { left: 0, top: 0 })).toEqual({
      left: 26.2,
      top: 32,
      width: 337.6,
    });
  });

  it("keeps the page's scroll, so a scrolled page hands the cover over from where it shows", () => {
    // Scrolled 120px: the cover is drawn that much higher inside the page.
    const page = { left: 0, top: 0, width: 390 };
    expect(restingBox({ left: 26.2, top: -88, width: 337.6 }, page, { left: 0, top: 0 }).top).toBe(
      -88,
    );
  });

  it("puts a cover in a bar that has moved back where layout keeps the bar", () => {
    // On a tablet the open bar is drawn 56px lower, following the navigation down.
    const bar = { left: 0, top: 1120, width: 820 };
    const cover = { left: 24, top: 1128, width: 44 };
    expect(restingBox(cover, bar, { left: 0, top: 1064 })).toEqual({
      left: 24,
      top: 1072,
      width: 44,
    });
  });
});
