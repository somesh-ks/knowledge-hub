import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { COVER_TEMPLATES, hashOf } from "@singularity/core";
import type { CoverPicker } from "./buildDigest.js";

const FALLBACK_PALETTE = "dusk";

/** Palette ids from tokens/covers.json: keys under "palettes", or the top-level non-$ keys. */
export async function loadCoverPalettes(root: string): Promise<string[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(root, "tokens", "covers.json"), "utf8"));
    if (typeof raw !== "object" || raw === null) return [FALLBACK_PALETTE];
    const record = raw as Record<string, unknown>;
    const container =
      typeof record.palettes === "object" && record.palettes !== null
        ? (record.palettes as Record<string, unknown>)
        : record;
    const ids = Object.keys(container).filter((key) => !key.startsWith("$"));
    return ids.length > 0 ? ids : [FALLBACK_PALETTE];
  } catch {
    return [FALLBACK_PALETTE];
  }
}

export interface FallbackCoverOptions {
  palettes: readonly string[];
  /** The previous cover, so the next one does not repeat it. */
  last?: { template: string; palette: string };
}

/**
 * Deterministic stand-in for the real cover picker: the digest id and its sections decide the
 * seed, template and palette, and a repeat of the last cover is shifted to the next template.
 * `singularity run` injects the cover package's picker instead when it is available.
 */
export function createFallbackCoverPicker(options: FallbackCoverOptions): CoverPicker {
  const palettes = options.palettes.length > 0 ? options.palettes : [FALLBACK_PALETTE];
  return ({ digestId, items }) => {
    const hash = hashOf({ digestId, sections: items.map((item) => item.section) });
    const seed = Number.parseInt(hash.slice(0, 8), 16) % 100_000;
    let templateIndex = seed % COVER_TEMPLATES.length;
    const palette = palettes[Math.floor(seed / COVER_TEMPLATES.length) % palettes.length] as string;
    const repeats =
      options.last?.template === COVER_TEMPLATES[templateIndex] &&
      options.last?.palette === palette;
    if (repeats) templateIndex = (templateIndex + 1) % COVER_TEMPLATES.length;
    return {
      template: COVER_TEMPLATES[templateIndex] as (typeof COVER_TEMPLATES)[number],
      palette,
      seed,
    };
  };
}
