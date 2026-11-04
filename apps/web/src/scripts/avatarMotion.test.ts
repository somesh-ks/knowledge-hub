import { describe, expect, it } from "vitest";
import {
  alignRing,
  type Beat,
  channelValue,
  easeAt,
  lerpRing,
  mouthPath,
  type Point,
  parseStops,
} from "./avatarMotion";

// The bugs these prevent (D353): a show that eases on a curve other than the token's, a face that jumps
// when a beat starts or when the moving mouth takes over from the drawn smile, and a morph whose
// outline twists through itself because the two rings start at different points or run opposite ways.
describe("a show's timing", () => {
  it("reads a spring token's stops and eases through them", () => {
    const stops = parseStops("linear(0, 0.5, 1.015, 1)");
    expect(stops).toEqual([0, 0.5, 1.015, 1]);
    expect(easeAt(stops, 0.5)).toBeCloseTo(0.7575);
    expect(easeAt(stops, 1)).toBe(1);
    expect(parseStops("")).toEqual([0, 1]);
  });

  it("eases each beat on from where the last one ended, and holds between beats", () => {
    const line = [0, 1];
    const beats: Beat[] = [
      { at: 100, to: 1, dur: 100, ease: line },
      { at: 400, to: 0, dur: 100, ease: line },
    ];
    expect(channelValue(beats, 0, 50)).toBe(0);
    expect(channelValue(beats, 0, 150)).toBeCloseTo(0.5);
    expect(channelValue(beats, 0, 300)).toBe(1);
    expect(channelValue(beats, 0, 450)).toBeCloseTo(0.5);
    expect(channelValue(beats, 0, 900)).toBe(0);
  });
});

describe("the moving mouth", () => {
  it("is the drawn smile's own curve at rest, so taking over from it does not jump", () => {
    // The drawn smile is M37 58 Q50 71 63 58: as a cubic its handles sit at a third, 26/3 down.
    expect(mouthPath(58, 13, 1, 0, 0)).toBe(
      "M37.00 58.00C45.67 66.67 54.33 66.67 63.00 58.00C54.33 66.67 45.67 66.67 37.00 58.00Z",
    );
  });
});

describe("a morph's rings", () => {
  const square: Point[] = [
    [40, 40],
    [60, 40],
    [60, 60],
    [40, 60],
  ];

  it("start at the top and run clockwise whichever way they were drawn", () => {
    const backwards = [...square].reverse();
    expect(alignRing(backwards)).toEqual(alignRing(square));
    const [first] = alignRing(square);
    expect(first?.[1]).toBe(40);
  });

  it("flow point for point from one ring to the other", () => {
    const wide = square.map(([x, y]): Point => [x * 2 - 50, y]);
    expect(lerpRing(square, wide, 0)).toEqual(square);
    expect(lerpRing(square, wide, 1)).toEqual(wide);
    expect(lerpRing(square, wide, 0.5)[1]).toEqual([65, 40]);
  });
});
