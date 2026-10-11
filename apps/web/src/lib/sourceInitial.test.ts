import { describe, expect, it } from "vitest";
import { sourceInitial } from "./sourceInitial";

describe("sourceInitial", () => {
  it("takes the first letter or digit of the name, as a capital", () => {
    expect(sourceInitial("design week")).toBe("D");
    expect(sourceInitial("  The Verge")).toBe("T");
    expect(sourceInitial("9to5Mac")).toBe("9");
    expect(sourceInitial("“Quoted” News")).toBe("Q");
    expect(sourceInitial("été")).toBe("É");
  });

  it("falls back to a question mark when the name has no letter or digit", () => {
    expect(sourceInitial("*** !")).toBe("?");
    expect(sourceInitial("")).toBe("?");
  });
});
