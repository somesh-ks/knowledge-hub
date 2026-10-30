import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXPERIMENTS, loadExperiments } from "./experiments";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("experiments registry", () => {
  // A renamed or emptied flag file would otherwise show its experiment as off while it runs.
  it("points every flag at a file and a boolean that exist", async () => {
    const rows = await loadExperiments(ROOT);
    expect(rows.map((row) => row.id)).toEqual(EXPERIMENTS.map((experiment) => experiment.id));
  });
});
