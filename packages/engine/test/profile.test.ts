import { describe, expect, it } from "vitest";
import { isBlockedUrl, normalizeDomain } from "../src/profile/profile.js";

describe("normalizeDomain", () => {
  it.each([
    ["Medium.com", "medium.com"],
    ["https://www.medium.com/@someone/post?x=1#top", "medium.com"],
    ["http://user:pw@news.example.co.uk:8080/a", "news.example.co.uk"],
    ["example.com.", "example.com"],
    ["name.substack.com/archive", "name.substack.com"],
    ["localhost", null],
    ["not a domain.com", null],
    ["a..b.com", null],
    ["", null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});

describe("isBlockedUrl", () => {
  it.each([
    ["https://medium.com/a", ["medium.com"], true],
    ["https://www.medium.com/a", ["medium.com"], true],
    ["https://someone.medium.com/a", ["medium.com"], true],
    ["https://notmedium.com/a", ["medium.com"], false],
    ["https://medium.com.evil.example/a", ["medium.com"], false],
    ["https://name.substack.com/p/x", ["name.substack.com"], true],
    ["https://other.substack.com/p/x", ["name.substack.com"], false],
    ["https://substack.com/p/x", ["name.substack.com"], false],
    ["https://fine.example/a", [], false],
    ["not a url", ["medium.com"], false],
  ])("%s with %j -> %s", (url, blocked, expected) => {
    expect(isBlockedUrl(url, blocked)).toBe(expected);
  });
});
