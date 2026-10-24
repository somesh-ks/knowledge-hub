import { describe, expect, it } from "vitest";
import { type EpisodePrewarmDeps, prewarmEpisode } from "./prewarmEpisode";

const ID = "ep-20261011-1930";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const turn = (key: string) => ({ key, item_id: null, characters: 300, audio: null });

const lookupBody = {
  status: 200,
  audio: null,
  timeline: null,
  ms_per_character: 62,
  segments: [turn("t0"), turn("t1"), turn("t2"), turn("t3")],
};

function made(key: string) {
  return json(200, {
    status: 200,
    segment: {
      ...turn(key),
      audio: { url: `https://store.test/${key}.mp3`, duration_ms: 4_000, confirmed: true },
    },
  });
}

function setup(
  options: {
    allowed?: boolean;
    answer?: (url: string, body: { segment?: string } | null) => Response;
  } = {},
) {
  const calls: { url: string; segment: string | null }[] = [];
  const deps: EpisodePrewarmDeps = {
    api: {
      async fetch(url, init) {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, segment: body?.segment ?? null });
        if (options.answer) return options.answer(url, body);
        return init?.method === "POST" ? made(body.segment) : json(200, lookupBody);
      },
      isOnline: () => true,
    },
    allowed: () => options.allowed ?? true,
  };
  return { deps, calls };
}

describe("prewarmEpisode", () => {
  it("looks the episode up, then narrates its first two turns one after the other", async () => {
    const { deps, calls } = setup();
    await prewarmEpisode(ID, deps);
    expect(calls).toEqual([
      { url: `/api/narrate?digest=${ID}`, segment: null },
      { url: "/api/narrate", segment: "t0" },
      { url: "/api/narrate", segment: "t1" },
    ]);
  });

  it("stops at the first refusal, so a cap or the budget costs one request and no error", async () => {
    const { deps, calls } = setup({
      answer: (_url, body) =>
        body ? json(429, { status: 429, error: "daily_cap" }) : json(200, lookupBody),
    });
    await expect(prewarmEpisode(ID, deps)).resolves.toBeUndefined();
    expect(calls.map((call) => call.segment)).toEqual([null, "t0"]);
  });

  it("asks nothing where the browser or the tab says no", async () => {
    const { deps, calls } = setup({ allowed: false });
    await prewarmEpisode(ID, deps);
    expect(calls).toEqual([]);
  });

  it("is silent when the network fails", async () => {
    const { deps } = setup();
    deps.api.fetch = () => Promise.reject(new TypeError("offline"));
    await expect(prewarmEpisode(ID, deps)).resolves.toBeUndefined();
  });
});
