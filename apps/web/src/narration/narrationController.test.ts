import { beforeEach, describe, expect, it } from "vitest";
import { resumeKey } from "../player/core/resume";
import { createHarness, FakeAudio, makeDigestWithoutAudio } from "../player/core/testing";
import type { PlayerDigestData } from "../types/contracts";
import { createNarrationController } from "./narrationController";
import { narrationSource } from "./narrationPlan";
import { forgetNarrated, narratedOrPage } from "./narrationRegistry";
import { createSwitchableAudio } from "./switchableAudio";

const page = makeDigestWithoutAudio();
const ids = page.items.map((item) => item.id);

interface ServerState {
  /** Segment keys that already have a file. */
  narrated: Set<string>;
  /** Answer every POST with this refusal instead of narrating. */
  refuse: { status: number; error: string } | null;
  whole: { url: string; duration_ms: number } | null;
  /** An episode stored as one Opus file: its manifest as the store answers it (null: listed, but not there). */
  opus: { manifest: unknown | null } | null;
  posts: Array<{ segment: string }>;
  lookups: number;
  manifestFetches: number;
}

const OPUS_URL = "https://store.test/episode.abc.m4a";
const OPUS_MANIFEST = "https://store.test/episode.abc.json";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function segment(key: string, state: ServerState) {
  return {
    key,
    item_id: key === "intro" ? null : key,
    characters: key === "intro" ? 50 : 300,
    audio: state.narrated.has(key)
      ? { url: `https://store.test/${key}.mp3`, duration_ms: key === "intro" ? 3_000 : 18_000 }
      : null,
  };
}

