import { buildContext } from "../../context.js";

for (const d of ["2026-10-11", "2026-11-15", "2026-12-13", "2027-01-10"]) {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { ctx } = buildContext(
      { template: "band", palette: "ultramarine", seed } as never,
      { id: "x", date: d, kind: "weekly" },
      1024,
      "standard",
      true,
    );
    console.log(d, seed, ctx.pal.ground, ctx.pal.accent, ctx.ink, ctx.matte);
  }
}
const { ctx } = buildContext(
  { template: "band", palette: "ultramarine", seed: 1 } as never,
  { id: "x", date: "2026-10-11", kind: "weekly" },
  1024,
  "standard",
  true,
);
console.log(JSON.stringify(ctx.quiet), JSON.stringify(ctx.area), ctx.numeral, ctx.caption);
