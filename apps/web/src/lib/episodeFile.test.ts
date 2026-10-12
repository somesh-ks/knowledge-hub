import { describe, expect, it } from "vitest";
import { EPISODE_ID, parseEpisodeFile } from "./episodeFile";

const front = [
  "id: ep-20261007-1930",
  "title: The week in AI",
  "request:",
  "  topic_ids: [ai, research]",
  "  length_minutes: 5",
  "  format: discussion",
  "  window_days: 7",
  "  tone: energetic",
  "generated_at: 2026-10-07T17:30:00.000Z",
  "listen_minutes: 5",
  "format: discussion",
  "sources:",
  "  - item_id: aaa111",
  "    url: https://example.com/a",
  "    headline: First story",
  "    source: Example",
  "turns:",
  "  - idx: 1",
  "    speaker: b",
  "    text: Second turn.",
  "    item_id: aaa111",
  "  - idx: 0",
  "    speaker: a",
  "    text: First turn.",
  "char_count: 24",
  "cover:",
  "  palette: ultramarine",
  "  template: orbit",
  "  seed: 7",
].join("\n");

const file = (yaml = front) => `---\n${yaml}\n---\n\nThe script as text.\n`;

describe("EPISODE_ID", () => {
  it("matches ep-YYYYMMDD-HHmm and nothing else", () => {
    expect(EPISODE_ID.test("ep-20261007-1930")).toBe(true);
    for (const bad of [
      "2026-10-07",
      "ep-2026-10-07",
      "ep-20261007-193",
      "ep-20261007-1930x",
      "x-ep",
    ]) {
      expect(EPISODE_ID.test(bad), bad).toBe(false);
    }
  });
});

describe("parseEpisodeFile", () => {
  it("reads a whole episode, with the turns in the file's own order", () => {
    const episode = parseEpisodeFile(file());
    expect(episode).toMatchObject({
      id: "ep-20261007-1930",
      title: "The week in AI",
      // 17:30 UTC is 19:30 in Stockholm on the same day.
      date: "2026-10-07",
      generated_at: "2026-10-07T17:30:00.000Z",
      listen_minutes: 5,
      format: "discussion",
      char_count: 24,
      request: {
        topic_ids: ["ai", "research"],
        length_minutes: 5,
        window_days: 7,
        tone: "energetic",
      },
      cover: { palette: "ultramarine", template: "orbit", seed: 7 },
    });
    expect(episode.turns.map((turn) => [turn.idx, turn.speaker, turn.item_id])).toEqual([
      [0, "a", null],
      [1, "b", "aaa111"],
    ]);
    expect(episode.sources).toEqual([
      {
        item_id: "aaa111",
        url: "https://example.com/a",
        headline: "First story",
        source: "Example",
      },
    ]);
  });

  it("dates an episode by the Stockholm day, not the UTC one", () => {
    const episode = parseEpisodeFile(
      file(front.replace("2026-10-07T17:30:00.000Z", "2026-10-07T22:30:00.000Z")),
    );
    expect(episode.date).toBe("2026-10-08");
  });

  it("reads a Windows file", () => {
    expect(parseEpisodeFile(file().replace(/\n/g, "\r\n")).id).toBe("ep-20261007-1930");
  });

  it("ignores fields it does not know and fills the ones a file leaves out", () => {
    const episode = parseEpisodeFile(
      file(
        [
          "id: ep-20261007-1930",
          "generated_at: 2026-10-07T17:30:00.000Z",
          "future_field: [1, 2]",
          "turns:",
          `  - { speaker: a, text: "${"x".repeat(1920)}" }`,
          "  - { speaker: z, text: Hello there. }",
          '  - { speaker: a, text: "   " }',
        ].join("\n"),
      ),
    );
    expect(episode.title).toBe("Your episode");
    expect(episode.format).toBe("readout");
    expect(episode.request).toMatchObject({ length_minutes: 5, window_days: 2, tone: "neutral" });
    expect(episode.sources).toEqual([]);
    expect(episode.cover).toBeNull();
    // The blank turn is dropped, an unknown speaker is the first host, and the index is the position.
    expect(episode.turns.map((turn) => [turn.idx, turn.speaker])).toEqual([
      [0, "a"],
      [1, "a"],
    ]);
    expect(episode.char_count).toBe(1920 + "Hello there.".length);
    expect(episode.listen_minutes).toBe(2);
  });

  it("keeps the hosts' names a discussion was written with, and only real names", () => {
    const named = (names: string) =>
      parseEpisodeFile(
        file(front.replace("  tone: energetic", `  tone: energetic\n  host_names: ${names}`)),
      ).request.host_names;
    expect(parseEpisodeFile(file()).request).not.toHaveProperty("host_names");
    expect(named("{ a: Zoë, b: O’Neil }")).toEqual({ a: "Zoë", b: "O’Neil" });
    for (const bad of ["{ a: Nora }", "{ a: Nora Jones, b: Owen }", "{ a: 4, b: Owen }", "Nora"]) {
      expect(named(bad), bad).toBeUndefined();
    }
  });

  it("falls back to the requested title, and keeps a repeated index once", () => {
    const episode = parseEpisodeFile(
      file(
        [
          "id: ep-20261007-1930",
          "generated_at: 2026-10-07T17:30:00.000Z",
          "request: { title: My title }",
          "turns:",
          "  - { idx: 3, speaker: a, text: One }",
          "  - { idx: 3, speaker: b, text: Two }",
        ].join("\n"),
      ),
    );
    expect(episode.title).toBe("My title");
    expect(episode.turns.map((turn) => turn.text)).toEqual(["One"]);
  });

  it("refuses a file that cannot be an episode", () => {
    const cases: Array<[string, string]> = [
      ["no frontmatter", "Just text"],
      ["never closed", "---\nid: ep-20261007-1930\n"],
      ["not a mapping", "---\n- a\n---\n"],
      ["bad id", file(front.replace("ep-20261007-1930", "2026-10-07"))],
      ["no turns", file(front.replace(/turns:[\s\S]*char_count/, "char_count"))],
      ["no time", file(front.replace(/generated_at: .*\n/, ""))],
    ];
    for (const [name, text] of cases) expect(() => parseEpisodeFile(text), name).toThrow();
  });
});
