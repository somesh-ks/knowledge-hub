import { buildContext } from "../../context.js";

for (const d of ["2026-10-13", "2026-11-13", "2026-12-13", "2027-01-13"]) {
  const { ctx } = buildContext(
    { template: "band", palette: "ultramarine", seed: 7 } as never,
    { id: "x", date: d, kind: "regular" },
    1024,
    "standard",
    true,
  );
  console.log(d, JSON.stringify(ctx.pal), ctx.ink, JSON.stringify(ctx.quiet), ctx.margin);
}
