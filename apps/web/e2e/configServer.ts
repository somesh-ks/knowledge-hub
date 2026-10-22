import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { handleConfig } from "../src/server/configEdit";
import { handleConfigRead } from "../src/server/configStore";
import type { ConfigOp } from "../src/types/contracts";

/**
 * /api/config answered by the site's own handler (server/configEdit.ts), not by a stub that says 202
 * to everything. Only GitHub is faked: each dispatch is recorded as the edit the config workflow
 * would apply, and listed as a run, so the handler's ten-second gap between edits (its 429) holds as
 * it does in production. The handler's clock is the page's, so `page.clock` moves both.
 *
 * A stub that always answers 202 let "Stop hearing from" ship unable to send a second edit inside
 * the gap (docs/engineering/reliability-audit-2026-10-15.md).
 */
export interface ConfigServer {
  /** The edits that reached the workflow, in order: what the repository will hold. */
  applied: ConfigOp[];
  /** The status of every answer, in order. */
  statuses: number[];
}

export async function routeConfigServer(page: Page): Promise<ConfigServer> {
  const server: ConfigServer = { applied: [], statuses: [] };
  const runs: Array<{ id: number; created_at: string; status: string }> = [];
  let now = 0;
  const github = async (url: string, init: RequestInit = {}): Promise<Response> => {
    if (init.method === "POST" && url.endsWith("/dispatches")) {
      const { inputs } = JSON.parse(String(init.body)) as { inputs: { op: string } };
      const edit = JSON.parse(inputs.op) as ConfigOp | ConfigOp[];
      server.applied.push(...(Array.isArray(edit) ? edit : [edit]));
      const id = runs.length + 1;
      runs.unshift({ id, created_at: new Date(now).toISOString(), status: "queued" });
      return Response.json({ workflow_run_id: id });
    }
    if (url.includes("/runs?")) return Response.json({ workflow_runs: runs });
    return new Response(null, { status: 404 });
  };
  // One request at a time, so the gap is checked against the edit before it as it would be on a
  // single function instance; the order is the order the requests arrived in.
  let queue: Promise<void> = Promise.resolve();
  await page.route("**/api/config", (route) => {
    queue = queue.then(() => answer(route)).catch(() => {});
    return queue;
  });
  async function answer(route: Route): Promise<void> {
    now = await page.evaluate(() => Date.now());
    const request = route.request();
    const result = await handleConfig(
      {
        bodyText: request.postData() ?? "",
        origin: await request.headerValue("origin"),
        expectedOrigin: new URL(request.url()).origin,
      },
      {
        env: {
          GITHUB_DISPATCH_TOKEN: "t",
          GITHUB_REPOSITORY: "o/r",
          GENERATE_PASSPHRASE_HASH: "h",
        },
        fetch: github,
        now: () => now,
        delay: async () => {},
        verifyPassphrase: async () => true,
      },
    );
    server.statuses.push(result.status);
    await route.fulfill({ status: result.status, headers: result.headers, json: result.body });
  }
  return server;
}

const fixture = (name: string): string =>
  readFileSync(new URL(`../src/fixtures/config/${name}`, import.meta.url), "utf8");

/** The fixture config the test build is made from: what the function bundles in production. */
export const BUILT_FILES: Record<string, string> = {
  "config/topics.json": fixture("topics.json"),
  "config/sources.json": fixture("sources.json"),
  "config/sources.user.json": fixture("sources.user.json"),
};

/**
 * GET /api/config with the config store on (D149), answered by the site's own read handler
 * (server/configStore.ts) over a store that holds what `holds` returns (repository path to text),
 * or that is down when it returns null. Any other method goes on to the routes set before this one.
 */
export async function routeConfigStore(
  page: Page,
  holds: () => Record<string, string> | null,
): Promise<void> {
  await page.route("**/api/config", async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const stored = holds();
    const result = await handleConfigRead({
      env: {},
      storeUrl: "postgres://e2e.invalid/store",
      builtFiles: BUILT_FILES,
      connectConfigStore: async () => ({
        query: async () => {
          if (stored === null) throw new Error("connect ECONNREFUSED");
          return Object.entries(stored).map(([path, content]) => ({ path, content, version: 1 }));
        },
      }),
    });
    await route.fulfill({ status: result.status, headers: result.headers, json: result.body });
  });
}
