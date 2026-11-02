/**
 * Fits a neutral recipe (styleRecipe.ts) to the colours a style wrote by hand, and prints the colour
 * difference per role in OKLab (0.02 is about the least a person sees). Run before converting a
 * style: `npx tsx scripts/fitStyleRecipe.ts`. The roles above 0.02 go on the stills sheet.
 */
import { readFileSync } from "node:fs";
import { parseOklch } from "./colorMath.js";
import { type Family, NEUTRAL_ROLES, type NeutralRecipe, neutralTone } from "./styleRecipe.js";

const d = JSON.parse(readFileSync("tokens/tokens.json", "utf8"));
const lab = (l: number, c: number, h: number) => [
  l,
  c * Math.cos((h * Math.PI) / 180),
  c * Math.sin((h * Math.PI) / 180),
];
const dE = (a: number[], b: number[]) => Math.hypot(...a.map((value, i) => value - (b[i] ?? 0)));
function lit(style: string, role: string, mode: "light" | "dark") {
  const t = d.styles[style].semantic.color[role];
  const v = mode === "light" ? t.$value : t.$extensions.singularity.mode.dark;
  if (!/^oklch\(/.test(v)) return null;
  return parseOklch(v);
}
const fam = (hue: number, tint: number, lift: number, sharp: number): Family => ({
  hue,
  tint,
  lift,
  sharp,
});
for (const style of ["expressive", "halloween"] as const) {
  let best: { err: number; n: number; recipe: NeutralRecipe } | undefined;
  const hues =
    style === "expressive"
      ? [[292, 292]]
      : [
          [80, 303],
          [82, 302],
          [85, 300],
        ];
  const depths =
    style === "expressive"
      ? [
          [96, 19],
          [96.5, 19],
          [97, 19],
        ]
      : [
          [95.5, 15],
          [95, 15],
          [95.5, 14],
        ];
  for (const [ph = 0, ih = 0] of hues)
    for (const [dl = 0, dd = 0] of depths)
      for (let tint = 0.03; tint <= 0.14; tint += 0.01)
        for (let lift = 0.02; lift <= 0.09; lift += 0.01)
          for (const sharp of [0.6, 1, 1.4]) {
            const f = (h: number) => fam(h, tint, lift, sharp);
            const recipe: NeutralRecipe = {
              depth: { light: dl, dark: dd },
              paper: f(ph),
              ink: f(ih),
            };
            let err = 0,
              n = 0;
            for (const role of Object.keys(NEUTRAL_ROLES))
              for (const mode of ["light", "dark"] as const) {
                const a = lit(style, role, mode);
                if (!a) continue;
                const g = neutralTone(recipe, role, mode);
                err += dE(lab(g.l, g.c, g.h), lab(a.l, a.c, a.h)) ** 2;
                n++;
              }
            if (!best || err < best.err) best = { err, n, recipe };
          }
  if (!best) throw new Error(`no points for ${style}`);
  console.log(style, JSON.stringify(best.recipe), "rms", Math.sqrt(best.err / best.n).toFixed(4));
  const rows: string[] = [];
  for (const role of Object.keys(NEUTRAL_ROLES))
    for (const mode of ["light", "dark"] as const) {
      const a = lit(style, role, mode);
      if (!a) continue;
      const g = neutralTone(best.recipe, role, mode);
      rows.push(`${role} ${mode} ${dE(lab(g.l, g.c, g.h), lab(a.l, a.c, a.h)).toFixed(3)}`);
    }
  console.log(
    rows
      .sort((x, y) => Number(y.split(" ")[2]) - Number(x.split(" ")[2]))
      .slice(0, 6)
      .join(" | "),
  );
}
