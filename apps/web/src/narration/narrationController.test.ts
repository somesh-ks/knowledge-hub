import { beforeEach, describe, expect, it } from "vitest";
import { resumeKey } from "../player/core/resume";
import { createHarness, FakeAudio, makeDigestWithoutAudio } from "../player/core/testing";
import type { PlayerDigestData } from "../types/contracts";
import { createNarrationController, type PassphraseAnswer } from "./narrationController";
import { narrationSource } from "./narrationPlan";
import { forgetNarrated, narratedOrPage } from "./narrationRegistry";
import { createSwitchableAudio } from "./switchableAudio";

const page = makeDigestWithoutAudio();
const ids = page.items.map((item) => item.id);

interface ServerState {
  /** Segment keys that already have a file. */
  narrated: Set<string>;
  passphrase: string;
  /** Answer every POST with this refusal instead of narrating. */
  refuse: { status: number; error: string } | null;
  whole: { url: string; duration_ms: number } | null;
  posts: Array<{ segment: string; passphrase: string }>;
  lookups: number;
}

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
function setup(overrides: Partial<ServerState> = {}) {
  const server: ServerState = {
    narrated: new Set(),
    passphrase: "open sesame",
    refuse: null,
    whole: null,
    posts: [],
    lookups: 0,
    ...overrides,
  };
  const element = new FakeAudio();
  const audio = createSwitchableAudio(element);
  const harness = createHarness({ createAudio: () => audio });
  const remembered = { value: null as string | null };
  const asked: boolean[] = [];
  const answers: Array<PassphraseAnswer | null> = [];
  const said: string[] = [];
  const preparing: Array<string | null> = [];

  const controller = createNarrationController({
    store: harness.store,
    audio,
    api: {
      isOnline: () => true,
      async fetch(url, init) {
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
            segments: ["intro", ...ids].map((key) => segment(key, server)),
          });
        }
        const body = JSON.parse(String(init.body)) as { segment: string; passphrase: string };
        server.posts.push({ segment: body.segment, passphrase: body.passphrase });
        if (body.passphrase !== server.passphrase) {
          return json(401, { status: 401, error: "wrong_passphrase" });
        }
        if (server.refuse) return json(server.refuse.status, server.refuse);
        server.narrated.add(body.segment);
        void url;
        return json(200, { status: 200, segment: segment(body.segment, server) });
      },
    },
    passphrase: {
      get: () => remembered.value,
      set: (answer) => {
        remembered.value = answer.value;
      },
      clear: () => {
        remembered.value = null;
      },
    },
    askPassphrase: ({ wrong }) => {
      asked.push(wrong);
      return Promise.resolve(answers.shift() ?? null);
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
    remembered,
    asked,
    answers,
    said,
    preparing,
    settle,
  };
}

beforeEach(() => {
  forgetNarrated(page.id);
});

