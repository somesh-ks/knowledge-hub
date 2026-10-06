import { describe, expect, it } from "vitest";
import { serializeJsonForScript } from "./serializeJson";

describe("serializeJsonForScript", () => {
  it("round-trips ordinary data", () => {
    const value = { id: "2026-10-07", items: [1, 2, { a: "b" }], ok: true, none: null };
    expect(JSON.parse(serializeJsonForScript(value))).toEqual(value);
  });

  it("cannot close the script element", () => {
    const text = serializeJsonForScript({ headline: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
  });

  it("cannot open an HTML comment or an entity", () => {
    const text = serializeJsonForScript({ headline: "<!-- Tom & Jerry -->" });
    expect(text).not.toContain("<!--");
    expect(text).not.toContain("&");
  });

  it("escapes the line and paragraph separators", () => {
    const separators = `${String.fromCodePoint(0x2028)}${String.fromCodePoint(0x2029)}`;
    const text = serializeJsonForScript({ note: separators });
    expect(text).not.toContain(String.fromCodePoint(0x2028));
    expect(text).not.toContain(String.fromCodePoint(0x2029));
    expect(JSON.parse(text).note).toBe(separators);
  });

  it("keeps text outside those characters readable", () => {
    expect(serializeJsonForScript({ title: "Wednesday 7 October" })).toBe(
      '{"title":"Wednesday 7 October"}',
    );
  });
});
