import { describe, expect, it } from "vitest";
import {
  AGGREGATOR_SOURCE_TYPES,
  displaySource,
  KNOWN_PUBLISHERS,
  publisherHost,
  publisherName,
} from "./index.js";

describe("publisherHost", () => {
  it("lowercases the host and drops a leading www", () => {
    expect(publisherHost("https://WWW.TheVerge.com/tech/1")).toBe("theverge.com");
    expect(publisherHost("http://www.lmnt.cn/news/274338")).toBe("lmnt.cn");
    expect(publisherHost("https://blog.example.co.uk/a?b=c#d")).toBe("blog.example.co.uk");
  });

  it("returns an empty string for something that is not a URL", () => {
    expect(publisherHost("not a url")).toBe("");
    expect(publisherHost("")).toBe("");
  });
});

describe("publisherName", () => {
  it.each([
    ["https://www.theverge.com/2026/10/6/ipad-pro", "The Verge"],
    ["https://arstechnica.com/gadgets/2026/10/x/", "Ars Technica"],
    ["https://github.com/shadcn-ui/ui/releases/tag/v1", "GitHub"],
    ["https://9to5mac.com/2026/10/06/x/", "9to5Mac"],
    ["https://www.tomshardware.com/pc-components/x", "Tom's Hardware"],
    ["https://dev.to/dotcomjack/designmd-files-1162", "DEV Community"],
    ["https://simonwillison.net/2026/Oct/6/x/", "Simon Willison"],
  ])("names %s as %s", (url, name) => {
    expect(publisherName(url)).toBe(name);
  });

  it("recognises a subdomain of a known publisher, the longest match first", () => {
    expect(publisherName("https://blog.github.com/post")).toBe("GitHub");
    expect(publisherName("https://someone.substack.com/p/x")).toBe("Substack");
    expect(publisherName("https://developer.chrome.com/blog/x")).toBe("Chrome for Developers");
    expect(publisherName("https://dl.acm.org/doi/10.1145/1")).toBe("ACM Digital Library");
  });

  it("falls back to the bare host for a publisher it does not know", () => {
    expect(publisherName("http://www.lmnt.cn/news/274338")).toBe("lmnt.cn");
    expect(publisherName("https://clientconnect.assurant.com/x")).toBe(
      "clientconnect.assurant.com",
    );
    // A host that merely ends with a known name is a different site.
    expect(publisherName("https://nottheverge.com/x")).toBe("nottheverge.com");
    expect(publisherName("nonsense")).toBe("");
  });

  it("keys the table by bare lowercase hosts and covers about thirty publishers", () => {
    const hosts = Object.keys(KNOWN_PUBLISHERS);
    expect(hosts.length).toBeGreaterThanOrEqual(28);
    for (const host of hosts) {
      expect(host).toBe(host.toLowerCase());
      expect(host.startsWith("www.")).toBe(false);
      expect(publisherName(`https://www.${host}/x`)).toBe(KNOWN_PUBLISHERS[host]);
    }
  });
});

describe("displaySource", () => {
  const url = "https://www.theverge.com/2026/10/6/ipad-pro";

  it("credits the publisher for every aggregator source type", () => {
    expect([...AGGREGATOR_SOURCE_TYPES]).toEqual([
      "exa",
      "hn",
      "lobsters",
      "producthunt",
      "reddit",
    ]);
    for (const sourceType of AGGREGATOR_SOURCE_TYPES) {
      expect(displaySource({ url, sourceType, sourceName: "Exa discovery" })).toBe("The Verge");
    }
  });

  it("keeps the registry name for a source that publishes its own items", () => {
    for (const sourceType of [
      "rss",
      "github",
      "youtube",
      "firecrawl",
      "arxiv",
      "crossref",
    ] as const) {
      expect(displaySource({ url, sourceType, sourceName: "Linear" })).toBe("Linear");
    }
  });

  it("credits the publisher for a link-list source, whatever its type", () => {
    expect(
      displaySource({
        url,
        sourceType: "firecrawl",
        sourceName: "Brutalist Report",
        linkSource: true,
      }),
    ).toBe("The Verge");
    expect(
      displaySource({
        url: "https://unknown.example/post",
        sourceType: "rss",
        sourceName: "sidebar.io",
        linkSource: true,
      }),
    ).toBe("unknown.example");
  });

  it("falls back to the registry name when the URL has no host to show", () => {
    expect(displaySource({ url: "nonsense", sourceType: "exa", sourceName: "Exa discovery" })).toBe(
      "Exa discovery",
    );
  });
});
