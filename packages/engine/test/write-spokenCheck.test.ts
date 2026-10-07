import { describe, expect, it } from "vitest";
import { numberValues, spokenIsGrounded, ungroundedNumbers } from "../src/write/spokenCheck.js";

const values = (text: string): number[] => [...numberValues(text)].sort((a, b) => a - b);

describe("numberValues", () => {
  it.each([
    ["799 dollars", [799]],
    ["$1,299 at launch", [1299]],
    ["version 2.0 and 3.5", [2, 3.5]],
    ["up 40% this year", [40]],
    ["forty percent", [40]],
    ["twenty-one teams", [21]],
    ["about a hundred and twenty lines", [120]],
    ["twelve hundred dollars", [1200]],
    ["two thousand and five", [2005]],
    ["4K video", [4000]],
    ["1.2 million users", [1200000]],
    ["a billion dollars", [1e9]],
    ["3 billion", [3e9]],
    ["on the 3rd and 4th", [3, 4]],
    ["an iPhone 17 and a 5G radio", [5, 17]],
  ])("reads %j", (text, expected) => {
    expect(values(text)).toEqual([...expected].sort((a, b) => a - b));
  });

  it("does not count the pronoun 'one'", () => {
    expect(values("No one knows which one it is")).toEqual([]);
    expect(values("one hundred")).toEqual([100]);
  });
});

describe("ungroundedNumbers", () => {
  it("accepts a retelling that says the same numbers another way", () => {
    expect(
      ungroundedNumbers(
        "It costs about a hundred and twenty lines and forty percent less.",
        "Springlet 2.0 retargets springs",
        "The change is 120 lines of code. Memory use drops 40%.",
      ),
    ).toEqual([]);
  });

  it("reports a number the headline and summary do not state", () => {
    expect(
      ungroundedNumbers("It sells for 899 dollars.", "Phone 3 launches", "It costs 799 dollars."),
    ).toEqual([899]);
  });

  it("counts a number from the headline as known", () => {
    expect(spokenIsGrounded("Chrome 140 is out.", "Chrome 140 animates navigation", "Short.")).toBe(
      true,
    );
  });

  it("treats a spoken text with no numbers as grounded", () => {
    expect(spokenIsGrounded("Nothing numeric here.", "Headline", "Summary 5.")).toBe(true);
  });

  it("catches an invented spelled-out number", () => {
    expect(spokenIsGrounded("Nine teams tried it.", "Teams try it", "Seven teams tried it.")).toBe(
      false,
    );
  });
});