describe("prewarm", () => {
  it("makes the intro and the first story in the background, and plays nothing", async () => {
    const { controller, remembered, server, harness, said, asked, settle } = setup();
    remembered.value = "open sesame";
    await controller.prewarm(page);
    await settle();
    expect(server.posts.map((post) => post.segment)).toEqual(["intro", ids[0]]);
    expect(harness.store.getState().status).toBe("idle");
    expect(said).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("a press while it runs joins the request instead of sending another", async () => {
    const { controller, remembered, server, element } = setup();
    remembered.value = "open sesame";
    const warming = controller.prewarm(page);
    await expect(controller.play(page)).resolves.toBe("playing");
    await warming;
    expect(server.lookups).toBe(1);
    expect(server.posts.filter((post) => post.segment === "intro")).toHaveLength(1);
    expect(element.src).toBe("https://store.test/intro.mp3");
  });

  it("does nothing without a passphrase to ask with, and never opens the sheet", async () => {
    const { controller, server, asked, settle } = setup();
    await controller.prewarm(page);
    await settle();
    expect(server.posts).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("stays silent about a refusal, and a press then tries again and says so", async () => {
    const { controller, remembered, server, said, settle } = setup({
      refuse: { status: 429, error: "daily_cap" },
    });
    remembered.value = "open sesame";
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
  it("asks for the passphrase, makes the first file, then plays the briefing as one track", async () => {
    const { controller, answers, server, element, harness, preparing, asked } = setup();
    answers.push({ value: "open sesame", remember: false });
    await expect(controller.play(page)).resolves.toBe("playing");

    expect(asked).toEqual([false]);
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

  it("makes the next story while the first file plays", async () => {
    const { controller, answers, server, element, settle } = setup();
    answers.push({ value: "open sesame", remember: false });
    await controller.play(page);
    element.loadMetadata(3);
    element.startPlaying();
    await settle();
    expect(server.posts.map((post) => post.segment).slice(0, 2)).toEqual(["intro", ids[0]]);
  });

  it("starts from the story that was tapped, and makes that file first", async () => {
    const { controller, answers, server, harness } = setup();
    answers.push({ value: "open sesame", remember: false });
    await controller.play(page, ids[2]);
    expect(server.posts[0]?.segment).toBe(ids[2]);
    expect(harness.store.getState().itemIndex).toBe(2);
  });

  it("plays the tapped story, not a position saved on an earlier visit", async () => {
    const { controller, answers, element, harness, settle } = setup();
    harness.storage.setItem(resumeKey(page.id), "12");
    answers.push({ value: "open sesame", remember: false });
    await controller.play(page, ids[2]);
    await settle();
    expect(harness.store.getState().itemIndex).toBe(2);
    expect(element.src).toBe(`https://store.test/${ids[2]}.mp3`);
  });

  it("needs no passphrase when every story is already narrated", async () => {
    const { controller, asked, server, element } = setup({ narrated: new Set(["intro", ...ids]) });
    await expect(controller.play(page)).resolves.toBe("playing");
    expect(asked).toEqual([]);
    expect(server.posts).toEqual([]);
    expect(element.src).toBe("https://store.test/intro.mp3");
  });

  it("plays the finished single file when someone made one since the page was built", async () => {
    const { controller, element, harness, asked } = setup({
      whole: { url: "https://store.test/whole.mp3", duration_ms: 120_000 },
    });
    await controller.play(page);
    expect(asked).toEqual([]);
    expect(element.src).toBe("https://store.test/whole.mp3");
    expect(harness.store.getState().track?.timeline?.items.map((item) => item.startSec)).toEqual([
      0, 30, 60, 90,
    ]);
  });

  it("asks again after a wrong passphrase, and says it was wrong", async () => {
    const { controller, answers, asked, server, remembered } = setup();
    answers.push({ value: "guess", remember: true }, { value: "open sesame", remember: true });
    await expect(controller.play(page)).resolves.toBe("playing");
    expect(asked).toEqual([false, true]);
    expect(server.posts.map((post) => post.passphrase)).toEqual(["guess", "open sesame"]);
    expect(remembered.value).toBe("open sesame");
  });

  it("forgets a remembered passphrase that the server no longer accepts", async () => {
    const { controller, answers, asked, remembered } = setup();
    remembered.value = "an old one";
    answers.push({ value: "open sesame", remember: false });
    await expect(controller.play(page)).resolves.toBe("playing");
    expect(asked).toEqual([true]);
  });

  it("stops quietly when the listener closes the passphrase sheet", async () => {
    const { controller, harness, said, preparing, server } = setup();
    await expect(controller.play(page)).resolves.toBe("cancelled");
    expect(harness.store.getState().digestId).toBeNull();
    expect(said).toEqual([]);
    expect(server.posts).toEqual([]);
    expect(preparing).toEqual([page.id, null]);
  });

  it("gives up after three wrong passphrases", async () => {
    const { controller, answers, said, server } = setup();
    answers.push(
      { value: "one", remember: false },
      { value: "two", remember: false },
      { value: "three", remember: false },
    );
    await expect(controller.play(page)).resolves.toBe("failed");
    expect(server.posts).toHaveLength(3);
    expect(said).toEqual(["That passphrase is not right. Check it and try again."]);
  });

  it("names a cap in words and never loads the player", async () => {
    const { controller, answers, said, harness } = setup({
      refuse: { status: 429, error: "daily_cap" },
    });
    answers.push({ value: "open sesame", remember: false });
    await expect(controller.play(page)).resolves.toBe("failed");
    expect(said[0]).toMatch(/Today's limit/);
    expect(harness.store.getState().digestId).toBeNull();
  });

  it("looks the briefing up once, and plays it again without asking the server", async () => {
    const { controller, answers, server, harness } = setup();
    answers.push({ value: "open sesame", remember: false });
    await controller.play(page);
    harness.store.pause();
    await expect(controller.play(page, ids[0])).resolves.toBe("playing");
    expect(server.lookups).toBe(1);
  });

  it("hands the page its narrated copy back after a navigation away and back", async () => {
    const { controller, answers } = setup();
    answers.push({ value: "open sesame", remember: false });
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
