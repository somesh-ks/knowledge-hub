import { describe, expect, it } from "vitest";
import { storyText } from "./storyText";

describe("storyText", () => {
  // The transcript of a briefing must read what the host says, not the page's headline and summary.
  it("reads the spoken version alone when the digest has one", () => {
    expect(
      storyText({
        headline: "A headline",
        summary: "A summary.",
        spoken: "  The host\nsays this. ",
      }),
    ).toBe("The host says this.");
  });

  it("falls back to the headline and the summary, each a sentence", () => {
    expect(storyText({ headline: "Springlet 2.0 ships", summary: "It keeps velocity." })).toBe(
      "Springlet 2.0 ships. It keeps velocity.",
    );
    expect(storyText({ headline: "Is it done?", summary: "Not yet:" })).toBe(
      "Is it done? Not yet.",
    );
  });
});
