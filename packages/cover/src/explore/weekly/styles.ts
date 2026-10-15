import { circle, fill, type Paper, path, petal, polygon, rect, sector, stroke } from "./kit.js";

interface Rng {
  int(min: number, max: number): number;
}

export interface Style {
  name: string;
  /** What it is, and where it comes from. */
  note: string;
  draw: (c: Paper, rng: Rng) => string;
}

/**
 * Twenty weekly styles on paper. Art keeps clear of the wordmark (top left) and the date block
 * (bottom left), so both sit on flat paper. Seven recurs as the count of the week.
 */
export const STYLES: Style[] = [
  {
    name: "Seven suns",
    note: "A row of seven discs growing through the week. Swiss rhythm studies.",
    draw: ({ P, K, D }, rng) => {
      const hot = rng.int(0, 6);
      const out = [fill(P)];
      for (let i = 0; i < 7; i += 1)
        out.push(circle(130 + i * 128, 400, 24 + i * 6, i === hot ? D : K));
      return out.join("");
    },
  },
  {
    name: "Ink block",
    note: "A bled ink block crossed by a tint bar, a spot square in the corner. Reid Miles' Blue Note sleeves.",
    draw: ({ P, K, D, T }) =>
      [
        fill(P),
        rect(380, 0, 644, 520, K),
        rect(380, 300, 644, 64, T),
        rect(820, 120, 80, 80, D),
      ].join(""),
  },
  {
    name: "Lens",
    note: "Two discs overprinted, the overlap in ink. Risograph overprints.",
    draw: ({ P, K, T, H }) =>
      [
        fill(P),
        circle(560, 300, 200, T),
        circle(780, 300, 200, H),
        path("M670 133A200 200 0 0 1 670 467A200 200 0 0 1 670 133Z", K),
      ].join(""),
  },
  {
    name: "Half-moon stack",
    note: "Seven half discs stacked down the right edge like a spine. Scandinavian textile repeats.",
    draw: ({ P, K, D, T }, rng) => {
      const hot = rng.int(0, 6);
      const out = [fill(P)];
      for (let i = 0; i < 7; i += 1) {
        const b = 150 + i * 132;
        out.push(path(`M770 ${b}A110 110 0 0 1 990 ${b}Z`, i === hot ? D : i % 2 ? T : K));
      }
      return out.join("");
    },
  },
  {
    name: "Staircase",
    note: "Seven ink steps climbing to the right. Bauhaus stair diagrams.",
    draw: ({ P, K, D }, rng) => {
      const hot = rng.int(3, 6);
      const out = [fill(P)];
      for (let i = 0; i < 7; i += 1) {
        const h = 60 + i * 62;
        out.push(rect(380 + i * 92, 560 - h, 92, h, i === hot ? D : K));
      }
      return out.join("");
    },
  },
  {
    name: "Bauhaus tiles",
    note: "A three by three grid of quarter circles and half discs. Bauhaus tile studies.",
    draw: ({ P, K, D, T, H }, rng) => {
      const out = [fill(P)];
      const inks = [K, T, K, H, D];
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 3; c += 1) {
          const x = 520 + c * 160;
          const y = 40 + r * 160;
          const ink = inks[rng.int(0, inks.length - 1)] as string;
          const kind = rng.int(0, 3);
          if (kind === 0)
            out.push(path(`M${x} ${y}H${x + 160}A160 160 0 0 1 ${x} ${y + 160}Z`, ink));
          else if (kind === 1)
            out.push(path(`M${x + 160} ${y + 160}V${y}A160 160 0 0 0 ${x} ${y + 160}Z`, ink));
          else if (kind === 2)
            out.push(path(`M${x} ${y + 160}A80 80 0 0 1 ${x + 160} ${y + 160}Z`, ink));
          else out.push(circle(x + 80, y + 80, 64, ink));
        }
      }
      return out.join("");
    },
  },
  {
    name: "Striped sun",
    note: "A sun cut by widening bands over a rule. 1970s sunset sleeves.",
    draw: ({ P, K, D }) => {
      const out = [fill(P), circle(712, 300, 200, D)];
      for (let i = 0; i < 7; i += 1) out.push(rect(500, 312 + i * 28, 430, 4 + i * 3, P));
      out.push(rect(400, 520, 624, 20, K));
      return out.join("");
    },
  },
  {
    name: "Barcode",
    note: "Seven-day bars in varied widths down the right edge. Product labels and Swiss price tags.",
    draw: ({ P, K, D }, rng) => {
      const out = [fill(P)];
      const hot = rng.int(0, 6);
      let x = 800;
      for (let i = 0; i < 7 && x < 1000; i += 1) {
        const w = [8, 16, 24, 40][rng.int(0, 3)] as number;
        out.push(rect(x, 0, Math.min(w, 1004 - x), 1024, i === hot ? D : K));
        x += w + rng.int(12, 20);
      }
      return out.join("");
    },
  },
  {
    name: "Folded corner",
    note: "A tint square folded on its diagonal, ink on the turned half. Munari's paper folds.",
    draw: ({ P, K, D, T }) =>
      [
        fill(P),
        rect(560, 0, 464, 464, T),
        polygon(
          [
            [560, 0],
            [1024, 0],
            [1024, 464],
          ],
          K,
        ),
        circle(700, 330, 40, D),
      ].join(""),
  },
  {
    name: "Week ring",
    note: "A ring in seven segments, one in the spot colour. Otl Aicher's Munich 72 pictogram geometry.",
    draw: ({ P, K, D }, rng) => {
      const hot = rng.int(0, 6);
      const gap = (6 * Math.PI) / 180;
      const step = (2 * Math.PI) / 7;
      const out = [fill(P)];
      for (let i = 0; i < 7; i += 1)
        out.push(
          path(
            sector(700, 330, 130, 230, i * step + gap / 2, (i + 1) * step - gap / 2),
            i === hot ? D : K,
          ),
        );
      return out.join("");
    },
  },
  {
    name: "Domino",
    note: "An ink domino carrying seven pips, three over four. Game tiles.",
    draw: ({ P, K, T }, rng) => {
      const pips: [number, number][] = [
        [680, 124],
        [750, 174],
        [820, 224],
        [690, 370],
        [810, 370],
        [690, 470],
        [810, 470],
      ];
      const hot = rng.int(0, 6);
      const out = [fill(P), rect(600, 60, 300, 480, K, 40), rect(630, 288, 240, 10, P)];
      pips.forEach(([x, y], i) => {
        out.push(circle(x, y, 28, i === hot ? T : P));
      });
      return out.join("");
    },
  },
  {
    name: "Hanging pills",
    note: "Seven pills dropping from the top edge at different lengths. Sound level meters.",
    draw: ({ P, K, D }, rng) => {
      const hot = rng.int(0, 6);
      const out = [fill(P)];
      for (let i = 0; i < 7; i += 1)
        out.push(rect(380 + i * 90, -40, 60, 240 + rng.int(0, 300), i === hot ? D : K, 30));
      return out.join("");
    },
  },
  {
    name: "Overprint squares",
    note: "Two squares overlapping, the shared corner in the spot colour. Albers' interaction of colour.",
    draw: ({ P, K, D, T }) =>
      [
        fill(P),
        rect(420, 60, 320, 320, T),
        rect(580, 220, 320, 320, K),
        rect(580, 220, 160, 160, D),
      ].join(""),
  },
  {
    name: "Eclipse",
    note: "An ink moon sliding over a tint sun, a small spot planet below. Astronomy plates.",
    draw: ({ P, K, D, T }) =>
      [fill(P), circle(660, 300, 220, T), circle(780, 250, 170, K), circle(520, 480, 30, D)].join(
        "",
      ),
  },
  {
    name: "Week line",
    note: "The week as a line through seven points, the peak in the spot colour. Braun and Rams data graphics.",
    draw: ({ P, K, D }, rng) => {
      const pts = Array.from({ length: 7 }, (_, i) => [380 + i * 100, rng.int(160, 500)] as const);
      const top = pts.reduce((m, p, i) => (p[1] < (pts[m]?.[1] ?? 1e9) ? i : m), 0);
      const out = [fill(P), stroke(`M${pts.map(([x, y]) => `${x} ${y}`).join("L")}`, K, 20)];
      pts.forEach(([x, y], i) => {
        out.push(circle(x, y, i === top ? 40 : 26, i === top ? D : K));
      });
      return out.join("");
    },
  },
  {
    name: "Window grid",
    note: "Seven ink windows in a four by two grid, the eighth left as tint. Modernist facades.",
    draw: ({ P, K, D, T }, rng) => {
      const empty = rng.int(0, 7);
      const hot = (empty + rng.int(1, 7)) % 8;
      const out = [fill(P)];
      for (let i = 0; i < 8; i += 1) {
        const x = 436 + (i % 4) * 146;
        const y = 120 + Math.floor(i / 4) * 146;
        out.push(rect(x, y, 130, 130, i === empty ? T : i === hot ? D : K));
      }
      return out.join("");
    },
  },
  {
    name: "Corner rings",
    note: "Seven discs from the top right corner, alternating ink, paper and tint. Target and record grooves.",
    draw: ({ P, K, D, T }) => {
      const inks = [K, P, T, P, K, P, D];
      return [fill(P), ...inks.map((c, i) => circle(1024, 0, 560 - i * 80, c))].join("");
    },
  },
  {
    name: "Seven petals",
    note: "A flower of seven petals around a tint heart. Marimekko and Scandinavian prints.",
    draw: ({ P, K, D, T }, rng) => {
      const hot = rng.int(0, 6);
      const out = [fill(P)];
      for (let i = 0; i < 7; i += 1)
        out.push(petal(700, 320, 220, 84, (i * 2 * Math.PI) / 7, i === hot ? D : K));
      out.push(circle(700, 320, 54, T));
      return out.join("");
    },
  },
  {
    name: "Checker band",
    note: "A two-row checker band across the cover over a tint rule. Racing flags and Op Art.",
    draw: ({ P, K, D, T }, rng) => {
      const hot = rng.int(0, 6);
      const out = [fill(P)];
      for (let c = 0; c < 7; c += 1) {
        for (let r = 0; r < 2; r += 1) {
          if ((c + r) % 2 === 0)
            out.push(rect(128 + c * 128, 240 + r * 80, 128, 80, c === hot ? D : K));
        }
      }
      out.push(rect(128, 420, 896, 32, T));
      return out.join("");
    },
  },
  {
    name: "Day slab",
    note: "An ink slab down the right edge marked with seven day ticks, a tint sun behind. Diary spines.",
    draw: ({ P, K, D, T }, rng) => {
      const hot = rng.int(0, 6);
      const out = [fill(P), circle(660, 300, 140, T), rect(760, 0, 264, 1024, K)];
      for (let i = 0; i < 7; i += 1)
        out.push(rect(800, 200 + i * 100, i === hot ? 184 : 120, 14, i === hot ? D : P));
      return out.join("");
    },
  },
];
