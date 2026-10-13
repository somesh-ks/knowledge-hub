import { describe, expect, it } from "vitest";
import { topicArt, topicInitial } from "./topicArt.js";

describe("topicArt", () => {
  it("is the same picture for the same topic and a different one for another, so a topic keeps its face", () => {
    expect(topicArt("culture", "Culture")).toBe(topicArt("culture", "Culture"));
    const ids = ["culture", "world", "design", "ai", "audio_interfaces", "sport", "science"];
    expect(new Set(ids.map((id) => topicArt(id, id))).size).toBe(ids.length);
  });

  it("keeps the picture when the topic is renamed, and escapes the letter it draws", () => {
    const before = topicArt("culture", "Culture");
    expect(topicArt("culture", "Arts").replace(">A<", ">C<")).toBe(before);
    expect(topicArt("x", "<b>")).not.toContain("<b>");
  });

  it("takes the first letter or digit of a name", () => {
    expect(topicInitial("  état")).toBe("É");
    expect(topicInitial("3D printing")).toBe("3");
    expect(topicInitial("...")).toBe("?");
  });
});
