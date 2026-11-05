import { describe, expect, it } from "vitest";
import {
  fetchVoiceList,
  parseVoiceDefaults,
  parseVoices,
  voiceFlag,
  voiceKeywords,
  voiceLabel,
} from "./voices";

describe("parseVoices", () => {
  it("reads the API's shape and skips rows without an id or a name", () => {
    expect(
      parseVoices({
        voices: [
          {
            id: "a",
            name: "Ada",
            gender: "female",
            language: "en-US",
            preview_url: "https://x/a.mp3",
          },
          { id: "", name: "No id" },
          { id: "b", name: "Leo", gender: 3 },
          7,
        ],
      }),
    ).toEqual([
      { id: "a", name: "Ada", gender: "female", language: "en-US", preview_url: "https://x/a.mp3" },
      { id: "b", name: "Leo", gender: null, language: null, preview_url: null },
    ]);
  });

  it("refuses anything else", () => {
    for (const bad of [null, "x", {}, { voices: "no" }]) expect(parseVoices(bad)).toBeNull();
  });
});

describe("voiceLabel", () => {
  it("adds the gender when there is one", () => {
    const base = { id: "a", name: "Ada", language: null, preview_url: null };
    expect(voiceLabel({ ...base, gender: "Female" })).toBe("Ada, female");
    expect(voiceLabel({ ...base, gender: null })).toBe("Ada");
  });

  it("stays plain text whatever the accent: the flag is drawn, never typed", () => {
    const base = { id: "a", name: "Ada", gender: "Female", preview_url: null };
    expect(voiceLabel({ ...base, language: "en-GB" })).toBe("Ada, female");
  });
});

describe("voiceKeywords", () => {
  // The picker's search must find a voice by its accent as a person says it, not by its code.
  it("names the accent in words beside its locale, and nothing for an unknown one", () => {
    const voice = { id: "a", name: "Archie", gender: "male", language: "en-GB", preview_url: null };
    expect(voiceKeywords(voice)).toBe("British English en-GB");
    expect(voiceKeywords({ ...voice, language: null })).toBe("");
    // The flag reads en_GB, so the words must too.
    expect(voiceKeywords({ ...voice, language: "en_GB" })).toBe("British English en_GB");
  });
});

describe("voiceFlag", () => {
  it("reads a locale's region, and nothing from a locale without one", () => {
    expect(voiceFlag("en-US")).toBe("US");
    expect(voiceFlag("en_au")).toBe("AU");
    for (const language of [null, "", "en", "en-419", "en-Latn"])
      expect(voiceFlag(language)).toBe("");
  });
});

describe("parseVoiceDefaults", () => {
  it("reads the defaults beside the list, or null without them", () => {
    expect(parseVoiceDefaults({ voices: [], defaults: { voice: "a", voice_b: "b" } })).toEqual({
      voice: "a",
      voice_b: "b",
    });
    expect(parseVoiceDefaults({ voices: [] })).toBeNull();
    expect(parseVoiceDefaults(null)).toBeNull();
  });
});

describe("fetchVoiceList", () => {
  const answer = (ok: boolean, body: unknown = { voices: [] }) =>
    Promise.resolve({ ok, json: () => Promise.resolve(body) });
  const noWait = () => Promise.resolve();

  it("tries again once when the first try fails, so one weak moment does not empty the picker", async () => {
    const calls: string[] = [];
    const fetcher = (url: string) => {
      calls.push(url);
      return calls.length === 1
        ? Promise.reject(new Error("network"))
        : answer(true, { voices: [1] });
    };
    const result = await fetchVoiceList({ fetch: fetcher, online: () => true, wait: noWait });
    expect(result).toEqual({ body: { voices: [1] } });
    expect(calls).toHaveLength(2);
  });

  it("retries a refused answer and then gives up as unavailable", async () => {
    let tries = 0;
    const result = await fetchVoiceList({
      fetch: () => {
        tries++;
        return answer(false);
      },
      online: () => true,
      wait: noWait,
    });
    expect(result).toEqual({ failure: "unavailable" });
    expect(tries).toBe(2);
  });

  it("says offline at once, without trying, when the device has no connection", async () => {
    let tries = 0;
    const result = await fetchVoiceList({
      fetch: () => {
        tries++;
        return answer(true);
      },
      online: () => false,
      wait: noWait,
    });
    expect(result).toEqual({ failure: "offline" });
    expect(tries).toBe(0);
  });

  it("says offline when the connection went while it tried", async () => {
    let online = true;
    const result = await fetchVoiceList({
      fetch: () => {
        online = false;
        return Promise.reject(new Error("network"));
      },
      online: () => online,
      wait: noWait,
    });
    expect(result).toEqual({ failure: "offline" });
  });
});
