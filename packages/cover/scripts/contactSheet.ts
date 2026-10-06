/**
 * Builds docs/prototype/cover-contact-sheet.html: every template across several palettes and seeds,
 * a palette study, the weekly record, social cards and small-size legibility checks. Also writes a
 * handful of PNG samples to docs/prototype/covers/.
 *
 *   npx tsx packages/cover/scripts/contactSheet.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contrastRatio } from "../src/color.js";
import { FONT_FILES } from "../src/fonts.js";
import { allPalettes, getPalette, paletteAccent } from "../src/palettes.js";
import { hash32 } from "../src/prng.js";
import { renderCoverPng, renderCoverSvg, renderSocialPng, renderSocialSvg } from "../src/render.js";
import { TEMPLATES } from "../src/templates/index.js";
import type { CoverMeta, CoverSpec, TemplateId } from "../src/types.js";

const root = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

const FORMS: Record<TemplateId, { title: string; form: string }> = {
  spring: {
    title: "Spring",
    form: "Step responses of damped springs, fanned from one origin across a shared target. One accent curve is the chosen spring.",
  },
  dither: {
    title: "Dither",
    form: "Ordered-dither gradients on a coarse pixel grid against hard vector geometry: a sphere of pixels, or a shape cut from the field.",
  },
  contour: {
    title: "Contour",
    form: "Topographic lines from seeded noise by marching squares. Index contours run heavier; the summit takes the accent.",
  },
  numeral: {
    title: "Numeral",
    form: "The day number set larger than the frame over flat blocks, one solid color with every block held at 3:1 against it.",
  },
  lattice: {
    title: "Lattice",
    form: "A square or triangular grid bent by a seeded lens, with a connected run of cells lit.",
  },
  orbit: {
    title: "Orbit",
    form: "Nested rings whose centers drift along a path, crowding on one side. One ring is the accent and carries a planet.",
  },
  aperture: {
    title: "Aperture",
    form: "Overlapping circles. Each overlap is a lens filled with a flat tint computed from its two circles; the focal one is the accent.",
  },
  band: {
    title: "Band",
    form: "Stacked wave bands with a phase shift per boundary, swelling and pinching like a waveform.",
  },
};

function dateFor(offset: number): string {
  const d = new Date(Date.UTC(2026, 8, 1 + offset));
  return d.toISOString().slice(0, 10);
}

interface Entry {
  spec: CoverSpec;
  meta: CoverMeta;
  note: string;
}

function entry(
  template: TemplateId,
  palette: string,
  offset: number,
  kind: CoverMeta["kind"] = "regular",
): Entry {
  const date = dateFor(offset);
  const id = kind === "weekly" ? `${date}-weekly` : date;
  return {
    spec: { template, palette, seed: hash32(`seed:${id}:${template}`) },
    meta: { date, kind, id },
    note: getPalette(palette).name,
  };
}

const palettes = allPalettes();

function figure({ spec, meta, note }: Entry): string {
  return `<figure class="cover"><div class="art">${renderCoverSvg(spec, meta)}</div><figcaption>${note}<span>${spec.seed}</span></figcaption></figure>`;
}

function section(template: TemplateId, index: number): string {
  const entries = Array.from({ length: 8 }, (_, k) =>
    entry(
      template,
      (palettes[(index * 3 + k * 5) % palettes.length] as { id: string }).id,
      index * 8 + k,
    ),
  );
  const { title, form } = FORMS[template];
  return `<section id="${template}"><div class="head"><h2>${title}</h2><p>${form}</p></div><div class="grid">${entries.map(figure).join("")}</div></section>`;
}

function swatches(id: string): string {
  const p = getPalette(id);
  return (["ground", "field", "shade", "accent", "text"] as const)
    .map(
      (role) =>
        `<li><i style="background:${p[role]}"></i><b>${role}</b><span>${p[role]}</span></li>`,
    )
    .join("");
}

function paletteCard(id: string, index: number): string {
  const p = getPalette(id);
  const study = entry(index % 2 === 0 ? "numeral" : "contour", id, 40 + index);
  const accent = paletteAccent(id);
  const ratio = contrastRatio(p.text, p.ground).toFixed(1);
  const fieldRatio = contrastRatio(p.text, p.field).toFixed(1);
  return `<article class="palette"><div class="art">${renderCoverSvg(study.spec, study.meta)}</div><h3>${p.name}</h3><p>${p.tone} ground. Date text ${ratio}:1 on ground, ${fieldRatio}:1 on field. Player accent ${accent.light} on light, ${accent.dark} on dark.</p><ul class="chips">${swatches(id)}</ul></article>`;
}

function pngDataUri(spec: CoverSpec, meta: CoverMeta, size: 512 | 1024): string {
  return `data:image/png;base64,${Buffer.from(renderCoverPng(spec, meta, size)).toString("base64")}`;
}

function fontFaces(): string {
  const weights = [400, 500, 700, 900];
  return FONT_FILES.map((file, i) => {
    const data = readFileSync(file).toString("base64");
    return `@font-face{font-family:"Schibsted Grotesk";font-weight:${weights[i]};font-style:normal;font-display:block;src:url(data:font/ttf;base64,${data}) format("truetype")}`;
  }).join("\n");
}

const css = `
:root{color-scheme:light;--bg:oklch(97% 0.006 235);--ink:oklch(22% 0.03 250);--muted:oklch(46% 0.03 245);--line:oklch(88% 0.01 235);--accent:oklch(49% 0.17 14);--gutter:clamp(16px,4vw,48px)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.5 "Schibsted Grotesk",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1480px;margin:0 auto;padding:clamp(28px,6vw,72px) var(--gutter) 96px}
h1{font-size:clamp(2rem,1.4rem + 3vw,3.5rem);line-height:1.04;letter-spacing:-0.025em;font-weight:900;margin:0 0 16px;text-wrap:balance}
h2{font-size:clamp(1.4rem,1.2rem + 1vw,2rem);letter-spacing:-0.02em;font-weight:700;margin:0;text-wrap:balance}
h3{font-size:1rem;font-weight:700;margin:14px 0 4px}
p{margin:0;color:var(--muted);text-wrap:pretty}
.lede{max-width:62ch;font-size:1.0625rem}
nav{display:flex;flex-wrap:wrap;gap:6px 22px;margin:28px 0 8px}
nav a{color:var(--ink);text-decoration:none;font-weight:500;border-bottom:1.5px solid var(--line);padding-bottom:2px}
nav a:hover,nav a:focus-visible{border-color:var(--accent);outline:none}
section{margin-top:clamp(48px,8vw,96px)}
.head{display:grid;gap:8px;max-width:64ch;margin-bottom:22px}
.grid{display:grid;gap:clamp(12px,2vw,24px);grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr))}
.wide{grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr))}
.cover{margin:0}
.art{border-radius:12px;overflow:hidden;outline:1px solid rgb(0 0 0 / 0.1);outline-offset:-1px;background:var(--line);line-height:0}
.art svg{width:100%;height:auto;display:block}
figcaption{display:flex;justify-content:space-between;gap:8px;margin-top:8px;font-size:.8125rem;color:var(--muted)}
figcaption span{font-variant-numeric:tabular-nums;opacity:.7}
.palette .chips{list-style:none;padding:0;margin:12px 0 0;display:grid;gap:4px}
.chips li{display:grid;grid-template-columns:18px 52px 1fr;gap:8px;align-items:center;font-size:.8125rem}
.chips i{width:18px;height:18px;border-radius:4px;box-shadow:inset 0 0 0 1px rgb(0 0 0 / 0.14)}
.chips b{font-weight:500}
.chips span{color:var(--muted);font-variant-numeric:tabular-nums}
.small{display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px}
.small+.small{margin-top:18px}
.px{background-size:cover;border-radius:10px;outline:1px solid rgb(0 0 0 / 0.1);outline-offset:-1px}
.px120{width:120px;height:120px}.px72{width:72px;height:72px;border-radius:8px}.px44{width:44px;height:44px;border-radius:6px}
.stat{display:flex;flex-wrap:wrap;gap:6px 28px;margin-top:20px;color:var(--muted);font-size:.9375rem}
.stat b{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}
`;

function build(): string {
  const templateSections = TEMPLATES.map((t, i) => section(t, i)).join("");
  const paletteCards = palettes.map((p, i) => paletteCard(p.id, i)).join("");

  const weeklyTemplates: TemplateId[] = [
    "contour",
    "orbit",
    "spring",
    "band",
    "lattice",
    "aperture",
    "dither",
    "numeral",
  ];
  const darkIds = palettes.filter((p) => p.tone === "dark").map((p) => p.id);
  const weekly = weeklyTemplates
    .map((t, i) => entry(t, darkIds[i % darkIds.length] as string, 7 + i * 7, "weekly"))
    .map(figure)
    .join("");

  const social = (["orbit", "contour", "band"] as const)
    .map((t, i) => {
      const e = entry(t, (palettes[(i * 4 + 1) % palettes.length] as { id: string }).id, 60 + i);
      return `<figure class="cover"><div class="art">${renderSocialSvg(e.spec, e.meta)}</div><figcaption>${e.note}<span>1200 by 630</span></figcaption></figure>`;
    })
    .join("");

  const smallSet = TEMPLATES.map((t, i) =>
    entry(t, (palettes[(i * 5 + 2) % palettes.length] as { id: string }).id, 90 + i),
  );
  // One PNG per cover, shared by all three sizes through a class, so the page stays light.
  const smallCss = smallSet
    .map((e, i) => `.s${i}{background-image:url(${pngDataUri(e.spec, e.meta, 512)})}`)
    .join("");
  const small = ["px120", "px72", "px44"]
    .map(
      (size) =>
        `<div class="small">${smallSet
          .map(
            (e, i) =>
              `<div class="px ${size} s${i}" role="img" aria-label="${e.spec.template} cover at ${size.slice(2)} pixels"></div>`,
          )
          .join("")}</div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dispatch cover contact sheet</title>
<style>${fontFaces()}
${css}${smallCss}</style>
</head>
<body>
<main>
<header>
<h1>Dispatch cover system</h1>
<p class="lede">Eight templates, twelve OKLCH palettes, one seeded generator. Every cover below is the real renderer output, set in Schibsted Grotesk, with the date as the typographic anchor. Same digest, same cover.</p>
<div class="stat"><span><b>${TEMPLATES.length}</b> templates</span><span><b>${palettes.length}</b> palettes</span><span><b>${palettes.filter((p) => p.tone === "dark").length}</b> dark, used by weekly</span></div>
<nav aria-label="Sections">${TEMPLATES.map((t) => `<a href="#${t}">${FORMS[t].title}</a>`).join("")}<a href="#palettes">Palettes</a><a href="#weekly">Weekly</a><a href="#social">Social</a><a href="#small">Small sizes</a></nav>
</header>
${templateSections}
<section id="palettes"><div class="head"><h2>Palettes</h2><p>Each palette: ground, a quiet field tint, a mid shade, one focal accent and a text color verified at 4.5:1 on both ground and field.</p></div><div class="grid">${paletteCards}</div></section>
<section id="weekly"><div class="head"><h2>Weekly</h2><p>The weekly record draws from the dark family and mattes the art inside a ground border with a hairline rule and corner ticks, so it reads as a different kind of record at a glance.</p></div><div class="grid">${weekly}</div></section>
<section id="social"><div class="head"><h2>Social card</h2><p>Composed for 1200 by 630 rather than cropped from the square.</p></div><div class="grid wide">${social}</div></section>
<section id="small"><div class="head"><h2>Small sizes</h2><p>PNG at 120, 72 and 44 pixels, the sizes a mini player and a lock screen thumbnail show. The numeral and the focal gesture have to survive.</p></div>${small}</section>
</main>
</body>
</html>
`;
}

function writeSamples(): void {
  const dir = root("docs/prototype/covers");
  mkdirSync(dir, { recursive: true });
  const picks: [TemplateId, string][] = [
    ["spring", "fog-lingonberry"],
    ["dither", "indigo-aqua"],
    ["contour", "sea-lingonberry"],
    ["numeral", "saffron-ink"],
    ["lattice", "ultramarine"],
    ["orbit", "kelp"],
    ["aperture", "marigold-fog"],
    ["band", "plum-pearl"],
  ];
  picks.forEach(([template, palette], i) => {
    const e = entry(template, palette, 120 + i * 3);
    writeFileSync(`${dir}/${template}-1024.png`, renderCoverPng(e.spec, e.meta, 1024));
  });
  const weekly = entry("orbit", "sea-lingonberry", 127, "weekly");
  writeFileSync(`${dir}/weekly-orbit-1024.png`, renderCoverPng(weekly.spec, weekly.meta, 1024));
  const social = entry("contour", "fog-lingonberry", 131);
  writeFileSync(`${dir}/social-contour-1200x630.png`, renderSocialPng(social.spec, social.meta));
}

writeFileSync(root("docs/prototype/cover-contact-sheet.html"), build());
writeSamples();
console.log("Wrote docs/prototype/cover-contact-sheet.html and docs/prototype/covers/*.png");
