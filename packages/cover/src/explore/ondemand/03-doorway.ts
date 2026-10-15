import type { Template } from "../../types.js";
import { arch, CX, CY, pen, R } from "./common.js";

/** Nested doorways: Arches inside arches, the last one a hole to the matte. */
export const s03: Template = (ctx) => {
  const { G, A, M } = pen(ctx);
  const base = CY + R;
  return {
    body:
      arch(CX, CY - R + 20, base, 440, G) +
      arch(CX, CY - R + 100, base, 290, A) +
      arch(CX, CY - R + 175, base, 140, M),
  };
};
