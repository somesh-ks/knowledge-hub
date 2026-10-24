import { Item, itemId } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { buildItem, buildItems } from "../src/normalize/buildItem.js";
import { canonicalizeUrl, unwrapRedirect } from "../src/normalize/canonicalizeUrl.js";
import { collapseWhitespace, htmlToText } from "../src/normalize/htmlToText.js";
import { parseFeedDate } from "../src/normalize/parseDate.js";
import { slugify } from "../src/normalize/slugify.js";
import { capSnippet, SNIPPET_MAX } from "../src/normalize/snippet.js";
import { makeSource, NOW, WIDE } from "./fetch-helpers.js";

describe("canonicalizeUrl", () => {
  const table: [string, string, string | null][] = [
    ["lowercases the host", "HTTPS://Example.COM/Path", "https://example.com/Path"],
    ["drops the fragment", "https://example.com/a#section", "https://example.com/a"],
    [
      "drops utm parameters",
      "https://example.com/a?utm_source=x&utm_medium=y&id=3",
      "https://example.com/a?id=3",
    ],
    [
      "drops click ids",
      "https://example.com/a?fbclid=1&gclid=2&msclkid=3&id=3",
      "https://example.com/a?id=3",
    ],
    [
      "drops ref and ref_src",
      "https://example.com/a?ref=newsletter&ref_src=tw",
      "https://example.com/a",
    ],
    ["drops mc_ parameters", "https://example.com/a?mc_cid=1&mc_eid=2", "https://example.com/a"],
    [
      "drops hubspot and mkto tokens",
      "https://example.com/a?_hsenc=x&_hsmi=1&mkt_tok=abc",
      "https://example.com/a",
    ],
    [
      "keeps meaningful parameters sorted",
      "https://example.com/a?b=2&a=1",
      "https://example.com/a?a=1&b=2",
    ],
    ["removes a trailing slash", "https://example.com/a/", "https://example.com/a"],
    ["removes several trailing slashes", "https://example.com/a///", "https://example.com/a"],
    ["makes the root slashless", "https://example.com/", "https://example.com"],
    ["treats root with and without slash the same", "https://example.com", "https://example.com"],
    ["keeps the query on a root path", "https://example.com/?page=2", "https://example.com?page=2"],
    ["removes the default https port", "https://example.com:443/a", "https://example.com/a"],
    ["removes the default http port", "http://example.com:80/a", "http://example.com/a"],
    ["keeps a non-default port", "https://example.com:8443/a", "https://example.com:8443/a"],
    ["drops credentials", "https://user:secret@example.com/a", "https://example.com/a"],
    ["trims surrounding whitespace", "  https://example.com/a  ", "https://example.com/a"],
    ["keeps path case", "https://example.com/CamelCase", "https://example.com/CamelCase"],
    [
      "unwraps a google redirect",
      "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa%3Futm_source%3Dx&sa=D",
      "https://example.com/a",
    ],
    [
      "unwraps a facebook link shim",
      "https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fa&h=AT0",
      "https://example.com/a",
    ],
    [
      "unwraps a generic /redirect endpoint",
      "https://news.example.org/redirect?url=https%3A%2F%2Fexample.com%2Fa",
      "https://example.com/a",
    ],
    [
      "unwraps nested wrappers",
      "https://www.google.com/url?q=https%3A%2F%2Fl.facebook.com%2Fl.php%3Fu%3Dhttps%253A%252F%252Fexample.com%252Fa",
      "https://example.com/a",
    ],
    [
      "unwraps a bare-query wrapper host",
      "https://href.li/?https://example.com/a",
      "https://example.com/a",
    ],
    [
      "leaves a search page with a url-like q alone",
      "https://example.com/search?q=https%3A%2F%2Fother.com",
      "https://example.com/search?q=https%3A%2F%2Fother.com",
    ],
    ["rejects non-http schemes", "ftp://example.com/a", null],
    ["rejects javascript URLs", "javascript:alert(1)", null],
    ["rejects text that is not a URL", "not a url", null],
    ["rejects an empty string", "", null],
  ];
  it.each(table)("%s", (_name, input, expected) => {
    expect(canonicalizeUrl(input)).toBe(expected);
  });

  it("keeps the fragment only when asked, for single-page changelogs", () => {
    expect(canonicalizeUrl("https://example.com/changelog#v2", { keepFragment: true })).toBe(
      "https://example.com/changelog#v2",
    );
    expect(canonicalizeUrl("https://example.com/changelog#", { keepFragment: true })).toBe(
      "https://example.com/changelog",
    );
  });

  it("is idempotent", () => {
    const once = canonicalizeUrl("https://Example.com/a/?utm_source=x&b=2&a=1#f");
    expect(once).not.toBeNull();
    expect(canonicalizeUrl(once as string)).toBe(once);
  });

  it("unwrapRedirect returns null for ordinary pages", () => {
    expect(unwrapRedirect(new URL("https://example.com/blog/post"))).toBeNull();
  });
});