/** The real store, adapter, queue and controller, over a fake element and a fake /api/narrate. */
function setup(overrides: Partial<ServerState> = {}, canPlayType: () => string = () => "") {
  const server: ServerState = {
    narrated: new Set(),
    refuse: null,
    whole: null,
    opus: null,
    posts: [],
    lookups: 0,
    manifestFetches: 0,
    ...overrides,
  };
  const element = new FakeAudio();
  const audio = createSwitchableAudio(element);
  const harness = createHarness({ createAudio: () => audio, canPlayType });
  const said: string[] = [];
  const preparing: Array<string | null> = [];

  const controller = createNarrationController({
    store: harness.store,
    audio,
    canPlayType,
    api: {
      isOnline: () => true,
      async fetch(url, init) {
        if (url === OPUS_MANIFEST) {
          server.manifestFetches += 1;
          return server.opus?.manifest ? json(200, server.opus.manifest) : json(404, {});
        }
        if (!init?.method) {
          server.lookups += 1;
          return json(200, {
            status: 200,
            audio: server.whole,
            timeline: server.whole
              ? {
                  kind: "marks",
                  items: ids.map((id, index) => ({
                    id,
                    section: page.items[index]?.section,
                    start_ms: index * 30_000,
                    end_ms: (index + 1) * 30_000,
                  })),
                  sections: page.sections.map((entry, index) => ({
                    slug: entry.slug,
                    start_ms: index * 30_000,
                  })),
                }
              : null,
            ms_per_character: 60,
            ...(server.opus ? { opus: { url: OPUS_URL, manifest_url: OPUS_MANIFEST } } : {}),
            segments: ["intro", ...ids].map((key) => segment(key, server)),
          });
        }
        const body = JSON.parse(String(init.body)) as { segment: string };
        server.posts.push({ segment: body.segment });
        if (server.refuse) return json(server.refuse.status, server.refuse);
        server.narrated.add(body.segment);
        void url;
        return json(200, { status: 200, segment: segment(body.segment, server) });
      },
    },
    notify: (message) => said.push(message),
    setPreparing: (digestId) => preparing.push(digestId),
  });

  const settle = async () => {
    for (let turn = 0; turn < 6; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return {
    server,
    element,
    harness,
    controller,
    said,
    preparing,
    settle,
  };
}

beforeEach(() => {
  forgetNarrated(page.id);
});

const MANIFEST = {
  duration_ms: 3_000 + ids.length * 18_000,
  turns: ["intro", ...ids].map((key, index) => ({
    key,
    start_ms: index === 0 ? 0 : 3_000 + (index - 1) * 18_000,
    end_ms: index === 0 ? 3_000 : 3_000 + index * 18_000,
  })),
};
const SUPPORTED = () => "probably";

describe("an episode stored as one Opus file", () => {
  it("plays the single file, lays turns where the file has them, and narrates nothing", async () => {
    const { controller, server, element, harness } = setup(
      { narrated: new Set(["intro", ...ids]), opus: { manifest: MANIFEST } },
      SUPPORTED,
    );
    await expect(controller.play(page)).resolves.toBe("playing");
    expect(element.src).toBe(OPUS_URL);
    expect(server.posts).toEqual([]);
    expect(harness.store.getState().track?.timeline?.items.map((item) => item.startSec)).toEqual(
      ids.map((_, index) => 3 + index * 18),
    );
  });

  it("plays the turns when the file is not there, the manifest is for other turns, or the browser cannot decode it", async () => {
    const all = new Set(["intro", ...ids]);
    const wrong = { ...MANIFEST, turns: MANIFEST.turns.slice(1) };
    for (const [state, can] of [
      [{ narrated: all, opus: { manifest: null } }, SUPPORTED],
      [{ narrated: all, opus: { manifest: wrong } }, SUPPORTED],
      [{ narrated: all, opus: { manifest: MANIFEST } }, () => ""],
    ] as const) {
      forgetNarrated(page.id);
      const { controller, server, element } = setup(state, can);
      await controller.play(page);
      expect(element.src).toBe("https://store.test/intro.mp3");
      expect(server.manifestFetches).toBe(can() === "" ? 0 : 1);
    }
  });

  it("an episode without one plays its turns as before", async () => {
    const { controller, server, element } = setup(
      { narrated: new Set(["intro", ...ids]) },
      SUPPORTED,
    );
    await controller.play(page);
    expect(element.src).toBe("https://store.test/intro.mp3");
    expect(server.manifestFetches).toBe(0);
  });

  it("falls back to the turns when the browser cannot play the file", async () => {
    const { controller, element, harness } = setup(
      { narrated: new Set(["intro", ...ids]), opus: { manifest: MANIFEST } },
      SUPPORTED,
    );
    await controller.play(page);
    expect(element.src).toBe(OPUS_URL);
    element.error = { code: 4 };
    element.emit("error");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(element.src).toBe("https://store.test/intro.mp3");
    expect(harness.store.getState().track?.digest.audio?.url).toBe(narrationSource(page.id));
  });
});

describe("prewarm", () => {
  it("makes the intro and the first story in the background, and plays nothing", async () => {
    const { controller, server, harness, said, settle } = setup();
    await controller.prewarm(page);
    await settle();
    expect(server.posts.map((post) => post.segment)).toEqual(["intro", ids[0]]);
    expect(harness.store.getState().status).toBe("idle");
    expect(said).toEqual([]);
  });

  it("a press while it runs joins the request instead of sending another", async () => {
    const { controller, server, element } = setup();
    const warming = controller.prewarm(page);
    await expect(controller.play(page)).resolves.toBe("playing");
    await warming;
    expect(server.lookups).toBe(1);
    expect(server.posts.filter((post) => post.segment === "intro")).toHaveLength(1);
    expect(element.src).toBe("https://store.test/intro.mp3");
  });

  it("stays silent about a refusal, and a press then tries again and says so", async () => {
    const { controller, server, said, settle } = setup({
      refuse: { status: 429, error: "daily_cap" },
    });
    await controller.prewarm(page);
    await settle();
    expect(said).toEqual([]);
    expect(server.posts).toHaveLength(1);
    await expect(controller.play(page)).resolves.toBe("failed");
    expect(server.posts).toHaveLength(2);
    expect(said).toHaveLength(1);
  });
});

describe("createNarrationController", () => {
  it("makes the first file, then plays the briefing as one track", async () => {
    const { controller, server, element, harness, preparing } = setup();
    await expect(controller.play(page)).resolves.toBe("playing");

    // The intro is made before the player hears about the briefing at all.
    expect(server.posts[0]?.segment).toBe("intro");
    expect(element.src).toBe("https://store.test/intro.mp3");
    const state = harness.store.getState();
    expect(state.digestId).toBe(page.id);
    expect(state.track?.digest.audio?.url).toBe(narrationSource(page.id));
    expect(state.track?.timeline?.items).toHaveLength(4);
    expect(state.status).toBe("loading");
    expect(preparing).toEqual([page.id, null]);
  });

  it("a play cancelled while it prepares never starts (the listener picked another queue item)", async () => {
    const { controller, harness, preparing } = setup();
    const outcome = controller.play(page);
    controller.cancel();
    await expect(outcome).resolves.toBe("cancelled");
    expect(harness.store.getState().digestId).not.toBe(page.id);
    expect(preparing.at(-1)).toBeNull();
  });

  it("makes the next story while the first file plays", async () => {
    const { controller, server, element, settle } = setup();
    await controller.play(page);
    element.loadMetadata(3);
    element.startPlaying();
    await settle();
    expect(server.posts.map((post) => post.segment).slice(0, 2)).toEqual(["intro", ids[0]]);
  });

  it("starts from the story that was tapped, and makes that file first", async () => {
    const { controller, server, harness } = setup();
    await controller.play(page, ids[2]);
    expect(server.posts[0]?.segment).toBe(ids[2]);
    expect(harness.store.getState().itemIndex).toBe(2);
  });

  it("plays the tapped story, not a position saved on an earlier visit", async () => {
    const { controller, element, harness, settle } = setup();
    harness.storage.setItem(resumeKey(page.id), "12");
    await controller.play(page, ids[2]);
    await settle();
    expect(harness.store.getState().itemIndex).toBe(2);
    expect(element.src).toBe(`https://store.test/${ids[2]}.mp3`);
  });

  it("confirms only the first file when every story is already narrated", async () => {
    const { controller, server, element } = setup({ narrated: new Set(["intro", ...ids]) });
    await expect(controller.play(page)).resolves.toBe("playing");
    expect(server.posts).toEqual([{ segment: "intro" }]);
    expect(element.src).toBe("https://store.test/intro.mp3");
  });

  it("plays the finished single file when someone made one since the page was built", async () => {
    const { controller, element, harness } = setup({
      whole: { url: "https://store.test/whole.mp3", duration_ms: 120_000 },
    });
    await controller.play(page);
    expect(element.src).toBe("https://store.test/whole.mp3");
    expect(harness.store.getState().track?.timeline?.items.map((item) => item.startSec)).toEqual([
      0, 30, 60, 90,
    ]);
  });

  it("names a cap in words and never loads the player", async () => {
    const { controller, said, harness } = setup({
      refuse: { status: 429, error: "daily_cap" },
    });
    await expect(controller.play(page)).resolves.toBe("failed");
    expect(said[0]).toBe("Daily narration limit reached. Try again tomorrow.");
    expect(harness.store.getState().digestId).toBeNull();
  });

  it("looks the briefing up once, and plays it again without asking the server", async () => {
    const { controller, server, harness } = setup();
    await controller.play(page);
    harness.store.pause();
    await expect(controller.play(page, ids[0])).resolves.toBe("playing");
    expect(server.lookups).toBe(1);
  });

  it("hands the page its narrated copy back after a navigation away and back", async () => {
    const { controller } = setup();
    await controller.play(page);
    const again: PlayerDigestData = makeDigestWithoutAudio();
    const patched = narratedOrPage(again);
    expect(patched.audio?.url).toBe(narrationSource(page.id));
    expect(patched.items.every((item) => item.start_ms !== null)).toBe(true);
    // A page that was rebuilt with finished audio wins over the session's copy.
    const rebuilt = { ...again, audio: { url: "/audio/x.mp3", duration_ms: 1 } };
    expect(narratedOrPage(rebuilt)).toBe(rebuilt);
  });
});
