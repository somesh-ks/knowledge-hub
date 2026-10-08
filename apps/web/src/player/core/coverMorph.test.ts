import { describe, expect, it } from "vitest";
import { computeMorph, coverFrame, MORPH_PROPERTIES, morphStyle } from "./coverMorph";

const thumb = { left: 8, top: 792, width: 44 };
const slot = { left: 32, top: 150, width: 326 };

describe("cover morph", () => {
  it("measures both ends once: the bar's thumbnail and the page's slot", () => {
    expect(computeMorph(thumb, slot)).toEqual({
      fromX: 8,
      fromY: 792,
      toX: 32,
      toY: 150,
      size: 326,
      scale: 44 / 326,
    });
  });

  it("sits exactly on the thumbnail when collapsed and exactly on the slot when expanded", () => {
    const morph = computeMorph(thumb, slot);
    if (!morph) throw new Error("no morph");
    const collapsed = coverFrame(0, morph);
    expect(collapsed).toEqual({ x: 8, y: 792, scale: 44 / 326 });
    // The scaled cover is exactly as wide as the thumbnail.
    expect(collapsed.scale * morph.size).toBeCloseTo(thumb.width, 10);
    expect(coverFrame(1, morph)).toEqual({ x: 32, y: 150, scale: 1 });
  });

  it("travels in a straight line between the two", () => {
    const morph = computeMorph(thumb, slot);
    if (!morph) throw new Error("no morph");
    const half = coverFrame(0.5, morph);
    expect(half.x).toBeCloseTo(20, 10);
    expect(half.y).toBeCloseTo(471, 10);
    expect(half.scale).toBeCloseTo((44 / 326 + 1) / 2, 10);
  });

  it("clamps overshoot, so a bouncing spring cannot push the cover past its slot", () => {
    const morph = computeMorph(thumb, slot);
    if (!morph) throw new Error("no morph");
    expect(coverFrame(1.04, morph)).toEqual(coverFrame(1, morph));
    expect(coverFrame(-0.2, morph)).toEqual(coverFrame(0, morph));
  });

  it("lands where a scrolled page really shows its cover", () => {
    const morph = computeMorph(thumb, slot, 120);
    expect(morph?.toY).toBe(30);
    // Scrolled past the cover: it leaves from above the screen.
    expect(computeMorph(thumb, slot, 400)?.toY).toBe(-250);
    expect(computeMorph(thumb, slot, -5)?.toY).toBe(150);
  });

  it("returns null when either box has no size, as when the cover is not laid out", () => {
    expect(computeMorph({ left: 0, top: 0, width: 0 }, slot)).toBeNull();
    expect(computeMorph(thumb, { left: 0, top: 0, width: 0 })).toBeNull();
  });

  it("is written as one custom property per number, with units", () => {
    const morph = computeMorph(thumb, slot, 10);
    if (!morph) throw new Error("no morph");
    const style = morphStyle(morph);
    expect(Object.keys(style).sort()).toEqual([...MORPH_PROPERTIES].sort());
    expect(style["--art-from-x"]).toBe("8px");
    expect(style["--art-to-y"]).toBe("140px");
    expect(style["--art-size"]).toBe("326px");
    expect(Number(style["--art-scale"])).toBeCloseTo(44 / 326, 10);
  });
});
