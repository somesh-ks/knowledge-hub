import { describe, expect, it } from "vitest";
import { type ApiDeps, failureCopy, lookupNarration, narrateSegment } from "./narrationApi";

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function deps(answer: () => Response | Promise<Response>, online = true) {
  const calls: Call[] = [];
  const api: ApiDeps = {
    fetch(url, init) {
      calls.push({ url, init });
      return Promise.resolve().then(answer);
    },
    isOnline: () => online,
  };
  return { api, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const lookupBody = {
  status: 200,
  audio: null,
  timeline: null,
  ms_per_character: 62,
  segments: [
    {
      key: "intro",
      item_id: null,
      characters: 58,
      audio: { url: "https://store.test/audio/x/seg/intro.abc.mp3", duration_ms: 3_600 },
    },
    { key: "a1b2c3d4e5f6", item_id: "a1b2c3d4e5f6", characters: 412, audio: null },
  ],
};

describe("lookupNarration", () => {
  it("asks by briefing id and returns the track list", async () => {
    const { api, calls } = deps(() => json(200, lookupBody));
    const result = await lookupNarration("2026-10-07", api);
    expect(calls[0]?.url).toBe("/api/narrate?digest=2026-10-07");
    expect(calls[0]?.init?.method).toBeUndefined();
    expect(result).toEqual({
      ok: true,
      msPerCharacter: 62,
      whole: null,
      segments: [
        {
          key: "intro",
          item_id: null,
          characters: 58,
          audio: {
            url: "https://store.test/audio/x/seg/intro.abc.mp3",
            duration_ms: 3_600,
            confirmed: false,
          },
        },
        { key: "a1b2c3d4e5f6", item_id: "a1b2c3d4e5f6", characters: 412, audio: null },
      ],
    });
  });

  it("returns the finished single file when the briefing has one", async () => {
    const { api } = deps(() =>
      json(200, {
        ...lookupBody,
        audio: { url: "https://store.test/audio/x.mp3", duration_ms: 480_000 },
        timeline: { kind: "marks", items: [], sections: [] },
      }),
    );
    const result = await lookupNarration("2026-10-07", api);
    expect(result.ok && result.whole).toEqual({
      url: "https://store.test/audio/x.mp3",
      duration_ms: 480_000,
      timeline: { kind: "marks", items: [], sections: [] },
    });
  });

  it("treats a file that is not https or same-site as not narrated", async () => {
    const { api } = deps(() =>
      json(200, {
        ...lookupBody,
        segments: [
          {
            key: "intro",
            item_id: null,
            characters: 58,
            audio: { url: "javascript:alert(1)", duration_ms: 3_600 },
          },
          {
            key: "b",
            item_id: "b",
            characters: 10,
            audio: { url: "http://plain.test/b.mp3", duration_ms: 900 },
          },
          {
            key: "c",
            item_id: "c",
            characters: 10,
            audio: { url: "//elsewhere.test/c.mp3", duration_ms: 900 },
          },
        ],
      }),
    );
    const result = await lookupNarration("2026-10-07", api);
    expect(result.ok && result.segments.map((segment) => segment.audio)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("refuses the whole list when one entry is malformed", async () => {
    const { api } = deps(() =>
      json(200, { ...lookupBody, segments: [...lookupBody.segments, { key: 7 }] }),
    );
    expect(await lookupNarration("2026-10-07", api)).toEqual({ ok: false, reason: "failed" });
  });

  it("names the server's refusals", async () => {
    for (const [status, error, reason] of [
      [404, "digest_not_found", "digest_not_found"],
      [422, "not_narratable", "not_narratable"],
      [503, "unavailable", "unavailable"],
      [400, "invalid_request", "failed"],
    ] as const) {
      const { api } = deps(() => json(status, { status, error }));
      expect(await lookupNarration("2026-10-07", api)).toEqual({ ok: false, reason });
    }
  });

  it("does not trust an error code or a timeline it does not recognise", async () => {
    const odd = deps(() => json(500, { status: 500, error: "constructor" }));
    expect(await lookupNarration("x", odd.api)).toEqual({ ok: false, reason: "failed" });
    const broken = deps(() =>
      json(200, {
        ...lookupBody,
        audio: { url: "https://store.test/audio/x.mp3", duration_ms: 480_000 },
        timeline: { kind: "marks", items: [null], sections: [] },
      }),
    );
    const result = await lookupNarration("2026-10-07", broken.api);
    expect(result.ok && result.whole?.timeline).toBeNull();
  });

  it("tells a deployment without narration from a bad moment", async () => {
    const missing = deps(() => new Response("Method Not Allowed", { status: 405 }));
    expect(await lookupNarration("x", missing.api)).toEqual({ ok: false, reason: "unavailable" });
    const timeout = deps(() => new Response("<html>504</html>", { status: 504 }));
    expect(await lookupNarration("x", timeout.api)).toEqual({ ok: false, reason: "failed" });
  });

  it("tells offline from a failed request", async () => {
    const boom = () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await lookupNarration("x", deps(boom, false).api)).toEqual({
      ok: false,
      reason: "offline",
    });
    expect(await lookupNarration("x", deps(boom, true).api)).toEqual({
      ok: false,
      reason: "failed",
    });
  });
});

describe("narrateSegment", () => {
  it("posts the briefing, the segment and the passphrase, and returns the file", async () => {
    const { api, calls } = deps(() =>
      json(200, {
        status: 200,
        segment: {
          key: "a1b2c3d4e5f6",
          item_id: "a1b2c3d4e5f6",
          characters: 412,
          audio: { url: "https://store.test/audio/x/seg/a.def.mp3", duration_ms: 25_500 },
        },
      }),
    );
    const result = await narrateSegment("2026-10-07", "a1b2c3d4e5f6", "open sesame", api);
    expect(result).toEqual({ ok: true, url: "https://store.test/audio/x/seg/a.def.mp3" });
    expect(calls[0]?.url).toBe("/api/narrate");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      digest: "2026-10-07",
      passphrase: "open sesame",
      segment: "a1b2c3d4e5f6",
    });
  });

  it("does not accept an answer for a different segment, or one with no file", async () => {
    const other = deps(() =>
      json(200, {
        status: 200,
        segment: {
          key: "zzz",
          item_id: "zzz",
          characters: 1,
          audio: { url: "https://store.test/z.mp3", duration_ms: 900 },
        },
      }),
    );
    expect(await narrateSegment("d", "a", "p", other.api)).toEqual({ ok: false, reason: "failed" });
    const empty = deps(() =>
      json(200, { status: 200, segment: { key: "a", item_id: "a", characters: 1, audio: null } }),
    );
    expect(await narrateSegment("d", "a", "p", empty.api)).toEqual({ ok: false, reason: "failed" });
  });

  it("names the refusals that stop narration", async () => {
    for (const [status, error] of [
      [401, "wrong_passphrase"],
      [429, "daily_cap"],
      [429, "monthly_budget"],
    ] as const) {
      const { api } = deps(() => json(status, { status, error, retry_after_s: 60 }));
      expect(await narrateSegment("d", "a", "p", api)).toEqual({ ok: false, reason: error });
    }
  });

  it("treats a voice or storage failure as worth another try", async () => {
    for (const error of ["synthesis_failed", "storage_failed", "took_too_long"]) {
      const { api } = deps(() => json(502, { status: 502, error }));
      expect(await narrateSegment("d", "a", "p", api)).toEqual({ ok: false, reason: "failed" });
    }
  });
});

describe("failureCopy", () => {
  const reasons = [
    "passphrase_required",
    "wrong_passphrase",
    "daily_cap",
    "monthly_budget",
    "not_narratable",
    "digest_not_found",
    "segment_not_found",
    "unavailable",
    "offline",
    "failed",
  ] as const;

  it("says what happened and what to do, in plain sentences", () => {
    for (const reason of reasons) {
      const message = failureCopy(reason, "briefing");
      if (reason === "passphrase_required") {
        expect(message).toBeNull();
        continue;
      }
      expect(message, reason).toMatch(/^[A-Z].*\.$/);
      expect(message, reason).not.toMatch(/[\u2014\u2013!]/);
      // It never explains the interface ("the text is still here to read").
      expect(message, reason).not.toMatch(/still here/);
      // Where a failure stops playback the disc says Try again, so no copy sends the listener to Play.
      expect(message, reason).not.toMatch(/press play/i);
    }
  });

  it("names an episode as an episode", () => {
    expect(failureCopy("not_narratable", "episode")).toBe("This episode cannot be read aloud.");
    expect(failureCopy("digest_not_found", "episode")).toMatch(/^This episode /);
    for (const reason of reasons)
      expect(failureCopy(reason, "episode") ?? "").not.toMatch(/briefing/);
    expect(failureCopy("daily_cap", "episode")).toBe(
      "Daily narration limit reached. Try again tomorrow.",
    );
  });
});

describe("describeNarrationFailure", () => {
  it("does not repeat a Try again the notice already offers", async () => {
    const { describeNarrationFailure } = await import("./narrationApi");
    expect(describeNarrationFailure("failed", "briefing")?.message).toBe(
      "The audio could not be made.",
    );
    expect(describeNarrationFailure("daily_cap", "briefing")?.standing).toBe(true);
    expect(describeNarrationFailure("failed", "briefing")?.standing).toBe(false);
  });

  it("says a failed file one way, in the notice and on the bar", async () => {
    const { describeNarrationFailure } = await import("./narrationApi");
    expect(describeNarrationFailure("failed", "briefing")?.summary).toBe(
      "Audio could not be made",
    );
  });

  it("treats the server's 503 as passing: Try again, not a refusal that stands", async () => {
    const { describeNarrationFailure } = await import("./narrationApi");
    expect(describeNarrationFailure("unavailable", "briefing")).toEqual({
      message: "Narration is not available right now.",
      summary: "Narration is not available",
      standing: false,
    });
  });
});
