/**
 * The Halloween style's corner ornament (D306): a cobweb with a spider on a dragline, drawn for the top-left
 * and mirrored for the right. Its colour is the page's quiet text (`color`), so it follows the theme.
 */
const f = (n: number): number => Math.round(n * 100) / 100;

export function cobweb(): string {
  const spokesDeg = [0, 14, 31, 47, 63, 77, 90];
  const spokeLen = [196, 178, 188, 172, 190, 176, 200];
  const rings = [26, 50, 74, 98, 124, 152];
  const pt = (i: number, r: number): [number, number] => {
    const a = ((spokesDeg[i] ?? 0) * Math.PI) / 180;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  let spokes = "";
  spokeLen.forEach((length, i) => {
    const [x, y] = pt(i, length);
    spokes += `M0 0 L${f(x)} ${f(y)} `;
  });
  let threads = "";
  let dew = "";
  rings.forEach((r, k) => {
    for (let i = 0; i < spokesDeg.length - 1; i++) {
      const rr = r * (1 + 0.04 * Math.sin(i * 2.1 + k));
      const [x1, y1] = pt(i, rr);
      const [x2, y2] = pt(i + 1, rr * (1 + 0.025 * Math.sin(k * 1.7 + i)));
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const sag = 0.2 + 0.03 * k;
      threads += `M${f(x1)} ${f(y1)} Q${f(mx * (1 - sag))} ${f(my * (1 - sag))} ${f(x2)} ${f(y2)} `;
    }
  });
  // a few dewdrops on the threads
  const drops: ReadonlyArray<readonly [number, number]> = [
    [2, 3],
    [4, 4],
    [1, 4],
    [3, 2],
    [5, 5],
    [0, 5],
  ];
  for (const [i, k] of drops) {
    const [x, y] = pt(i, (rings[k] ?? 0) * 0.96);
    dew += `<circle class="sf-current ssn" cx="${f(x)}" cy="${f(y)}" r="1.9"/><circle class="sf-bone ssn" cx="${f(x - 0.6)}" cy="${f(y - 0.6)}" r=".6"/>`;
  }
  // spider dropping on a dragline from the last ring
  const [sx, sy] = pt(2, rings[4] ?? 0);
  const bx = sx + 4;
  const by = sy + 54;
  const leg = (dx: number, dy: number, ex: number, ey: number): string =>
    `M${bx} ${by} q${dx} ${dy} ${ex} ${ey}`;
  const spider = `
   <path d="M${f(sx)} ${f(sy)} L${bx} ${by - 7}" stroke-width=".9"/>
   <g class="sn" stroke-width="1.5">
     <path d="M${bx - 3} ${by + 1} q-7 -7 -12 -3 q-2 3 -1 7"/>
     <path d="M${bx - 3} ${by + 3} q-8 0 -13 6 q-1 3 0 5"/>
     <path d="M${bx - 2} ${by + 5} q-6 5 -8 11 q0 3 2 4"/>
     <path d="M${bx - 1} ${by + 6} q-3 6 -2 12 q1 3 3 3"/>
     <path d="M${bx + 3} ${by + 1} q7 -7 12 -3 q2 3 1 7"/>
     <path d="M${bx + 3} ${by + 3} q8 0 13 6 q1 3 0 5"/>
     <path d="M${bx + 2} ${by + 5} q6 5 8 11 q0 3 -2 4"/>
     <path d="M${bx + 1} ${by + 6} q3 6 2 12 q-1 3 -3 3"/>
   </g>
   <ellipse class="sf-current ssn" cx="${bx}" cy="${by + 8}" rx="5.4" ry="7"/>
   <circle class="sf-current ssn" cx="${bx}" cy="${by - 0.5}" r="3.6"/>
   <path class="sf-pumpkin-lit ssn" d="M${bx - 2} ${by + 5} L${bx} ${by + 9} L${bx + 2} ${by + 5}Z" opacity=".9"/>`;
  return `
  <g class="sn ss-current" stroke-linecap="round" stroke-linejoin="round">
    <path d="${spokes}" stroke-width="1.15"/>
    <path d="${threads}" stroke-width=".8" opacity=".9"/>
    ${dew}
    ${spider}
  </g>`;
}
