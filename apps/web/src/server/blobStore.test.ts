import { BlobNotFoundError } from "@vercel/blob";
import { describe, expect, it, vi } from "vitest";
import { type BlobSdk, createVercelBlobStore } from "./blobStore";

/**
 * The adapter is the only code between the handler and `@vercel/blob`, and the handler's tests never
 * reach it. These run it against fake SDK functions, so nothing here touches the network either.
 */

const TOKEN = { token: "vercel_blob_rw_example_0123456789abcdef" };
const UPLOADED = new Date("2026-10-07T12:00:00Z");

const sdkBlob = (pathname: string) => ({
  url: `https://teststore.public.blob.vercel-storage.com/${pathname}`,
  pathname,
  uploadedAt: UPLOADED,
});

const found = (text: string, size = text.length) => ({
  stream: new Response(text).body,
  blob: { size },
});

/** Every function answers plainly. A test replaces the one it is about by spreading over this. */
function fakeSdk() {
  return {
    head: vi.fn<BlobSdk["head"]>(async (pathname) => sdkBlob(pathname)),
    get: vi.fn<BlobSdk["get"]>(async () => null),
    list: vi.fn<BlobSdk["list"]>(async () => ({ blobs: [], hasMore: false })),
    put: vi.fn<BlobSdk["put"]>(async (pathname) => ({ url: sdkBlob(pathname).url })),
    del: vi.fn<BlobSdk["del"]>(async () => {}),
  };
}

describe("createVercelBlobStore", () => {
  it("reads metadata with the credentials it was given", async () => {
    const sdk = fakeSdk();
    const entry = await createVercelBlobStore(TOKEN, sdk).head("audio/2026-10-07.mp3");
    expect(entry).toEqual({
      pathname: "audio/2026-10-07.mp3",
      url: "https://teststore.public.blob.vercel-storage.com/audio/2026-10-07.mp3",
      uploadedAt: UPLOADED.getTime(),
    });
    expect(sdk.head).toHaveBeenCalledWith("audio/2026-10-07.mp3", TOKEN);
  });

  it("answers null for an object that does not exist, and passes other failures on", async () => {
    const missing = {
      ...fakeSdk(),
      head: vi.fn<BlobSdk["head"]>(async () => {
        throw new BlobNotFoundError();
      }),
      get: vi.fn<BlobSdk["get"]>(async () => {
        throw new BlobNotFoundError();
      }),
    };
    const store = createVercelBlobStore(TOKEN, missing);
    expect(await store.head("audio/none.mp3")).toBeNull();
    expect(await store.readText("timeline/none.json")).toBeNull();

    const broken = {
      ...fakeSdk(),
      head: vi.fn<BlobSdk["head"]>(async () => {
        throw new Error("store is down");
      }),
    };
    await expect(createVercelBlobStore(TOKEN, broken).head("audio/x.mp3")).rejects.toThrow(
      "store is down",
    );
  });

  it("reads text past the CDN cache", async () => {
    const sdk = { ...fakeSdk(), get: vi.fn<BlobSdk["get"]>(async () => found('{"a":1}')) };
    const store = createVercelBlobStore(TOKEN, sdk);
    expect(await store.readText("state/usage-2026-10.json")).toBe('{"a":1}');
    expect(sdk.get).toHaveBeenCalledWith("state/usage-2026-10.json", {
      access: "public",
      useCache: false,
      ...TOKEN,
    });
  });

  it("answers null when the SDK finds nothing, and refuses a file too large to be JSON state", async () => {
    expect(await createVercelBlobStore(TOKEN, fakeSdk()).readText("timeline/x.json")).toBeNull();
    const huge = { ...fakeSdk(), get: vi.fn<BlobSdk["get"]>(async () => found("x", 5_000_000)) };
    await expect(createVercelBlobStore(TOKEN, huge).readText("audio/x.mp3")).rejects.toThrow(
      "too large",
    );
  });

  it("follows a listing across pages", async () => {
    const first = { blobs: [sdkBlob("audio/a.mp3")], cursor: "page-2", hasMore: true };
    const second = { blobs: [sdkBlob("audio/b.mp3")], hasMore: false };
    const sdk = {
      ...fakeSdk(),
      list: vi.fn<BlobSdk["list"]>(async (options) => (options.cursor ? second : first)),
    };
    const entries = await createVercelBlobStore(TOKEN, sdk).list("audio/");
    expect(entries.map((entry) => entry.pathname)).toEqual(["audio/a.mp3", "audio/b.mp3"]);
    expect(sdk.list).toHaveBeenNthCalledWith(1, { prefix: "audio/", ...TOKEN });
    expect(sdk.list).toHaveBeenNthCalledWith(2, { prefix: "audio/", cursor: "page-2", ...TOKEN });
  });

  it("stops a listing that never ends", async () => {
    const sdk = {
      ...fakeSdk(),
      list: vi.fn<BlobSdk["list"]>(async () => ({ blobs: [], cursor: "again", hasMore: true })),
    };
    await expect(createVercelBlobStore(TOKEN, sdk).list("audio/")).rejects.toThrow("did not end");
    expect(sdk.list).toHaveBeenCalledTimes(20);
  });

  it("writes public objects at a fixed pathname, replacing what was there", async () => {
    const oidc = { oidcToken: "oidc-token", storeId: "store_abc" };
    const sdk = fakeSdk();
    const store = createVercelBlobStore(oidc, sdk);
    const bytes = new Uint8Array([9, 8, 7, 6]).subarray(1, 3);

    expect(
      await store.put("audio/2026-10-07.mp3", bytes, {
        contentType: "audio/mpeg",
        cacheSeconds: 3600,
      }),
    ).toEqual({ url: "https://teststore.public.blob.vercel-storage.com/audio/2026-10-07.mp3" });

    const [pathname, sent, options] = sdk.put.mock.calls[0] ?? [];
    expect(pathname).toBe("audio/2026-10-07.mp3");
    // Only the view's own bytes are sent, not the whole buffer behind it.
    expect([...(sent as Buffer)]).toEqual([8, 7]);
    expect(options).toEqual({
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "audio/mpeg",
      cacheControlMaxAge: 3600,
      ...oidc,
    });

    await store.put("timeline/x.json", "{}", { contentType: "application/json", cacheSeconds: 60 });
    expect(sdk.put.mock.calls[1]?.[1]).toBe("{}");
  });

  it("deletes by pathname", async () => {
    const sdk = fakeSdk();
    await createVercelBlobStore(TOKEN, sdk).del("state/narrating-2026-10-07.json");
    expect(sdk.del).toHaveBeenCalledWith("state/narrating-2026-10-07.json", TOKEN);
  });
});
