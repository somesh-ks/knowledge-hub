import { describe, expect, it } from "vitest";
import { sourceHost, sourceLinkLabel } from "./sourceLabel";

describe("sourceHost", () => {
  it("returns the host without www", () => {
    expect(sourceHost("https://www.theverge.com/tech/1001859/fairbuds-2")).toBe("theverge.com");
    expect(sourceHost("https://arstechnica.com/ai/2026/09/story/")).toBe("arstechnica.com");
    expect(sourceHost("http://www.lmnt.cn/news/274338")).toBe("lmnt.cn");
  });

  it("keeps meaningful subdomains and lowercases the host", () => {
    expect(sourceHost("https://blog.google/products/pixel/")).toBe("blog.google");
    expect(sourceHost("HTTPS://News.YCombinator.com/item?id=1")).toBe("news.ycombinator.com");
  });

  it("drops the port, path, query and credentials", () => {
    expect(sourceHost("https://user:secret@example.com:8443/a?b=c#d")).toBe("example.com");
  });

  it("returns null for anything that must not be a link", () => {
    for (const url of [
      "",
      null,
      undefined,
      "not a url",
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "//example.com",
    ]) {
      expect(sourceHost(url), String(url)).toBeNull();
    }
  });
});

describe("sourceLinkLabel", () => {
  it("starts with the host the link shows and says it opens a new tab", () => {
    expect(sourceLinkLabel("theverge.com")).toBe("theverge.com (opens in a new tab)");
  });
});
