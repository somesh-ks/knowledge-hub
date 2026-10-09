import { describe, expect, it } from "vitest";
import { handleSiteIcon, iconResponse, MAX_ICON_BYTES } from "./siteIcon";

const PUBLIC = async () => ["93.184.216.34"];
const png = (init: ResponseInit = {}, size = 10) =>
  new Response(new Uint8Array(size).fill(1), {
    status: 200,
    headers: { "content-type": "image/png" },
    ...init,
  });

const run = (url: string | null, fetch: (u: string) => Promise<Response>, resolve = PUBLIC) =>
  handleSiteIcon(url, { fetch: (input) => fetch(input), resolve });

describe("handleSiteIcon", () => {
  it("returns the bytes and the upstream content type", async () => {
    const result = await run("https://a.example/favicon.ico", async () => png());
    expect(result).toMatchObject({ status: 200, contentType: "image/png" });
    expect(result.bytes?.byteLength).toBe(10);
  });

  it("refuses anything that is not https on the default port without credentials", async () => {
    let called = 0;
    const fetch = async () => (called++, png());
    for (const bad of [
      null,
      "",
      "http://a.example/i.png",
      "https://a.example:8443/i.png",
      "https://u:p@a.example/i.png",
      "not a url",
    ]) {
      expect((await run(bad, fetch)).status, String(bad)).toBe(404);
    }
    expect(called).toBe(0);
  });

  it("refuses a host that resolves to a private address, even beside a public one", async () => {
    let called = 0;
    const fetch = async () => (called++, png());
    for (const addresses of [["127.0.0.1"], ["10.0.0.5"], ["93.184.216.34", "169.254.169.254"]]) {
      expect((await run("https://a.example/i.png", fetch, async () => addresses)).status).toBe(404);
    }
    expect(called).toBe(0);
  });

  it("refuses a content type that is not an image", async () => {
    const html = async () => new Response("<p>", { headers: { "content-type": "text/html" } });
    expect((await run("https://a.example/", html)).status).toBe(404);
    const none = async () => new Response("x");
    expect((await run("https://a.example/", none)).status).toBe(404);
  });

  it("refuses an image over 256 KB, by header or by counting", async () => {
    const declared = async () =>
      png({
        headers: { "content-type": "image/png", "content-length": String(MAX_ICON_BYTES + 1) },
      });
    expect((await run("https://a.example/i.png", declared)).status).toBe(404);
    const counted = async () => png({}, MAX_ICON_BYTES + 1);
    expect((await run("https://a.example/i.png", counted)).status).toBe(404);
    const exact = async () => png({}, MAX_ICON_BYTES);
    expect((await run("https://a.example/i.png", exact)).status).toBe(200);
  });

  it("follows a redirect on the same host and refuses one to another host", async () => {
    const same = async (u: string) =>
      u.endsWith("/old")
        ? new Response(null, { status: 301, headers: { location: "/new.png" } })
        : png();
    expect((await run("https://a.example/old", same)).status).toBe(200);
    const cross = async () =>
      new Response(null, { status: 302, headers: { location: "https://b.example/i.png" } });
    expect((await run("https://a.example/old", cross)).status).toBe(404);
  });

  it("is a 404 for an upstream error, a loop and a slow answer", async () => {
    expect(
      (await run("https://a.example/", async () => new Response("", { status: 500 }))).status,
    ).toBe(404);
    const loop = async () => new Response(null, { status: 302, headers: { location: "/again" } });
    expect((await run("https://a.example/", loop)).status).toBe(404);
    const slow = await handleSiteIcon("https://a.example/", {
      resolve: PUBLIC,
      timeoutMs: 20,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    });
    expect(slow.status).toBe(404);
  });
});

describe("iconResponse", () => {
  it("caches an icon for a day and sandboxes it", () => {
    const response = iconResponse({
      status: 200,
      bytes: new Uint8Array([1]),
      contentType: "image/svg+xml",
    });
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400, immutable");
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("is a bare 404 when there is nothing", () => {
    expect(iconResponse({ status: 404 }).status).toBe(404);
  });
});
