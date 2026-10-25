import sharp from "sharp";
const [, , out, ...files] = process.argv; const scale = Number(process.env.SCALE ?? 0.5), cols = Number(process.env.COLS ?? 4), GAP = 12;
const imgs = await Promise.all(files.map(async f => { const m = await sharp(f).metadata(); return { f, w: Math.round(m.width * scale), h: Math.round(m.height * scale) }; }));
const cw = Math.max(...imgs.map(i => i.w)); const comps = []; let top = 0;
for (let r = 0; r < imgs.length; r += cols) { const row = imgs.slice(r, r + cols); const rh = Math.max(...row.map(i => i.h));
  for (const [n, i] of row.entries()) comps.push({ input: await sharp(i.f).resize({ width: i.w }).toBuffer(), left: n * (cw + GAP), top }); top += rh + GAP; }
await sharp({ create: { width: cols * (cw + GAP), height: top, channels: 3, background: "#d9d9d9" } }).composite(comps).png().toFile(out);
