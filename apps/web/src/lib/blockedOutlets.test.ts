import { describe, expect, it } from "vitest";
import {
  blockedDomainOf,
  customBlock,
  filterBlocked,
  matchesQuery,
  savedBlocked,
} from "./blockedOutlets";

describe("blocking a source by what is typed", () => {
  it("reduces a pasted page address to the domain, subdomains covered", () => {
    expect(blockedDomainOf("https://www.Example.com:8080/a/b?c=1#d")).toBe("example.com");
    expect(blockedDomainOf("user@news.example.co.uk/x")).toBe("news.example.co.uk");
    expect(blockedDomainOf("not a domain")).toBeNull();
    expect(blockedDomainOf("localhost")).toBeNull();
  });

  it("filters the blocked list by name or by a pasted link, and offers a new domain only when unblocked", () => {
    const blocked = ["example.com", "news.other.org"];
    expect(filterBlocked(blocked, "")).toEqual(blocked);
    expect(filterBlocked(blocked, "OTHER")).toEqual(["news.other.org"]);
    expect(filterBlocked(blocked, "https://www.example.com/story")).toEqual(["example.com"]);
    expect(filterBlocked(blocked, "nothing")).toEqual([]);
    expect(matchesQuery("The Verge theverge.com", "verge com")).toBe(true);
    expect(customBlock("https://fresh.dev/a", new Set(blocked))).toBe("fresh.dev");
    expect(customBlock("example.com", new Set(blocked))).toBeNull();
    expect(customBlock("verge", new Set(blocked))).toBeNull();
  });

  it("lays saved blocks and unblocks over the built list in order", () => {
    expect(
      savedBlocked(
        ["a.com"],
        [
          { op: "profile.block", domain: "https://www.b.com/x" },
          { op: "profile.unblock", domain: "a.com" },
        ],
      ),
    ).toEqual(["b.com"]);
  });
});
