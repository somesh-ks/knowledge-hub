import { BlobError, BlobNotFoundError } from "@vercel/blob";
import { describe, expect, it, vi } from "vitest";
import {
  type BlobFetch,
  type BlobSdk,
  createVercelBlobStore,
  MAX_TEXT_BYTES,
  readFresh,
  versionedUrl,
} from "./blobStore";
import { BLOB_CALL_TIMEOUT_MS } from "./functionLimits.mjs";

/**
 * The adapter is the only code between the handler and `@vercel/blob`, and the handler's tests never
 * reach it. These run it against fake SDK functions and a fake fetch, so nothing here touches the
 * network either.
 */

const TOKEN = { token: "vercel_blob_rw_example_0123456789abcdef" };
const UPLOADED = new Date("2026-10-07T12:00:00Z");
const HOST = "https://teststore.public.blob.vercel-storage.com";

const sdkBlob = (pathname: string, more: { size?: number; etag?: string } = {}) => ({
  url: `${HOST}/${pathname}`,
  pathname,
  uploadedAt: UPLOADED,
  ...more,
});

/** Every function answers plainly. A test replaces the one it is about by spreading over this. */
function fakeSdk() {
  return {
    head: vi.fn<BlobSdk["head"]>(async (pathname) =>
      sdkBlob(pathname, { size: 10, etag: '"abc"' }),
    ),
    list: vi.fn<BlobSdk["list"]>(async () => ({ blobs: [], hasMore: false })),
    put: vi.fn<BlobSdk["put"]>(async (pathname) => ({ url: sdkBlob(pathname).url })),
    del: vi.fn<BlobSdk["del"]>(async () => {}),
  };
}

const neverFetched: BlobFetch = async () => {
  throw new Error("this test should not read by URL");
};

/** The options one SDK call was made with, checked for the limit every call must carry. */
function expectBounded(options: { abortSignal?: AbortSignal } | undefined) {
  expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
  expect(options?.abortSignal?.aborted).toBe(false);
}

