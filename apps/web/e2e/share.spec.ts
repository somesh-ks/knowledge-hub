import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { BrowserContext, Page } from "@playwright/test";
import { guardedDatabase } from "../src/server/database";
import { handleNarrationLookup } from "../src/server/narrate";
import {
  handleShare,
  handleSharePlay,
  type MakeDeps,
  openListenLink,
  shareCandidates,
} from "../src/server/share";
import type { NarrateLookupResponse } from "../src/types/contracts";
import { AUDIO_DIGEST, expect, hydrated, test } from "./fixtures";

/**
 * The share journey (D153) on the site's own handlers: `/api/share`, `/api/share-play` and the
 * listen page's token check run as in production against an in-process Postgres; only Blob is
 * faked (every file the lookup names is stored, and each plays the fixture recording). The static
 * build has no server, so `/s/<token>` is answered with the page it drew for the link's item.
 */

const ID = AUDIO_DIGEST.split("/").pop() ?? "";
const STORE = "teststore01";
const BLOB = `https://${STORE}.public.blob.vercel-storage.com`;
const env = { BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_${STORE}_secret` };
const TOKEN_PATH = /\/s\/([A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22})\?ref=share&g=1$/;

/** The fixture digests, as the narrate function reads its bundled copies. */
const digests = {
  readDigest: async (id: string) => {
    try {
      return readFileSync(
        new URL(`../src/fixtures/digests/2026/10/${id}.md`, import.meta.url),
        "utf8",
      );
    } catch {
      return null;
    }
  },
  readTimeline: async () => null,
};

function server() {
  const db = new PGlite();
  const sql = {
    query: async (text: string, params?: unknown[]) =>
      (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
  };
  const deps: MakeDeps = {
    secret: "an-e2e-secret-of-enough-length",
    database: guardedDatabase({
      databaseUrl: "pglite",
      connect: async () => sql,
      timeoutMs: 15_000,
    }),
    burst: async () => 0,
    now: Date.now,
    candidates: async (item) =>
      shareCandidates(
        (await handleNarrationLookup({ digest: item, params: ["digest"] }, { env, digests }))
          .body as NarrateLookupResponse,
        BLOB,
      ),
    head: async (pathname) => ({
      pathname,
      url: `${BLOB}/${pathname}`,
      uploadedAt: 0,
      size: 48_000,
      version: "1",
      etag: null,
    }),
  };
  return { db, deps };
}

type Server = ReturnType<typeof server>;

async function routeShare(page: Page, { deps }: Server): Promise<void> {
  await page.route("**/api/share", async (route) => {
    const request = route.request();
    const result = await handleShare(
      {
        method: request.method() === "DELETE" ? "DELETE" : "POST",
        bodyText: request.postData() ?? "",
        origin: await request.headerValue("origin"),
        expectedOrigin: new URL(request.url()).origin,
      },
      deps,
    );
    await route.fulfill({ status: result.status, json: result.body });
  });
}

/** A stranger's browser: the listen page and its play route, and the stored files. */
async function routeListener(
  context: BrowserContext,
  { deps }: Server,
  origin: string,
): Promise<string[]> {
  const asked: string[] = [];
  context.on("request", (request) => asked.push(request.url()));
  await context.route("**/s/*", async (route) => {
    const url = new URL(route.request().url());
    const opened = await openListenLink(url.pathname.split("/")[2] ?? "", deps);
    if (opened.status !== 200) {
      await route.fulfill({
        status: opened.status,
        contentType: "text/html",
        body: "<h1>Gone</h1>",
      });
      return;
    }
    // The page the static build drew for this link's item, under the token's own address.
    const page = await route.fetch({ url: `${url.origin}/s/${opened.link.item_id}` });
    await route.fulfill({ response: page });
  });
  await context.route("**/api/share-play", async (route) => {
    const request = route.request();
    const result = await handleSharePlay(
      {
        bodyText: request.postData() ?? "",
        origin: await request.headerValue("origin"),
        expectedOrigin: new URL(request.url()).origin,
      },
      deps,
    );
    await route.fulfill({ status: result.status, json: result.body });
  });
  await context.route(`${BLOB}/**`, async (route) => {
    const audio = await route.fetch({ url: `${origin}/fixtures/audio.wav` });
    await route.fulfill({
      response: audio,
      headers: { ...audio.headers(), "access-control-allow-origin": "*" },
    });
  });
  return asked;
}

test("a shared link plays its stored audio in a fresh browser, never narrates, and stops when revoked", async ({
  page,
  browser,
  baseURL,
}) => {
  const app = server();
  await routeShare(page, app);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    const copied: string[] = [];
    Object.assign(window, { copied });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
  });
  await page.goto(AUDIO_DIGEST);
  await hydrated(page);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { copied: string[] }).copied))
    .toEqual([expect.stringMatching(TOKEN_PATH)]);
  const link =
    (await page.evaluate(() => (window as unknown as { copied: string[] }).copied))[0] ?? "";

  // A stranger opens it: no app, no service worker, no narration.
  const fresh = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const asked = await routeListener(fresh, app, baseURL ?? "");
  const listener = await fresh.newPage();
  const opened = await listener.goto(new URL(link).pathname + new URL(link).search);
  expect(opened?.status()).toBe(200);
  expect(opened?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(listener.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
  await listener.getByRole("button", { name: "Play" }).click();
  await expect
    .poll(() =>
      listener
        .locator("[data-listen-audio]")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  expect(asked.some((url) => url.startsWith(`${BLOB}/audio/${ID}/`))).toBe(true);
  expect(asked.filter((url) => url.includes("/api/narrate"))).toEqual([]);
  expect(
    await listener.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)),
  ).toBe(0);
  expect(await listener.locator('link[rel="manifest"]').count()).toBe(0);
  for (const url of asked)
    expect(url, "nothing leaves for analytics in a test").not.toContain("simpleanalytics");

  // The owner stops sharing: the link's play route and its page answer 410.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Stop sharing" }).click();
  await expect(page.getByText("Stopped sharing")).toBeVisible();
  const token = TOKEN_PATH.exec(link)?.[1] ?? "";
  const play = await listener.evaluate(
    (body) =>
      fetch("/api/share-play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }).then((response) => response.status),
    JSON.stringify({ token }),
  );
  expect(play).toBe(410);
  expect((await listener.reload())?.status()).toBe(410);
  await fresh.close();
  await app.db.close();
});
