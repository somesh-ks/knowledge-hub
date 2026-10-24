import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SCHEDULE } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { storeChanges } from "./configView";

/** The frozen fixture config the test build is made from, as the function bundles it. */
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "config");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const built = {
  "config/topics.json": read("topics.json"),
  "config/sources.json": read("sources.json"),
  "config/sources.user.json": read("sources.user.json"),
};

function edited() {
  const topics = JSON.parse(built["config/topics.json"]);
  const audio = topics.topics.find((topic: { id: string }) => topic.id === "audio_interfaces");
  audio.name = "Audio UI";
  topics.topics.push({
    ...audio,
    id: "pottery",
    name: "Pottery",
    description: "Glazes and kilns",
    emoji: "🏺",
  });
  const user = JSON.parse(built["config/sources.user.json"]);
  user.added[0].enabled = false;
  user.added.push({
    ...user.added[0],
    id: "kiln-weekly",
    name: "Kiln Weekly",
    url: "https://kiln.example/",
    feed_url: "https://kiln.example/feed.xml",
    enabled: true,
    topic_ids: ["pottery"],
  });
  user.overrides["studio-notes"] = { pinned: true, topic_ids: ["audio_interfaces"] };
  return {
    "config/topics.json": JSON.stringify(topics),
    "config/sources.user.json": JSON.stringify(user),
    "config/schedule.json": JSON.stringify({ ...DEFAULT_SCHEDULE, hour: 9 }),
    "config/profiles/owner.json": JSON.stringify({ blocked_domains: ["spam.example"], votes: [] }),
    // Not JSON: the build's copy stands, as the engine keeps the committed file.
    "config/preferences.json": "{not json",
  };
}

describe("storeChanges: the stored config as edits over the built page (D149)", () => {
  // The bug: with the config store on, an edit made on one device reached no other until a rebuild,
  // and a page built before it showed the old value and sent it back with the next toggle.
  it("reads every kind of edit a page shows, and nothing the build already has", () => {
    expect(storeChanges(built, built)).toEqual({ ops: [], sources: [] });

    const { ops, sources } = storeChanges(built, edited());
    expect(ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: "topic.upsert",
          topic: expect.objectContaining({ id: "audio_interfaces", name: "Audio UI" }),
        }),
        expect.objectContaining({
          op: "topic.upsert",
          topic: expect.objectContaining({ id: "pottery", emoji: "🏺" }),
        }),
        { op: "source.set", id: "sound-desk", enabled: false },
        {
          op: "source.add",
          url: "https://kiln.example/feed.xml",
          id: "kiln-weekly",
          topic_ids: ["pottery"],
        },
        { op: "source.update", id: "studio-notes", topic_ids: ["audio_interfaces"] },
        { op: "schedule.set", hour: 9 },
        { op: "profile.block", domain: "spam.example" },
      ]),
    );
    expect(ops).toHaveLength(7);
    expect(sources.map(({ id, page }) => [id, page]).sort()).toEqual([
      ["kiln-weekly", "pottery"],
      ["studio-notes", "audio_interfaces"],
    ]);
  });

  // The bug: the Create panel kept the built voice after one was chosen for it in Settings, because
  // the read passed on its format and length only.
  it("passes on the Create panel's voices", () => {
    const custom = { ...DEFAULT_SCHEDULE.custom, voice_id: "ada", voice_id_b: "leo" };
    const { ops } = storeChanges(built, {
      "config/schedule.json": JSON.stringify({ ...DEFAULT_SCHEDULE, custom }),
    });
    expect(ops).toContainEqual({
      op: "schedule.set",
      custom: { voice_id: "ada", voice_id_b: "leo" },
    });
  });

  // The bug: a chip that stands for several topics takes a scope edit only when one op covers all of
  // them, and the changes alone (here just the second topic) never did.
  it("sends a changed scope list whole, so a chip of several topics reads it", () => {
    const schedule = (skip: string[]) =>
      JSON.stringify({ ...DEFAULT_SCHEDULE, skip_topics: skip, general_scoped: true });
    const { ops } = storeChanges(
      { ...built, "config/schedule.json": schedule(["design_engineering_craft"]) },
      { "config/schedule.json": schedule(["design_engineering_craft", "product_design"]) },
    );
    expect(ops).toContainEqual({
      op: "topic.scope",
      ids: ["design_engineering_craft", "product_design"],
      daily: false,
    });
  });
});
