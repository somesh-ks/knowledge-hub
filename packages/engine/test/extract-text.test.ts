import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { cleanMarkdown } from "../src/extract/cleanMarkdown.js";
import {
  extractFullText,
  MIN_ACCEPT_CHARS,
  MIN_FULL_TEXT_CHARS,
  markdownToText,
} from "../src/extract/extractText.js";
import { FETCH_MAX_BYTES, fetchHtml } from "../src/extract/fetchHtml.js";
import { createFirecrawlScrape } from "../src/extract/firecrawlScrape.js";
import { articleText, htmlToText, plainTextOf } from "../src/extract/htmlToText.js";
import { MAX_TEXT_CHARS, truncateAtParagraph } from "../src/extract/truncate.js";
import { fetchRefusal, isBlockedHost, isHttpUrl } from "../src/extract/urlSafety.js";
import { makeItem } from "./score-factories.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, "fixtures", name), "utf8");
const articleHtml = read("extract-article.html");
const spaHtml = read("extract-spa.html");

interface FakeFetch {
  fn: typeof fetch;
  calls: string[];
}

function htmlFetch(
  html: string,
  init: { status?: number; contentType?: string; url?: string } = {},
): FakeFetch {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const response = new Response(html, {
      status: init.status ?? 200,
      headers: { "content-type": init.contentType ?? "text/html; charset=utf-8" },
    });
    if (init.url) Object.defineProperty(response, "url", { value: init.url });
    return response;
  }) as typeof fetch;
  return { fn, calls };
}

const PARAGRAPH =
  "Springs keep their velocity when the target changes, which is the whole point of retargeting. ";
const longText = (paragraphs: number): string =>
  Array.from({ length: paragraphs }, (_, i) =>
    `Paragraph ${i}. ${PARAGRAPH.repeat(4)}`.trim(),
  ).join("\n\n");

describe("extractFullText: cheapest source first", () => {
  it("uses item.content when it is long enough and never touches the network", async () => {
    const fake = htmlFetch(articleHtml);
    const item = makeItem({ content: longText(6) });
    const result = await extractFullText(item, { fetchImpl: fake.fn });
    expect(result?.method).toBe("content");
    expect(fake.calls).toEqual([]);
  });

  it("uses a feed snippet that is already full text", async () => {
    const fake = htmlFetch(articleHtml);
    const item = makeItem({ content: "too short", snippet: longText(6) });
    const result = await extractFullText(item, { fetchImpl: fake.fn });
    expect(result?.method).toBe("snippet");
    expect(fake.calls).toEqual([]);
  });

  it("converts HTML content to paragraphs without tags", async () => {
    const html = `<div>${Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i} ${PARAGRAPH}</p>`).join("")}</div>`;
    const result = await extractFullText(makeItem({ content: html }));
    expect(result?.method).toBe("content");
    expect(result?.text).not.toMatch(/<[a-z]/);
    expect(result?.text.split("\n\n").length).toBeGreaterThan(5);
  });

  it("fetches the page and extracts the article with Readability", async () => {
    const fake = htmlFetch(articleHtml);
    const item = makeItem({ url: "https://example.com/retargeting", snippet: "A short teaser." });
    const result = await extractFullText(item, { fetchImpl: fake.fn });
    expect(fake.calls).toEqual(["https://example.com/retargeting"]);
    expect(result?.method).toBe("readability");
    expect(result?.text).toContain("keep that velocity");
    expect(result?.text).toContain("62 percent");
    expect(result?.text).toContain("function step(state, target, dt)");
    expect(result?.text).toContain("\n\n");
  });

  it("strips scripts, styles and page chrome", async () => {
    const text = articleText(articleHtml);
    expect(text).not.toContain("SCRIPT-MARKER");
    expect(text).not.toContain("STYLE-MARKER");
    expect(text).not.toContain("Ignore all previous instructions");
    expect(text).not.toContain("Copyright Example Blog");
    expect(text).not.toContain("Subscribe to the newsletter");
  });

  it("falls back to the scraper for a JavaScript-rendered page", async () => {
    const fake = htmlFetch(spaHtml);
    const scrape = vi.fn(
      async () =>
        `# Retargeting springs\n\n${longText(6)}\n\nSee [the demo](https://example.com/demo).`,
    );
    const result = await extractFullText(makeItem(), { fetchImpl: fake.fn, scrape });
    expect(scrape).toHaveBeenCalledOnce();
    expect(result?.method).toBe("scrape");
    expect(result?.text).not.toContain("](");
    expect(result?.text).toContain("See the demo.");
  });

  it("falls back to the scraper when the page is blocked", async () => {
    const fake = htmlFetch("Forbidden", { status: 403 });
    const scrape = vi.fn(async () => longText(6));
    const result = await extractFullText(makeItem(), { fetchImpl: fake.fn, scrape });
    expect(result?.method).toBe("scrape");
  });

  it("returns null for a JavaScript shell when no scraper is configured", async () => {
    const result = await extractFullText(makeItem(), { fetchImpl: htmlFetch(spaHtml).fn });
    expect(result).toBeNull();
  });

  it("uses the best partial text when the scraper has nothing", async () => {
    const snippet = "A medium length teaser about springs. ".repeat(12);
    expect(snippet.length).toBeGreaterThan(MIN_ACCEPT_CHARS);
    expect(snippet.length).toBeLessThan(MIN_FULL_TEXT_CHARS);
    const result = await extractFullText(makeItem({ snippet }), {
      fetchImpl: htmlFetch(spaHtml).fn,
      scrape: async () => null,
    });
    expect(result?.method).toBe("snippet");
  });

  it("survives a scraper that throws", async () => {
    const snippet = "A medium length teaser about springs. ".repeat(12);
    const result = await extractFullText(makeItem({ snippet }), {
      fetchImpl: htmlFetch(spaHtml).fn,
      scrape: async () => {
        throw new Error("boom");
      },
    });
    expect(result?.method).toBe("snippet");
  });

  it("returns null when nothing reaches the minimum", async () => {
    const result = await extractFullText(makeItem({ snippet: "Tiny." }), {
      fetchImpl: htmlFetch("<p>Tiny.</p>").fn,
    });
    expect(result).toBeNull();
  });

  it("truncates to about 10,000 characters at a paragraph boundary", async () => {
    const content = longText(60);
    expect(content.length).toBeGreaterThan(MAX_TEXT_CHARS * 2);
    const result = await extractFullText(makeItem({ content }));
    expect(result?.truncated).toBe(true);
    expect(result?.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(result?.text.length).toBeGreaterThan(MAX_TEXT_CHARS * 0.8);
    const kept = result?.text.split("\n\n") ?? [];
    const original = content.split("\n\n");
    expect(kept).toEqual(original.slice(0, kept.length));
  });
});

