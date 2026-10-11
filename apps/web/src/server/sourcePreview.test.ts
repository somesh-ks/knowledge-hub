import { PreviewError, type SourcePreview } from "@dispatch/engine/source-preview";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertPublicHost,
  CACHE_TTL_MS,
  GuardError,
  guardedFetch,
  handleSourcePreview,
  isBlockedAddress,
  MAX_URL_CHARS,
  parseTargetUrl,
  RATE_LIMIT,
  resetSourcePreviewState,
} from "./sourcePreview";

const PUBLIC = "93.184.216.34";
const resolvePublic = async (): Promise<string[]> => [PUBLIC];

const PREVIEW: SourcePreview = {
  url: "https://news.example.com/",
  name: "Example",
  host: "news.example.com",
  favicon_url: null,
  thumbnail_url: null,
  feed_url: "https://news.example.com/feed.xml",
  kind: "feed",
  latest_at: null,
  items_30d: 3,
  score: 2.4,
  score_label: "Good",
  score_parts: { health: 0.55, quality: 0.95, trust: 1 },
  reason: "Valid feed.",
};

beforeEach(() => resetSourcePreviewState());

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "127.8.8.8",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "not an address",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "172.15.0.1",
    "172.32.0.1",
    "100.63.0.1",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe("parseTargetUrl", () => {
  it("accepts a plain https address", () => {
    expect(parseTargetUrl("https://news.example.com/feed").hostname).toBe("news.example.com");
  });

  it.each([
    ["http", "http://example.com/"],
    ["ftp", "ftp://example.com/"],
    ["javascript", "javascript:alert(1)"],
    ["file", "file:///etc/passwd"],
    ["credentials", "https://user:pass@example.com/"],
    ["username only", "https://user@example.com/"],
    ["a custom port", "https://example.com:8443/"],
    ["garbage", "not a url"],
    ["empty", ""],
  ])("rejects %s", (_name, raw) => {
    expect(() => parseTargetUrl(raw)).toThrow(GuardError);
  });

  it("rejects an address over the length limit", () => {
    const long = `https://example.com/${"a".repeat(MAX_URL_CHARS)}`;
    expect(() => parseTargetUrl(long)).toThrow(GuardError);
    const fits = `https://example.com/${"a".repeat(MAX_URL_CHARS - 20)}`;
    expect(fits.length).toBe(MAX_URL_CHARS);
    expect(() => parseTargetUrl(fits)).not.toThrow();
  });
});

describe("assertPublicHost", () => {
  const check = (raw: string, resolve = resolvePublic) =>
    assertPublicHost(parseTargetUrl(raw), resolve);

  it("allows a host that resolves to public addresses", async () => {
    await expect(check("https://news.example.com/")).resolves.toBeUndefined();
  });

  it("rejects ip literals in private ranges, in v4 and v6 form", async () => {
    await expect(check("https://127.0.0.1/")).rejects.toThrow(GuardError);
    await expect(check("https://169.254.169.254/latest/meta-data")).rejects.toThrow(GuardError);
    await expect(check("https://[::1]/")).rejects.toThrow(GuardError);
    await expect(check("https://[::ffff:10.0.0.1]/")).rejects.toThrow(GuardError);
    await expect(check("https://10.1.2.3/")).rejects.toThrow(GuardError);
  });

  it("accepts a public ip literal without resolving", async () => {
    const resolve = vi.fn(resolvePublic);
    await check("https://93.184.216.34/", resolve);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects local names without resolving", async () => {
    const resolve = vi.fn(resolvePublic);
    await expect(check("https://localhost/", resolve)).rejects.toThrow(GuardError);
    await expect(check("https://app.localhost/", resolve)).rejects.toThrow(GuardError);
    await expect(check("https://metadata.google.internal/", resolve)).rejects.toThrow(GuardError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a name that resolves to a private address", async () => {
    await expect(check("https://rebind.example.com/", async () => ["10.0.0.5"])).rejects.toThrow(
      GuardError,
    );
  });

  it("rejects when any one of several addresses is private", async () => {
    await expect(
      check("https://mixed.example.com/", async () => [PUBLIC, "192.168.0.10"]),
    ).rejects.toThrow(GuardError);
  });

  it("rejects a name that does not resolve or has no addresses", async () => {
    await expect(
      check("https://gone.example.com/", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow(GuardError);
    await expect(check("https://empty.example.com/", async () => [])).rejects.toThrow(GuardError);
  });
});

describe("guardedFetch", () => {
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

  it("never fetches a redirect hop that resolves to a private address", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string) => {
      calls.push(input);
      return redirect("https://internal.example.net/admin");
    });
    const resolve = async (host: string) =>
      host === "internal.example.net" ? ["10.0.0.9"] : [PUBLIC];
    await expect(guardedFetch(fetchImpl, resolve)("https://news.example.com/")).rejects.toThrow(
      GuardError,
    );
    expect(calls).toEqual(["https://news.example.com/"]);
  });

  it("rejects a redirect to plain http or to a metadata address", async () => {
    const toHttp = vi.fn(async () => redirect("http://news.example.com/"));
    await expect(guardedFetch(toHttp, resolvePublic)("https://news.example.com/")).rejects.toThrow(
      GuardError,
    );
    const toMeta = vi.fn(async () => redirect("https://169.254.169.254/latest"));
    await expect(guardedFetch(toMeta, resolvePublic)("https://news.example.com/")).rejects.toThrow(
      GuardError,
    );
  });

  it("follows a redirect to another public host and reports the final address", async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input === "https://news.example.com/"
        ? redirect("https://www.example.org/home")
        : new Response("ok", { status: 200 }),
    );
    const response = await guardedFetch(fetchImpl, resolvePublic)("https://news.example.com/");
    expect(await response.text()).toBe("ok");
    expect(response.url).toBe("https://www.example.org/home");
  });

  it("stops redirect loops", async () => {
    const loop = vi.fn(async () => redirect("https://news.example.com/again"));
    await expect(guardedFetch(loop, resolvePublic)("https://news.example.com/")).rejects.toThrow(
      "Too many redirects",
    );
  });
});

