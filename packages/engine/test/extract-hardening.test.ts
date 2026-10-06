import { describe, expect, it } from "vitest";
import { fetchHtml } from "../src/extract/fetchHtml.js";
import { htmlTooComplex, MAX_DEPTH, MAX_ELEMENTS } from "../src/extract/htmlLimits.js";
import { articleText, htmlToText } from "../src/extract/htmlToText.js";
import { fetchRefusal, isBlockedHost } from "../src/extract/urlSafety.js";

type Reply = Response | ((url: string) => Response);

/** A fetch that plays back replies in order and records every URL it was asked for. */
function scripted(replies: Reply[]): {
  fn: typeof fetch;
  calls: string[];
  modes: Array<string | undefined>;
} {
  const calls: string[] = [];
  const modes: Array<string | undefined> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    modes.push(init?.redirect);
    const next = replies.shift();
    if (!next) throw new Error("no scripted reply left");
    return typeof next === "function" ? next(String(input)) : next;
  }) as typeof fetch;
  return { fn, calls, modes };
}

const html = (body = "<p>Hello</p>"): Response =>
  new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const redirect = (location: string | null, status = 302): Response =>
  new Response(null, { status, headers: location ? { location } : {} });

describe("private host detection beyond the obvious forms", () => {
  it.each([
    "http://localhost./",
    "http://LOCALHOST/",
    "http://metadata.google.internal./computeMetadata/v1/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[::ffff:c0a8:101]/",
    "http://[::1]/",
    "http://[fd12:3456::1]/",
    "http://[fec0::1]/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://017700000001/",
  ])("refuses %s", (url) => {
    expect(fetchRefusal(url)).toMatch(/private|local/);
  });

  it.each([
    "http://[::ffff:808:808]/",
    "http://8.8.8.8/",
    "https://example.com./",
    "http://[2606:4700::1111]/",
  ])("allows %s", (url) => {
    expect(fetchRefusal(url)).toBeNull();
  });

  it("normalizes a trailing dot on bare hostnames", () => {
    expect(isBlockedHost("localhost.")).toBe(true);
    expect(isBlockedHost("printer.local.")).toBe(true);
    expect(isBlockedHost("example.com.")).toBe(false);
  });
});

describe("fetchHtml follows redirects by hand", () => {
  it("never requests a redirect target that is private", async () => {
    const fake = scripted([redirect("http://169.254.169.254/latest/meta-data/"), html()]);
    const result = await fetchHtml("https://example.com/start", { fetchImpl: fake.fn });
    expect(result).toEqual({ ok: false, reason: "Redirected: The host is private or local." });
    expect(fake.calls).toEqual(["https://example.com/start"]);
  });

  it("checks every hop, not only the last one", async () => {
    const fake = scripted([
      redirect("https://cdn.example.com/a"),
      redirect("http://[::ffff:7f00:1]/admin"),
      html(),
    ]);
    const result = await fetchHtml("https://example.com/start", { fetchImpl: fake.fn });
    expect(result.ok).toBe(false);
    expect(fake.calls).toEqual(["https://example.com/start", "https://cdn.example.com/a"]);
  });

  it("asks fetch not to follow redirects itself", async () => {
    const fake = scripted([html()]);
    await fetchHtml("https://example.com/a", { fetchImpl: fake.fn });
    expect(fake.modes).toEqual(["manual"]);
  });

  it("follows a normal redirect, resolving a relative location", async () => {
    const fake = scripted([redirect("/moved/here", 301), html("<p>Landed</p>")]);
    const result = await fetchHtml("https://example.com/old", { fetchImpl: fake.fn });
    expect(fake.calls).toEqual(["https://example.com/old", "https://example.com/moved/here"]);
    expect(result).toMatchObject({ ok: true, finalUrl: "https://example.com/moved/here" });
  });

  it("stops after five redirects", async () => {
    const fake = scripted(Array.from({ length: 8 }, () => redirect("/again")));
    const result = await fetchHtml("https://example.com/loop", { fetchImpl: fake.fn });
    expect(result).toEqual({ ok: false, reason: "Too many redirects." });
    expect(fake.calls).toHaveLength(6);
  });

  it("reports a redirect with no location or a bad one", async () => {
    expect(
      await fetchHtml("https://example.com/a", { fetchImpl: scripted([redirect(null)]).fn }),
    ).toMatchObject({
      ok: false,
    });
    expect(
      await fetchHtml("https://example.com/a", {
        fetchImpl: scripted([redirect("http://[bad")]).fn,
      }),
    ).toMatchObject({ ok: false, reason: "The redirect location is not a valid URL." });
  });

  it("refuses a non-http redirect target", async () => {
    const fake = scripted([redirect("file:///etc/passwd")]);
    const result = await fetchHtml("https://example.com/a", { fetchImpl: fake.fn });
    expect(result).toMatchObject({ ok: false });
    expect(fake.calls).toHaveLength(1);
  });
});

describe("parser guards", () => {
  const nested = (depth: number): string => `${"<div>".repeat(depth)}text${"</div>".repeat(depth)}`;

  it("flags nesting deeper than the limit and accepts the limit itself", () => {
    expect(htmlTooComplex(nested(MAX_DEPTH + 1))).toBe(true);
    expect(htmlTooComplex(nested(MAX_DEPTH))).toBe(false);
  });

  it("flags too many elements", () => {
    expect(htmlTooComplex("<span>x</span>".repeat(MAX_ELEMENTS + 1))).toBe(true);
    expect(htmlTooComplex("<span>x</span>".repeat(1000))).toBe(false);
  });

  it("does not count void or self-closing elements as nesting", () => {
    expect(htmlTooComplex("<br>".repeat(1000))).toBe(false);
    expect(htmlTooComplex("<img src=x>".repeat(1000))).toBe(false);
    expect(htmlTooComplex("<div/>".repeat(1000))).toBe(false);
  });

  it("returns no text, quickly, for a hostile deeply nested page", () => {
    const started = Date.now();
    expect(articleText(nested(2000))).toBe("");
    expect(htmlToText(nested(2000))).toBe("");
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("still reads ordinary pages", () => {
    expect(htmlToText("<div><p>One.</p><p>Two.</p></div>")).toBe("One.\n\nTwo.");
  });
});