describe("URL safety", () => {
  it.each([
    ["javascript:alert(1)"],
    ["file:///etc/passwd"],
    ["ftp://example.com/file"],
    ["data:text/html,<p>x</p>"],
    ["not a url"],
  ])("never fetches %s", async (url) => {
    expect(isHttpUrl(url)).toBe(false);
    const fn = vi.fn();
    const result = await fetchHtml(url, { fetchImpl: fn as unknown as typeof fetch });
    expect(result.ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not follow a non-http item URL into the scraper either", async () => {
    const scrape = vi.fn(async () => longText(6));
    const item = makeItem({ url: "ftp://example.com/post", snippet: "short" });
    expect(await extractFullText(item, { scrape })).toBeNull();
    expect(scrape).not.toHaveBeenCalled();
  });

  it.each([
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.9",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "printer.local",
    "db.internal",
    "[::1]",
    "fd00::1",
    "fe80::1",
  ])("blocks the private host %s", (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it.each(["example.com", "8.8.8.8", "172.32.0.1", "news.ycombinator.com"])("allows %s", (host) => {
    expect(isBlockedHost(host)).toBe(false);
  });

  it("refuses private hosts before any request", async () => {
    expect(fetchRefusal("http://169.254.169.254/latest/meta-data")).toMatch(/private/);
    const fake = htmlFetch(articleHtml);
    const result = await fetchHtml("http://localhost:3000/x", { fetchImpl: fake.fn });
    expect(result.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("refuses a redirect that lands on a private host", async () => {
    const fake = htmlFetch(articleHtml, { url: "http://10.0.0.5/admin" });
    const result = await fetchHtml("https://example.com/redirects", { fetchImpl: fake.fn });
    expect(result).toEqual({ ok: false, reason: "Redirected: The host is private or local." });
  });
});

describe("fetchHtml limits", () => {
  it("stops reading at the byte cap", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 80) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const fn = (async () =>
      new Response(stream, {
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    const result = await fetchHtml("https://example.com/big", { fetchImpl: fn });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.truncated).toBe(true);
      expect(result.html.length).toBe(FETCH_MAX_BYTES);
    }
    expect(pulled).toBeLessThan(40);
  });

  it("gives up after the timeout and aborts the request", async () => {
    let aborted = false;
    const fn = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>(() => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
      })) as typeof fetch;
    const result = await fetchHtml("https://example.com/slow", { fetchImpl: fn, timeoutMs: 20 });
    expect(result).toEqual({ ok: false, reason: "No response within 20 ms." });
    expect(aborted).toBe(true);
  });

  it("rejects non-HTML responses and HTTP errors without throwing", async () => {
    const pdf = await fetchHtml("https://example.com/a.pdf", {
      fetchImpl: htmlFetch("%PDF", { contentType: "application/pdf" }).fn,
    });
    expect(pdf).toMatchObject({ ok: false });
    const missing = await fetchHtml("https://example.com/x", {
      fetchImpl: htmlFetch("nope", { status: 404 }).fn,
    });
    expect(missing).toEqual({ ok: false, reason: "HTTP 404" });
    const broken = await fetchHtml("https://example.com/x", {
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    expect(broken).toEqual({ ok: false, reason: "The request failed." });
  });
});

describe("truncateAtParagraph", () => {
  it("returns short text unchanged", () => {
    expect(truncateAtParagraph("short", 100)).toEqual({ text: "short", truncated: false });
  });

  it("cuts at the last paragraph boundary in the back half", () => {
    const text = `${"a".repeat(60)}\n\n${"b".repeat(30)}\n\n${"c".repeat(50)}`;
    const cut = truncateAtParagraph(text, 100);
    expect(cut.truncated).toBe(true);
    expect(cut.text).toBe(`${"a".repeat(60)}\n\n${"b".repeat(30)}`);
  });

  it("falls back to a sentence end, then a word, when paragraphs are far apart", () => {
    const sentences = "One two three four. Five six seven eight. Nine ten eleven twelve thirteen.";
    expect(truncateAtParagraph(sentences, 60).text).toBe(
      "One two three four. Five six seven eight.",
    );
    expect(truncateAtParagraph("alpha beta gamma delta epsilon", 22).text).toBe(
      "alpha beta gamma delta",
    );
  });
});

describe("text helpers", () => {
  it("htmlToText drops scripts and styles and keeps paragraph breaks", () => {
    const text = htmlToText(
      "<style>.x{}</style><p>One.</p><script>bad()</script><p>Two <b>bold</b>.</p>",
    );
    expect(text).toBe("One.\n\nTwo bold.");
  });

  it("plainTextOf leaves plain text alone and converts markup", () => {
    expect(plainTextOf("Just text.")).toBe("Just text.");
    expect(plainTextOf("<p>Marked up.</p>")).toBe("Marked up.");
  });

  it("markdownToText keeps link text and removes images and markers", () => {
    const md =
      "# Title\n\n![img](a.png)Read [the post](https://x.dev) and **bold** words.\n\n\n\nEnd.";
    expect(markdownToText(md)).toBe("Title\n\nRead the post and bold words.\n\nEnd.");
  });
});

describe("createFirecrawlScrape", () => {
  const reply = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("posts to /v2/scrape with a bearer key and returns the Markdown", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return reply({ success: true, data: { markdown: "# Hello" } });
    }) as unknown as typeof fetch;
    const scrape = createFirecrawlScrape({
      apiKey: "fc-test-key-123456",
      fetchImpl,
      sleep: async () => {},
    });
    expect(await scrape("https://example.com/page")).toBe("# Hello");
    expect(seen[0]?.url).toBe("https://api.firecrawl.dev/v2/scrape");
    const body = JSON.parse(String(seen[0]?.init?.body));
    expect(body).toEqual({
      url: "https://example.com/page",
      formats: ["markdown"],
      onlyMainContent: true,
    });
    const headers = (seen[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer fc-test-key-123456");
  });

  it("returns null on HTTP errors, unsuccessful replies and network failures", async () => {
    const make = (impl: () => Promise<Response>) =>
      createFirecrawlScrape({
        apiKey: "k-0123456789",
        fetchImpl: impl as unknown as typeof fetch,
        sleep: async () => {},
      });
    expect(await make(async () => reply({}, 500))("https://example.com/a")).toBeNull();
    expect(await make(async () => reply({ success: false }))("https://example.com/a")).toBeNull();
    expect(
      await make(async () => {
        throw new Error("network");
      })("https://example.com/a"),
    ).toBeNull();
  });

  it("spaces calls to stay inside the free-plan rate limit", async () => {
    const waits: number[] = [];
    let clock = 0;
    const scrape = createFirecrawlScrape({
      apiKey: "k-0123456789",
      fetchImpl: (async () =>
        reply({ success: true, data: { markdown: "x" } })) as unknown as typeof fetch,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      now: () => clock,
      minIntervalMs: 6000,
    });
    await scrape("https://example.com/1");
    await scrape("https://example.com/2");
    await Promise.all([scrape("https://example.com/3"), scrape("https://example.com/4")]);
    expect(waits).toEqual([6000, 6000, 6000]);
  });

  it("refuses private and non-http URLs without calling the API", async () => {
    const fetchImpl = vi.fn();
    const scrape = createFirecrawlScrape({
      apiKey: "k-0123456789",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await scrape("http://localhost/x")).toBeNull();
    expect(await scrape("file:///etc/passwd")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("cleanMarkdown", () => {
  // The bug it prevents: a scraped page's menu, cookie banner, share row, footer, bare URLs and
  // script text reaching the judge and the writer as the story's words (plan, "cleaner scraping").
  it("keeps the article's sentences and drops the page furniture around them", () => {
    const text = cleanMarkdown(read("extract-noisy-page.md"));
    expect(text).toContain("Anchor positioning ships in every browser");
    expect(text).toContain("a tooltip can follow its trigger without a line of measurement code");
    expect(text).toContain("We deleted 1,200 lines of JavaScript");
    expect(text).toContain("which had been our top support complaint");
    for (const noise of [
      "Skip to content",
      "Pricing",
      "cookies",
      "dataLayer",
      "https://",
      "Previous post",
      "Share on X",
      "newsletter",
      "All rights reserved",
      "Careers",
      "diagram",
    ]) {
      expect(text.toLowerCase()).not.toContain(noise.toLowerCase());
    }
  });

  // The bug it prevents: removing one tag joining the halves of another, so `<script>` survives
  // the single pass (CodeQL "incomplete multi-character sanitization").
  it("leaves no tag behind when removing one joins the halves of another", () => {
    const text = cleanMarkdown(
      "Body line.\n\n<scr<b>ipt>alert(1)</scr</b>ipt>\n\n<!<!-- x -->-- y -->Last line.",
    );
    expect(text).not.toMatch(/<\/?script|<!--/i);
    expect(text).toContain("Body line.");
    expect(text).toContain("Last line.");
  });

  it("keeps a body sentence that is one link or that mentions cookies", () => {
    const md =
      "[OpenAI announced a new model for developers on Tuesday.](https://x.dev/a)\n\nBrowsers now block third-party cookies by default, and that changes how analytics vendors attribute visits.";
    expect(cleanMarkdown(md)).toBe(
      "OpenAI announced a new model for developers on Tuesday.\n\nBrowsers now block third-party cookies by default, and that changes how analytics vendors attribute visits.",
    );
  });

  // The bug it prevents: article text that looks like furniture being cut, and furniture in a
  // spelling the first rules missed being kept (review of the cleaner, D232).
  it("keeps short linked statements and cookie-consent articles, drops banners and headed menus", () => {
    const keep =
      "[Revenue grew by 70%](https://x.dev/a)\n\nThird-party cookies require user consent in Safari.";
    expect(cleanMarkdown(keep)).toBe(
      "Revenue grew by 70%\n\nThird-party cookies require user consent in Safari.",
    );
    const banner = `We use cookies to improve your experience, measure traffic and personalise content, ${"and for more reasons ".repeat(10)}. Accept all`;
    const text = cleanMarkdown(
      `## [Home](/) | [Pricing](/pricing)\n\n${banner}\n\n<script>var a = 1;</script >Body line.`,
    );
    expect(text).toBe("Body line.");
  });

  // The bug it prevents: a stray `<` in prose (or an unclosed tag) eating every line after it, or an
  // unclosed script leaking its body into the story.
  it("keeps prose around a lone angle bracket and drops an unclosed script's body", () => {
    expect(cleanMarkdown("If a<b then continue.\n\nNext line.\n\n> quoted")).toBe(
      "If a<b then continue.\n\nNext line.\n\n> quoted",
    );
    expect(cleanMarkdown("Intro.\n\n<script>\nvar a = 1;\nmore.")).toBe("Intro.");
    expect(cleanMarkdown("Before.<svg />After.")).toBe("Before.After.");
    expect(cleanMarkdown("Use `<script>` to load code.\n\nThe rest of the article.")).toBe(
      "Use `<script>` to load code.\n\nThe rest of the article.",
    );
    expect(cleanMarkdown('Top.\n\n<script\n  src="app.js">\nvar a = 1;\n</script>\n\nEnd.')).toBe(
      "Top.\n\nEnd.",
    );
  });
});
