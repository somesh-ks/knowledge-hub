import type { Template } from "../../types.js";
import { paperOf, scene } from "./kit.js";
import { STYLES } from "./styles.js";

/** The twenty paper weekly styles as templates. */
export const WEEKLY_STYLES: readonly { name: string; draw: Template }[] = STYLES.map((s) => ({
  name: s.name,
  draw: (ctx) => scene(ctx, s.draw(paperOf(ctx), ctx.rng)),
}));
