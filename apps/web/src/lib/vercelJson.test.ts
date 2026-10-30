import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
  ignoreCommand?: string;
};

describe("vercel.json", () => {
  // #220's skip check came to 341 characters; Vercel refused the file and no deploy passed.
  it("keeps ignoreCommand within Vercel's 256 characters", () => {
    expect(config.ignoreCommand?.length ?? 0).toBeLessThanOrEqual(256);
  });

  // singularity-admin built every agent branch push, 98 deployments on 2026-10-29, and Hobby's
  // 100 a day stopped every deploy, production included. A new app's file must carry the block.
  it("deploys only main and preview branches, and only on its own changes, in every app", () => {
    const apps = new URL("../../../", import.meta.url);
    const files = readdirSync(apps).filter((name) =>
      existsSync(new URL(`${name}/vercel.json`, apps)),
    );
    expect(files).toContain("admin");
    for (const name of files) {
      const { git, ignoreCommand } = JSON.parse(
        readFileSync(new URL(`${name}/vercel.json`, apps), "utf8"),
      ) as { git?: { deploymentEnabled?: Record<string, boolean> }; ignoreCommand?: string };
      // A main push that touches no file the app reads must not build it either.
      expect({ name, ignoreCommand: typeof ignoreCommand }).toEqual({
        name,
        ignoreCommand: "string",
      });
      expect({ name, rules: git?.deploymentEnabled }).toEqual({
        name,
        rules: { "*": false, "*/*": false, "*/*/*": false, main: true, "preview/*": true },
      });
    }
  });
});