describe("handleSourcePreview", () => {
  const base = { clientKey: "1.2.3.4" };
  const fetchNever = vi.fn(async () => new Response("", { status: 500 }));
  const deps = (preview = vi.fn(async () => PREVIEW)) => ({
    fetch: fetchNever,
    resolve: resolvePublic,
    now: () => 1_000_000,
    preview,
  });

  it("answers 200 with the preview and a private cache header", async () => {
    const result = await handleSourcePreview(
      { ...base, rawUrl: "https://news.example.com/" },
      deps(),
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual(PREVIEW);
    expect(result.headers?.["Cache-Control"]).toBe("private, max-age=600");
  });

  it("answers 400 for a missing, malformed, non-https or credentialed address", async () => {
    for (const rawUrl of [
      null,
      "nope",
      "http://news.example.com/",
      "https://u:p@news.example.com/",
    ]) {
      const result = await handleSourcePreview({ ...base, rawUrl }, deps());
      expect(result.status, String(rawUrl)).toBe(400);
      expect(result.body).toMatchObject({ error: "invalid" });
    }
  });

  it("answers 400 for a private host without calling the preview", async () => {
    const preview = vi.fn(async () => PREVIEW);
    const result = await handleSourcePreview(
      { ...base, rawUrl: "https://169.254.169.254/latest/meta-data" },
      deps(preview),
    );
    expect(result.status).toBe(400);
    expect(preview).not.toHaveBeenCalled();
    const local = await handleSourcePreview(
      { ...base, rawUrl: "https://intranet.example.com/" },
      { ...deps(preview), resolve: async () => ["10.0.0.4"] },
    );
    expect(local.status).toBe(400);
    expect(preview).not.toHaveBeenCalled();
  });

  it("answers 422 when the address is unreachable and 504 on a timeout", async () => {
    const unreachable = await handleSourcePreview(
      { ...base, rawUrl: "https://news.example.com/" },
      deps(
        vi.fn(async () => {
          throw new PreviewError("unreachable", "The address could not be read.");
        }),
      ),
    );
    expect(unreachable.status).toBe(422);
    const slow = await handleSourcePreview(
      { ...base, rawUrl: "https://slow.example.com/" },
      deps(
        vi.fn(async () => {
          throw new PreviewError("timeout", "slow");
        }),
      ),
    );
    expect(slow.status).toBe(504);
    expect(slow.body).toMatchObject({ error: "timeout" });
  });

  it("caches an answer for ten minutes", async () => {
    const preview = vi.fn(async () => PREVIEW);
    let now = 1_000_000;
    const d = { ...deps(preview), now: () => now };
    const input = { ...base, rawUrl: "https://news.example.com/" };
    await handleSourcePreview(input, d);
    await handleSourcePreview(input, d);
    expect(preview).toHaveBeenCalledTimes(1);
    now += CACHE_TTL_MS + 1;
    await handleSourcePreview(input, d);
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure", async () => {
    const preview = vi
      .fn()
      .mockRejectedValueOnce(new PreviewError("unreachable", "no"))
      .mockResolvedValueOnce(PREVIEW);
    const input = { ...base, rawUrl: "https://news.example.com/" };
    expect((await handleSourcePreview(input, deps(preview))).status).toBe(422);
    expect((await handleSourcePreview(input, deps(preview))).status).toBe(200);
  });

  it("limits each client to a number of previews a minute", async () => {
    const d = deps();
    for (let i = 0; i < RATE_LIMIT; i++) {
      const result = await handleSourcePreview(
        { ...base, rawUrl: `https://n${i}.example.com/` },
        d,
      );
      expect(result.status).toBe(200);
    }
    const blocked = await handleSourcePreview({ ...base, rawUrl: "https://more.example.com/" }, d);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers?.["Retry-After"])).toBeGreaterThan(0);
    const other = await handleSourcePreview(
      { clientKey: "9.9.9.9", rawUrl: "https://more.example.com/" },
      d,
    );
    expect(other.status).toBe(200);
  });
});
