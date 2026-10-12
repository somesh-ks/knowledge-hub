import { describe, expect, it } from "vitest";
import { matchesQuery, pickerCount } from "./pickerFilter";

describe("a picker's search", () => {
  // A search that needs the exact text finds nothing for the way a person types a place or a voice.
  it.each([
    ["accents and case are ignored", "São Paulo (GMT-3)", "sao PAULO", true],
    ["the offset is searchable", "Stockholm (GMT+2)", "gmt+2", true],
    ["words match in any order", "Archie, male, British English", "british archie", true],
    ["every word must match", "Archie, male", "archie female", false],
    ["an empty query keeps everything", "Anything", "  ", true],
  ])("%s", (_name, text, query, found) => {
    expect(matchesQuery(text, query)).toBe(found);
  });

  it("counts what is listed, and says when nothing is", () => {
    expect(pickerCount(1, "voice")).toBe("1 voice");
    expect(pickerCount(12, "voice")).toBe("12 voices");
    expect(pickerCount(0, "time zone")).toBe("No time zone matches");
  });
});
