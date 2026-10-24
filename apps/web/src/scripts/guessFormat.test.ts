import { describe, expect, it } from "vitest";
import { guessFormat } from "./topicsPanel";

/**
 * The bug this prevents: unescaped dots in the host patterns let a lookalike host such as
 * notyoutube.com or youtubeXcom pass as YouTube, so a blog was offered as a video source.
 */
describe("guessFormat", () => {
  it("reads the format from the real host and its subdomains only", () => {
    expect(guessFormat("https://www.youtube.com/@name")).toBe("video");
    expect(guessFormat("https://m.youtube.com/@name")).toBe("video");
    expect(guessFormat("https://notyoutube.com/post")).toBe("blog");
    expect(guessFormat("https://youtubeXcom/post")).toBe("blog");
    expect(guessFormat("https://wwwXgithub.com/a/b")).toBe("blog");
  });
});
