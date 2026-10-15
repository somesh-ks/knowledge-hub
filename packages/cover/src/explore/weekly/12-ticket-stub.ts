import type { Template } from "../../types.js";
import { circle, fill, flat, rect, scene } from "./_kit.js";

export const name = "Ticket stub";

/**
 * A pale admit-one ticket: notched edges, a dotted tear line, a ringed disc on the body and seven
 * dots on the stub. Weekly signature: the notched ticket.
 */
export const weekly: Template = (ctx) => {
  const { G, A, M } = flat(ctx);
  const out = [fill(G), rect(380, 100, 600, 440, M)];
  for (const [x, y] of [
    [790, 100],
    [790, 540],
    [380, 320],
    [980, 320],
  ] as const) {
    out.push(circle(x, y, 24, G));
  }
  for (let y = 160; y <= 480; y += 32) out.push(circle(790, y, 5, G));
  out.push(circle(585, 320, 140, G), circle(585, 320, 68, A));
  for (let i = 0; i < 7; i += 1) out.push(circle(885, 185 + i * 46, 14, G));
  return scene(ctx, out.join(""));
};
