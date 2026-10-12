import { describe, expect, it } from "vitest";
import { modelOp, parseModelList } from "./podcastPage";
import { scheduleOp } from "./podcastProfiles";

describe("scheduleOp", () => {
  const was = {
    "daily.hour": "7",
    "daily.voice": "",
    "daily.format": "readout",
    "weekly.enabled": "true",
    "weekly.day": "0",
    "weekly.length": "10",
    "weekly.voice": "",
    "weekly.voice_b": "",
  };

  it("is null while nothing differs", () => {
    expect(scheduleOp(was, { ...was })).toBeNull();
  });

  it("sends only the changed fields, each in its own profile", () => {
    const now = {
      ...was,
      "daily.hour": "9",
      "daily.voice": "v1",
      "daily.format": "discussion",
      "weekly.enabled": "false",
      "weekly.day": "5",
      "weekly.voice": "v2",
      "weekly.voice_b": "v3",
    };
    expect(scheduleOp(was, now)).toEqual({
      op: "schedule.set",
      hour: 9,
      voice_id: "v1",
      format: "discussion",
      weekly: { enabled: false, day: 5, voice_id: "v2", voice_id_b: "v3" },
    });
  });

  // Filed under `weekly`, the Weekly page's zone was dropped by the server as an unknown field.
  it("sends the time zone at the top of the op from either profile", () => {
    const zone = { "weekly.timezone": "Europe/Stockholm" };
    expect(scheduleOp(zone, { "weekly.timezone": "Asia/Tokyo" })).toEqual({
      op: "schedule.set",
      timezone: "Asia/Tokyo",
    });
  });

  it("turns the default voice back into null and the cadence into days", () => {
    expect(
      scheduleOp(
        { "daily.voice": "v1", "daily.cadence": "2" },
        { "daily.voice": "", "daily.cadence": "7" },
      ),
    ).toEqual({
      op: "schedule.set",
      voice_id: null,
      cadence_days: 7,
    });
  });
});

describe("modelOp", () => {
  it("builds writer.set for a model and for Automatic", () => {
    expect(modelOp("a/b")).toEqual({ op: "writer.set", provider: "nebius", model: "a/b" });
    expect(modelOp(null)).toEqual({ op: "writer.set", provider: "nebius", model: null });
    expect(modelOp("claude-haiku-5-5", "anthropic")).toEqual({
      op: "writer.set",
      provider: "anthropic",
      model: "claude-haiku-5-5",
    });
  });
});

describe("parseModelList", () => {
  it("reads the API's shape and skips ids that are not valid", () => {
    expect(
      parseModelList({
        provider: "nebius",
        models: [
          { id: "a/b", context_length: 4096 },
          { id: "bad id", context_length: 1 },
          { id: "c", context_length: null },
        ],
      }),
    ).toEqual([
      { id: "a/b", context_length: 4096 },
      { id: "c", context_length: null },
    ]);
  });

  it("refuses anything else", () => {
    for (const bad of [null, "x", {}, { models: "no" }, { models: [1] }]) {
      expect(parseModelList(bad)).toBeNull();
    }
  });
});

describe("pending writer storage", () => {
  function createMockStorage(): Storage {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    };
  }

  it("writes, reads, and clears pending choices", async () => {
    const { clearPendingChoice, readPendingChoice, writePendingChoice } = await import(
      "./podcastPage"
    );
    const storage = createMockStorage();
    expect(readPendingChoice(storage)).toBeNull();

    writePendingChoice("nebius", "custom/model", storage);
    const read = readPendingChoice(storage);
    expect(read).not.toBeNull();
    expect(read?.provider).toBe("nebius");
    expect(read?.model).toBe("custom/model");

    clearPendingChoice(storage);
    expect(readPendingChoice(storage)).toBeNull();
  });

  it("rejects expired or malformed pending choices", async () => {
    const { readPendingChoice } = await import("./podcastPage");
    const storage = createMockStorage();
    storage.setItem("dispatch:writer-pending", "not-json");
    expect(readPendingChoice(storage)).toBeNull();

    storage.setItem(
      "dispatch:writer-pending",
      JSON.stringify({ provider: "nebius", model: "a", timestamp: Date.now() - 30 * 60 * 1000 }),
    );
    expect(readPendingChoice(storage)).toBeNull();
  });

  it("writes and reads cached catalog", async () => {
    const { readCachedCatalog, writeCachedCatalog } = await import("./podcastPage");
    const storage = createMockStorage();
    expect(readCachedCatalog(storage)).toBeNull();

    const sample = [{ id: "meta/llama", context_length: 8192 }];
    writeCachedCatalog(sample, storage);
    expect(readCachedCatalog(storage)).toEqual(sample);
  });
});