describe("htmlToText", () => {
  it("strips tags and decodes entities", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &hellip; &#8220;ok&#8221; &#x41;</p>")).toBe(
      "Tom & Jerry … “ok” A",
    );
  });

  it("keeps paragraph breaks and drops scripts, styles and comments", () => {
    const html =
      "<style>p{}</style><p>One</p><script>alert(1)</script><!-- note --><p>Two<br>three</p>";
    expect(htmlToText(html)).toBe("One\n\nTwo\nthree");
  });

  it("removes control and invisible direction characters", () => {
    const hidden = `a${String.fromCharCode(0)}b${String.fromCharCode(0x202e)}c${String.fromCharCode(0x200b)}d`;
    expect(htmlToText(hidden)).toBe("abcd");
    expect(collapseWhitespace(`  x${String.fromCharCode(0x202e)}  y  `)).toBe("x y");
  });

  it("leaves unknown entities as written and tolerates bad numeric ones", () => {
    expect(htmlToText("&nosuchentity; &#99999999999;")).toBe("&nosuchentity;");
  });

  it("does not execute or render markup that survives as text", () => {
    expect(htmlToText("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe("<script>alert(1)</script>");
  });
});

describe("capSnippet", () => {
  it("returns short text unchanged and flattens whitespace", () => {
    expect(capSnippet("a  b\n c")).toBe("a b c");
  });

  it("cuts at a word boundary within the cap, ellipsis included", () => {
    const text = `${"word ".repeat(100)}end`;
    const out = capSnippet(text);
    expect(out.length).toBeLessThanOrEqual(SNIPPET_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1).endsWith("word")).toBe(true);
  });

  it("hard-cuts a single long token", () => {
    const out = capSnippet("x".repeat(500));
    expect(out.length).toBeLessThanOrEqual(SNIPPET_MAX);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("parseFeedDate", () => {
  it.each([
    ["2026-10-05T14:38:22Z", "2026-10-05T14:38:22.000Z"],
    ["2026-10-04T20:48:12-07:00", "2026-10-05T03:48:12.000Z"],
    ["2026-10-01T17:00:00+02:00", "2026-10-01T15:00:00.000Z"],
    ["Mon, 06 Jul 2026 13:15:00 GMT", "2026-07-06T13:15:00.000Z"],
    ["Tue, 29 Sep 2026 00:00:00 +0000", "2026-09-29T00:00:00.000Z"],
    ["Tue, 29 Sep 2026 09:00:00 EST", "2026-09-29T14:00:00.000Z"],
    ["Tue, 29 Sep 2026 09:00:00 CEST", "2026-09-29T07:00:00.000Z"],
    ["2026-10-03", "2026-10-03T00:00:00.000Z"],
  ])("parses %s", (input, expected) => {
    expect(parseFeedDate(input)?.toISOString()).toBe(expected);
  });

  it("reads a date-time without an offset as UTC, not local time", () => {
    expect(parseFeedDate("2026-10-03T08:15:00")?.toISOString()).toBe("2026-10-03T08:15:00.000Z");
  });

  it("returns undefined for junk and empty values", () => {
    expect(parseFeedDate("yesterday-ish")).toBeUndefined();
    expect(parseFeedDate("")).toBeUndefined();
    expect(parseFeedDate(undefined)).toBeUndefined();
  });
});

describe("slugify", () => {
  it("produces kebab-case ids", () => {
    expect(slugify("Josh W. Comeau")).toBe("josh-w-comeau");
    expect(slugify("  Café & Crème!! ")).toBe("cafe-creme");
  });
});

describe("buildItem", () => {
  const source = makeSource({ id: "blog" });
  const context = { source, window: WIDE, fetchedAt: NOW };
  const base = {
    url: "https://example.com/post?utm_source=rss",
    title: "  A <b>fine</b> post ",
    publishedAt: "2026-10-03T09:00:00Z",
  };

  it("builds a schema-valid item with a stable id from the canonical URL", () => {
    const item = buildItem(
      { ...base, summary: "<p>Hello &amp; welcome</p>", author: "Ada" },
      context,
    );
    expect(item).not.toBeNull();
    expect(item?.canonical_url).toBe("https://example.com/post");
    expect(item?.id).toBe(itemId("https://example.com/post"));
    expect(item?.title).toBe("A fine post");
    expect(item?.snippet).toBe("Hello & welcome");
    expect(item?.author).toBe("Ada");
    expect(item?.published_at).toBe("2026-10-03T09:00:00.000Z");
    expect(item?.source_id).toBe("blog");
    expect(item?.source_type).toBe("rss");
  });

  it("drops entries without a title or without a usable URL", () => {
    expect(buildItem({ ...base, title: "   " }, context)).toBeNull();
    expect(buildItem({ ...base, title: undefined }, context)).toBeNull();
    expect(buildItem({ ...base, url: undefined }, context)).toBeNull();
    expect(buildItem({ ...base, url: "mailto:a@b.c" }, context)).toBeNull();
    expect(buildItem({ ...base, url: "/relative/only" }, context)).toBeNull();
  });

  it("drops entries outside the window", () => {
    expect(buildItem({ ...base, publishedAt: "2026-06-01T00:00:00Z" }, context)).toBeNull();
    expect(buildItem({ ...base, publishedAt: "2026-12-01T00:00:00Z" }, context)).toBeNull();
  });

  it("tolerates small clock skew into the future but not a day or more", () => {
    expect(
      buildItem({ ...base, publishedAt: new Date(NOW.getTime() + 3 * 3_600_000) }, context),
    ).not.toBeNull();
    expect(
      buildItem({ ...base, publishedAt: new Date(NOW.getTime() + 30 * 3_600_000) }, context),
    ).toBeNull();
  });

  it("drops undated entries unless the caller allows them", () => {
    expect(buildItem({ ...base, publishedAt: undefined }, context)).toBeNull();
    const kept = buildItem({ ...base, publishedAt: undefined }, { ...context, undated: "keep" });
    expect(kept).not.toBeNull();
    expect(kept?.published_at).toBeUndefined();
  });

  it("keeps full text only when it is long enough to matter", () => {
    expect(buildItem({ ...base, content: "<p>short</p>" }, context)?.content).toBeUndefined();
    const long = `<p>${"detail ".repeat(100)}</p>`;
    expect(buildItem({ ...base, content: long }, context)?.content?.length).toBeGreaterThan(300);
  });

  it("carries a query's category hint onto the item, and adds no key without one", () => {
    expect(buildItem(base, context)).not.toHaveProperty("category_hint");
    expect(buildItem(base, { ...context, categoryHint: undefined })).not.toHaveProperty(
      "category_hint",
    );
    const hinted = buildItem(base, { ...context, categoryHint: "consumer_tech_releases" });
    expect(hinted?.category_hint).toBe("consumer_tech_releases");
    expect(Item.safeParse(hinted).success).toBe(true);
    // The hint does not change identity: the same URL is the same item either way.
    expect(hinted?.id).toBe(buildItem(base, context)?.id);
  });

  it("accepts a coverage count of two or more and rejects one that says nothing", () => {
    const item = buildItem(base, context);
    expect(Item.safeParse({ ...item, signals: { coverage: 2 } }).success).toBe(true);
    expect(Item.safeParse({ ...item, signals: { coverage: 9 } }).success).toBe(true);
    expect(Item.safeParse({ ...item, signals: { coverage: 1 } }).success).toBe(false);
    expect(Item.safeParse({ ...item, signals: { coverage: 2.5 } }).success).toBe(false);
    expect(Item.safeParse({ ...item, category_hint: "not_a_category" }).success).toBe(false);
  });

  it("builds in order and skips the bad ones", () => {
    const items = buildItems(
      [base, { ...base, title: "" }, { ...base, url: "https://example.com/other" }],
      context,
    );
    expect(items.map((i) => i.canonical_url)).toEqual([
      "https://example.com/post",
      "https://example.com/other",
    ]);
  });
});
