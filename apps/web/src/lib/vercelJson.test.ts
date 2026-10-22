import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
  ignoreCommand?: string;
};

describe("vercel.json", () => {
  // #220's skip check came to 341 characters; Vercel refused the file and no deploy passed.
  it("keeps ignoreCommand within Vercel's 256 characters", () => {
    expect(config.ignoreCommand?.length ?? 0).toBeLessThanOrEqual(256);
  });
});
