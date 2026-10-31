import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { handleExperiments } from "../../admin/src/lib/experimentsApi";
import { configHash } from "../src/lib/configHash";
import { handleConfigRead } from "../src/server/configStore";
import { BUILT_FILES } from "./configServer";
import { expect, test } from "./fixtures";
import { startServer } from "./staticServer.mjs";

/**
 * A settings page against a store that takes its time to write (a cold function, Neon waking).
 * The server here is a real one, not Playwright routes: a route fails a request still on its way
 * when the page reloads, which hides what a browser does with one that is really out (Chromium
 * rejects the page's promise at once and lets the request go on). The write waits on a gate the
 * test opens, so nothing here sleeps.
 */

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const ADMIN = fileURLToPath(new URL("../../admin/dist", import.meta.url));
const SOURCES = "config/sources.user.json";

interface SlowStore {
  baseURL: string;
  /** Requests to /api/config that reached the server, by method. */
  reached: { POST: number; GET: number };
  /** Reads answered. */
  answered: () => number;
  /** The switches the Experiments page's store holds. */
  switches: Map<string, boolean>;
  /** Lets the writes that wait land. */
  land: () => void;
  close: () => void;
}

async function slowStore(): Promise<SlowStore> {
  const user = JSON.parse(BUILT_FILES[SOURCES] as string);
  let stored: Record<string, string> = {};
  let answered = 0;
  const reached = { POST: 0, GET: 0 };
  const switches = new Map<string, boolean>();
  let land: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    land = resolve;
  });
  const write = async (request: IncomingMessage, response: ServerResponse) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    reached.POST += 1;
    await gate;
    const { op } = JSON.parse(text) as { op: { id: string; enabled: boolean } };
    user.overrides[op.id] = { ...user.overrides[op.id], enabled: op.enabled };
    stored = { [SOURCES]: JSON.stringify(user) };
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: 202, run_id: 1, written_at: Date.now() }));
  };
  const read = async (response: ServerResponse) => {
    reached.GET += 1;
    const result = await handleConfigRead({
      env: {},
      storeUrl: "postgres://e2e.invalid/store",
      builtFiles: BUILT_FILES,
      connectConfigStore: async () => ({
        query: async () =>
          Object.entries(stored).map(([path, content]) => ({ path, content, version: 1 })),
      }),
    });
    response.writeHead(result.status, { ...result.headers, "Content-Type": "application/json" });
    response.end(JSON.stringify(result.body));
    answered += 1;
  };
  // The Experiments page's function (apps/admin), over a store whose writes wait on the same gate.
  const experiments = async (request: IncomingMessage, response: ServerResponse) => {
    let bodyText = "";
    for await (const chunk of request) bodyText += chunk;
    if (request.method === "POST") reached.POST += 1;
    const answer = await handleExperiments(
      {
        method: request.method ?? "GET",
        contentType: request.headers["content-type"] ?? null,
        bodyText,
      },
      {
        read: async () =>
          [...switches].map(([id, enabled]) => ({ id, enabled, promoted_at: null })),
        hits: async () => ({}),
        setEnabled: async (id, enabled) => {
          await gate;
          switches.set(id, enabled);
          return true;
        },
        setPromoted: async () => {},
      },
    );
    response.writeHead(answer.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(answer.body));
  };
  const server = startServer({
    root: DIST,
    port: 0,
    mounts: { "/admin": ADMIN },
    api(request, response, pathname) {
      if (pathname === "/admin/api/experiments") {
        void experiments(request, response);
        return true;
      }
      if (pathname !== "/api/config") return false;
      void (request.method === "POST" ? write(request, response) : read(response));
      return true;
    },
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}`,
    reached,
    switches,
    answered: () => answered,
    land,
    close: () => server.close(),
  };
}

const ready = (page: Page) => page.locator("[data-topics]").and(page.locator("[data-ready]"));
const studioNotes = (page: Page) =>
  page
    .locator("li.source-row:not(.is-suggested)", { hasText: "Studio Notes" })
    .getByRole("checkbox", { name: "Read Studio Notes" });
const offered = (page: Page) =>
  page.locator(".toast:popover-open", { hasText: "changed on another device" });

// 2026-10-30: a switch pressed and the page reloaded while the store was still taking the write
// showed the old state; the next reload showed the old state too, under a toast that called the
// owner's own edit another device's (D259).
test("a source switched off while the store is slow stays off through two reloads, with no toast about another device", async ({
  browser,
}) => {
  const store = await slowStore();
  const context = await browser.newContext({
    baseURL: store.baseURL,
    viewport: { width: 390, height: 844 },
    timezoneId: "Europe/Stockholm",
  });
  try {
    await context.addCookies([
      { name: "test-config-store", value: configHash(BUILT_FILES), url: `${store.baseURL}/` },
    ]);
    const page = await context.newPage();
    await page.route("**/api/site-icon**", (route) => route.fulfill({ status: 404 }));
    await page.goto("/settings/categories/design");
    await expect(ready(page)).toBeVisible();
    await expect(studioNotes(page)).toBeChecked();

    // The request is out and the store has not taken it: reload.
    await studioNotes(page).uncheck();
    await expect.poll(() => store.reached.POST).toBe(1);
    await page.reload();
    await expect(ready(page)).toBeVisible();
    await expect(studioNotes(page)).not.toBeChecked();

    // The store takes the write, though the page that sent it is gone: reload once it has.
    store.land();
    const asked = store.answered();
    await page.reload();
    await expect(ready(page)).toBeVisible();
    await expect(studioNotes(page)).not.toBeChecked();
    await expect.poll(() => store.answered()).toBeGreaterThan(asked);
    // The store's answer is read and acted on within a couple of frames.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await expect(studioNotes(page)).not.toBeChecked();
    await expect(offered(page)).toHaveCount(0);
  } finally {
    await context.close();
    store.close();
  }
});

// The same cut on the admin Experiments page, which keeps its change in the tab (D259).
test("an experiment switched on while the store is slow stays on through two reloads", async ({
  browser,
}) => {
  const store = await slowStore();
  const context = await browser.newContext({
    baseURL: store.baseURL,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    const trusted = page.getByRole("switch", { name: "Trusted publishers" });
    const settled = (): Promise<void> =>
      expect(page.locator("[data-experiments][data-ready]")).toBeVisible();
    await page.goto("/admin/experiments");
    await settled();
    await expect(trusted).not.toBeChecked();

    await trusted.click();
    await page.locator("[data-confirm-go]").click();
    await expect(trusted).toBeChecked();
    await expect.poll(() => store.reached.POST).toBe(1);
    await page.reload();
    await settled();
    await expect(trusted).toBeChecked();

    store.land();
    await expect.poll(() => store.switches.get("trusted-publishers")).toBe(true);
    await page.reload();
    await settled();
    await expect(trusted).toBeChecked();
  } finally {
    await context.close();
    store.close();
  }
});
