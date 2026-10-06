import { describe, expect, it } from "vitest";
import { isWebUrl } from "./safeUrl";

describe("isWebUrl", () => {
  it("accepts http and https", () => {
    expect(isWebUrl("https://example.com/post")).toBe(true);
    expect(isWebUrl("http://example.com")).toBe(true);
    expect(isWebUrl("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("rejects script and data URLs, however they are written", () => {
    for (const url of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://example.com/x",
    ]) {
      expect(isWebUrl(url), url).toBe(false);
    }
  });

  it("rejects things that are not URLs", () => {
    for (const url of ["", "not a url", "//example.com", "/relative/path"]) {
      expect(isWebUrl(url), url).toBe(false);
    }
  });
});
