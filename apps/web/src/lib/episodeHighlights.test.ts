import { describe, expect, it } from "vitest";
import { episodeHighlights, HIGHLIGHT_CHARS, trimAtSentence } from "./episodeHighlights";

const source = (item_id: string, url = `https://www.${item_id}.com/story`) => ({
  item_id,
  url,
  headline: `Headline ${item_id}`,
  source: "Exa discovery",
});
const turn = (idx: number, text: string, item_id: string | null) => ({
  idx,
  speaker: "a" as const,
  text,
  item_id,
});

describe("trimAtSentence", () => {
  it("leaves a short text alone", () => {
    expect(trimAtSentence("One. Two.")).toBe("One. Two.");
  });

  it("cuts at the last sentence end that fits", () => {
    const text = `${"First sentence. ".repeat(10)}Tail goes on and on without end`.padEnd(400, "x");
    const out = trimAtSentence(text);
    expect(out.length).toBeLessThanOrEqual(HIGHLIGHT_CHARS);
    expect(out.endsWith("sentence.")).toBe(true);
  });

  it("stops at a word, with an ellipsis, when there is one long sentence", () => {
    const out = trimAtSentence("word ".repeat(100));
    expect(out.length).toBeLessThanOrEqual(HIGHLIGHT_CHARS + 1);
    expect(out.endsWith("word…")).toBe(true);
  });
});

describe("episodeHighlights", () => {
  const episode = {
    sources: [source("a"), source("b"), source("c", "not a url")],
    turns: [
      turn(0, "This is Singularity.", null),
      turn(1, "Host: Story B first.", "b"),
      turn(2, "More on B.", "b"),
      turn(3, "Even more on B.", "b"),
      turn(4, "Story A now.", "a"),
    ],
  };

  it("lists stories in the order they are discussed, unspoken ones last", () => {
    expect(episodeHighlights(episode).map((h) => h.itemId)).toEqual(["b", "a", "c"]);
  });

  it("takes the first two turns of a story, without speaker labels", () => {
    const [b, a, c] = episodeHighlights(episode);
    expect(b?.text).toBe("Story B first. More on B.");
    expect(a?.text).toBe("Story A now.");
    expect(c?.text).toBe("");
  });

  it("carries the bare host, and no link for an address that is not a web url", () => {
    const [b, , c] = episodeHighlights(episode);
    expect(b?.host).toBe("b.com");
    expect(c?.host).toBeNull();
  });
});
