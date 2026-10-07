import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FUNCTION_MAX_DURATION_S,
  NARRATE_OVERHEAD_MS,
  SYNTHESIS_DEADLINE_MS,
} from "./functionLimits.mjs";
import { MARKER_TTL_MS } from "./narrate";

/**
 * The numbers in functionLimits.mjs will be changed by hand once synthesis has been timed. These
 * hold the relations between them, so a change to one that forgets another fails here instead of
 * as a function stopped in the middle of an upload.
 */
describe("function limits", () => {
  it("leaves the function time to store what it paid for", () => {
    expect(SYNTHESIS_DEADLINE_MS).toBeGreaterThan(0);
    expect(NARRATE_OVERHEAD_MS).toBeGreaterThanOrEqual(5000);
    expect(SYNTHESIS_DEADLINE_MS + NARRATE_OVERHEAD_MS).toBeLessThanOrEqual(
      FUNCTION_MAX_DURATION_S * 1000,
    );
  });

  it("stays inside what the Vercel adapter accepts", () => {
    expect(Number.isInteger(FUNCTION_MAX_DURATION_S)).toBe(true);
    expect(FUNCTION_MAX_DURATION_S).toBeGreaterThanOrEqual(1);
    expect(FUNCTION_MAX_DURATION_S).toBeLessThanOrEqual(900);
  });

  it("keeps a narration's marker for longer than a function can live", () => {
    expect(MARKER_TTL_MS).toBeGreaterThan(FUNCTION_MAX_DURATION_S * 1000);
  });

  it("is the only place the adapter's limit is written", () => {
    const config = readFileSync(join(import.meta.dirname, "..", "..", "astro.config.mjs"), "utf8");
    expect(config).toContain("maxDuration: FUNCTION_MAX_DURATION_S");
    expect(config).not.toMatch(/maxDuration:\s*\d/);
  });
});