describe("createVercelBlobStore", () => {
  it("reads metadata with the credentials it was given", async () => {
    const sdk = fakeSdk();
    const store = createVercelBlobStore(TOKEN, sdk, neverFetched);
    expect(await store.head("audio/2026-10-07.mp3")).toEqual({
      pathname: "audio/2026-10-07.mp3",
      url: `${HOST}/audio/2026-10-07.mp3`,
      uploadedAt: UPLOADED.getTime(),
      size: 10,
      version: "abc",
    });
    expect(sdk.head.mock.calls[0]?.[0]).toBe("audio/2026-10-07.mp3");
    expect(sdk.head.mock.calls[0]?.[1]).toMatchObject(TOKEN);
  });

  it("uses the upload time as the version when the store gives no ETag, and 0 for no size", async () => {
    const sdk = { ...fakeSdk(), head: vi.fn<BlobSdk["head"]>(async (path) => sdkBlob(path)) };
    const entry = await createVercelBlobStore(TOKEN, sdk, neverFetched).head("x.json");
    expect(entry?.version).toBe(String(UPLOADED.getTime()));
    expect(entry?.size).toBe(0);
  });

  it("answers null for an object that does not exist, and passes other failures on", async () => {
    const missing = {
      ...fakeSdk(),
      head: vi.fn<BlobSdk["head"]>(async () => {
        throw new BlobNotFoundError();
      }),
    };
    expect(await createVercelBlobStore(TOKEN, missing, neverFetched).head("x.mp3")).toBeNull();

    const broken = {
      ...fakeSdk(),
      head: vi.fn<BlobSdk["head"]>(async () => {
        throw new Error("store is down");
      }),
    };
    await expect(createVercelBlobStore(TOKEN, broken, neverFetched).head("x.mp3")).rejects.toThrow(
      "store is down",
    );
  });

  it("gives every call to the store its own time limit", async () => {
    const sdk = fakeSdk();
    const store = createVercelBlobStore(TOKEN, sdk, neverFetched);
    await store.head("a");
    await store.list("audio/");
    await store.put("a", "{}", { contentType: "application/json", cacheSeconds: 60 });
    await store.create("b", "{}", { contentType: "application/json", cacheSeconds: 60 });
    await store.del("a");
    expectBounded(sdk.head.mock.calls[0]?.[1]);
    expectBounded(sdk.list.mock.calls[0]?.[0]);
    expectBounded(sdk.put.mock.calls[0]?.[2]);
    expectBounded(sdk.put.mock.calls[1]?.[2]);
    expectBounded(sdk.del.mock.calls[0]?.[1]);
  });

  it("stops waiting for a call that outlasts its limit, even one that ignores its signal", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const hang = <T>(signal: AbortSignal): Promise<T> => {
        signals.push(signal);
        return new Promise<T>(() => {});
      };
      const sdk = {
        ...fakeSdk(),
        del: vi.fn<BlobSdk["del"]>((_pathname, options) => hang(options.abortSignal)),
        put: vi.fn<BlobSdk["put"]>((_pathname, _body, options) => hang(options.abortSignal)),
      };
      const store = createVercelBlobStore(TOKEN, sdk, neverFetched);
      const outcome = (call: Promise<unknown>) =>
        call.then(
          () => "answered",
          (error: Error) => error.name,
        );

      // A delete has the store's own limit.
      const deleted = outcome(store.del("state/narrating-x.json"));
      await vi.advanceTimersByTimeAsync(BLOB_CALL_TIMEOUT_MS - 1);
      expect(signals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await deleted).toBe("TimeoutError");
      expect(signals[0]?.aborted).toBe(true);

      // An upload has the limit the caller gave it.
      const upload = { contentType: "audio/mpeg", cacheSeconds: 60, timeoutMs: 500 };
      const uploaded = outcome(store.put("audio/x.mp3", "x", upload));
      await vi.advanceTimersByTimeAsync(500);
      expect(await uploaded).toBe("TimeoutError");
      expect(signals[1]?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no timer running once a call has answered", async () => {
    vi.useFakeTimers();
    try {
      const store = createVercelBlobStore(TOKEN, fakeSdk(), neverFetched);
      await store.head("a");
      await store.del("a");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows a listing across pages", async () => {
    const first = { blobs: [sdkBlob("audio/a.mp3", { size: 3 })], cursor: "page-2", hasMore: true };
    const second = { blobs: [sdkBlob("audio/b.mp3")], hasMore: false };
    const sdk = {
      ...fakeSdk(),
      list: vi.fn<BlobSdk["list"]>(async (options) => (options.cursor ? second : first)),
    };
    const entries = await createVercelBlobStore(TOKEN, sdk, neverFetched).list("audio/");
    expect(entries.map((entry) => [entry.pathname, entry.size])).toEqual([
      ["audio/a.mp3", 3],
      ["audio/b.mp3", 0],
    ]);
    expect(sdk.list.mock.calls[0]?.[0]).toMatchObject({ prefix: "audio/", ...TOKEN });
    expect(sdk.list.mock.calls[1]?.[0]).toMatchObject({ prefix: "audio/", cursor: "page-2" });
  });

  it("stops a listing that never ends", async () => {
    const sdk = {
      ...fakeSdk(),
      list: vi.fn<BlobSdk["list"]>(async () => ({ blobs: [], cursor: "again", hasMore: true })),
    };
    await expect(createVercelBlobStore(TOKEN, sdk, neverFetched).list("audio/")).rejects.toThrow(
      "did not end",
    );
    expect(sdk.list).toHaveBeenCalledTimes(20);
  });

  it("writes public objects at a fixed pathname, replacing what was there", async () => {
    const oidc = { oidcToken: "oidc-token", storeId: "store_abc" };
    const sdk = fakeSdk();
    const store = createVercelBlobStore(oidc, sdk, neverFetched);
    const bytes = new Uint8Array([9, 8, 7, 6]).subarray(1, 3);

    expect(
      await store.put("audio/x.mp3", bytes, { contentType: "audio/mpeg", cacheSeconds: 3600 }),
    ).toEqual({ url: `${HOST}/audio/x.mp3` });

    const [pathname, sent, options] = sdk.put.mock.calls[0] ?? [];
    expect(pathname).toBe("audio/x.mp3");
    // Only the view's own bytes are sent, not the whole buffer behind it.
    expect([...(sent as Buffer)]).toEqual([8, 7]);
    expect(options).toMatchObject({
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "audio/mpeg",
      cacheControlMaxAge: 3600,
      ...oidc,
    });
  });

  it("creates only when nothing is there, and says which it was", async () => {
    const sdk = fakeSdk();
    const store = createVercelBlobStore(TOKEN, sdk, neverFetched);
    const options = { contentType: "application/json", cacheSeconds: 60 };
    expect(await store.create("state/narrating-x.json", "{}", options)).toBe(true);
    expect(sdk.put.mock.calls[0]?.[2]).toMatchObject({ allowOverwrite: false });

    // What the store answers when the pathname is taken: a plain error that says so.
    const taken = {
      ...fakeSdk(),
      put: vi.fn<BlobSdk["put"]>(async () => {
        throw new BlobError(
          "This blob already exists, use `allowOverwrite: true` if you want to overwrite it.",
        );
      }),
    };
    const second = createVercelBlobStore(TOKEN, taken, neverFetched);
    expect(await second.create("state/narrating-x.json", "{}", options)).toBe(false);

    // Any other failure is a failure, not "someone else has it".
    const down = {
      ...fakeSdk(),
      put: vi.fn<BlobSdk["put"]>(async () => {
        throw new BlobError("The store is suspended");
      }),
    };
    await expect(
      createVercelBlobStore(TOKEN, down, neverFetched).create("x.json", "{}", options),
    ).rejects.toThrow("suspended");
  });

  it("deletes by pathname", async () => {
    const sdk = fakeSdk();
    await createVercelBlobStore(TOKEN, sdk, neverFetched).del("state/narrating-x.json");
    expect(sdk.del.mock.calls[0]?.[0]).toBe("state/narrating-x.json");
    expect(sdk.del.mock.calls[0]?.[1]).toMatchObject(TOKEN);
  });
});

describe("reading a blob by URL", () => {
  const read = (doFetch: BlobFetch) => createVercelBlobStore(TOKEN, fakeSdk(), doFetch);

  it("returns the text, null for a 404, and an error that names only the status otherwise", async () => {
    const urls: string[] = [];
    const doFetch: BlobFetch = async (url, init) => {
      urls.push(url);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      if (url.includes("missing")) return new Response("not here", { status: 404 });
      if (url.includes("broken")) return new Response("secret upstream detail", { status: 500 });
      return new Response('{"a":1}');
    };
    const store = read(doFetch);
    expect(await store.fetchText(`${HOST}/state/usage.json?v=abc`)).toBe('{"a":1}');
    expect(await store.fetchText(`${HOST}/missing.json`)).toBeNull();
    const failure = await store.fetchText(`${HOST}/broken.json`).catch((error: Error) => error);
    expect((failure as Error).message).toBe("the store answered 500 to a read");
    expect(urls[0]).toBe(`${HOST}/state/usage.json?v=abc`);
  });

  it("refuses a URL that is not https, without fetching it", async () => {
    await expect(read(neverFetched).fetchText("http://insecure.example/x.json")).rejects.toThrow(
      "not https",
    );
  });

  it("stops at the size limit by counting what arrives, whatever size was reported", async () => {
    // The store reported no size at all for this one; the body is still far too large.
    const huge = new Uint8Array(MAX_TEXT_BYTES + 1);
    const store = read(async () => new Response(huge));
    await expect(store.fetchText(`${HOST}/audio/x.mp3`)).rejects.toThrow("too large");
    const exact = read(async () => new Response(new Uint8Array(MAX_TEXT_BYTES)));
    expect((await exact.fetchText(`${HOST}/big.json`))?.length).toBe(MAX_TEXT_BYTES);
  });
});

describe("readFresh", () => {
  it("asks the store for the version, then reads the URL that names it", async () => {
    const urls: string[] = [];
    const sdk = {
      ...fakeSdk(),
      head: vi.fn<BlobSdk["head"]>(async (path) => sdkBlob(path, { size: 7, etag: '"e-42"' })),
    };
    const store = createVercelBlobStore(TOKEN, sdk, async (url) => {
      urls.push(url);
      return new Response('{"n":1}');
    });
    const fresh = await readFresh(store, "state/usage-2026-10.json");
    if (!fresh) throw new Error("expected the document");
    expect(fresh.text).toBe('{"n":1}');
    expect(urls).toEqual([`${HOST}/state/usage-2026-10.json?v=e42`]);
    // A new ETag is a URL the CDN has not seen, so it cannot answer with the old copy.
    expect(versionedUrl({ ...fresh.entry, version: "e43" })).toBe(
      `${HOST}/state/usage-2026-10.json?v=e43`,
    );
  });

  it("is null when there is no such object, and does not read by URL to find that out", async () => {
    const sdk = {
      ...fakeSdk(),
      head: vi.fn<BlobSdk["head"]>(async () => {
        throw new BlobNotFoundError();
      }),
    };
    const store = createVercelBlobStore(TOKEN, sdk, neverFetched);
    expect(await readFresh(store, "state/usage-2026-10.json")).toBeNull();
  });

  it("is null when the object disappears between the two calls", async () => {
    const store = createVercelBlobStore(
      TOKEN,
      fakeSdk(),
      async () => new Response("", { status: 404 }),
    );
    expect(await readFresh(store, "state/narrating-x.json")).toBeNull();
  });
});
