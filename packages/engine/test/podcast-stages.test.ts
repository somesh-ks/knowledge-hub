import { afterEach, beforeEach, expect, it } from "vitest";
import { createArtifactStore } from "../src/podcast/stages.js";
import { type FakeBlob, makeFakeBlob, makeTempRoot, type TempRoot } from "./audio-fixtures.js";

/**
 * A stage's artifact used to be copied to Blob as it was written, one put a stage, and Vercel counts
 * each put against Hobby's 2,000 advanced operations a month (D256). The bugs this prevents: a
 * run that succeeds still spending those puts, and a failed run leaving nothing for its rerun.
 */

let temp: TempRoot;
let blob: FakeBlob;

beforeEach(async () => {
  temp = await makeTempRoot();
  blob = makeFakeBlob();
});
afterEach(async () => {
  await temp.cleanup();
});

const store = (runId: string, resumeFrom?: string) =>
  createArtifactStore({
    dir: `${temp.root}/stages-${runId}`,
    blob,
    runId,
    ...(resumeFrom ? { resumeFrom } : {}),
    fetchImpl: async (url) => {
      const item = blob.store.get(new URL(String(url)).pathname.slice(1));
      return item
        ? new Response(new TextDecoder().decode(item.body))
        : new Response(null, { status: 404 });
    },
  });

it("writes nothing to Blob while the run succeeds", async () => {
  const run = store("1");
  await run.write("select", { stories: 3 });
  await run.write("cover", { id: "x" });
  await run.write("timings", { select: 10 });

  expect(blob.puts).toEqual([]);
  expect(await run.read("select")).toEqual({ stories: 3 });
});

it("saves a failed run's stages as one object that the rerun resumes from", async () => {
  const failed = store("1");
  await failed.write("select", { stories: 3 });
  await failed.write("cover", { id: "x" });
  await failed.preserve({ failed_stage: "script", kept: await failed.names() });

  expect(blob.puts).toEqual(["podcast-runs/1/failure.json"]);

  const rerun = store("2", "1");
  expect(await rerun.read("select")).toEqual({ stories: 3 });
  expect(await rerun.read("script")).toBeNull();
  // A second failure keeps what the first one kept, though the rerun never read the cover.
  await rerun.preserve({ failed_stage: "script", kept: [] });
  const pack = JSON.parse(
    new TextDecoder().decode(blob.store.get("podcast-runs/2/failure.json")?.body),
  );
  expect(Object.keys(pack.artifacts).sort()).toEqual(["cover", "select"]);
  expect(pack.failed_stage).toBe("script");
});
