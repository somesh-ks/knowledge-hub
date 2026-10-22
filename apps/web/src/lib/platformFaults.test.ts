import { describe, expect, it } from "vitest";
import { type PlatformFault, watchPlatformFaults } from "./platformFaults";

const ORIGIN = "https://news.test";

describe("watchPlatformFaults", () => {
  // A function Vercel killed (a timeout, a crash) never reached the server's own fault recording,
  // and Hobby keeps its log an hour (D158): only the page saw Vercel's answer, and said nothing.
  it("reports a platform 5xx on an API route once a page load, and nothing else", async () => {
    const answers: Record<string, Response> = {
      "/api/narrate": new Response("", {
        status: 504,
        headers: { "x-vercel-error": "FUNCTION_INVOCATION_TIMEOUT" },
      }),
      "/api/costs": new Response("{}", { status: 200 }),
      "/api/config": new Response("{}", { status: 500 }),
    };
    const target = {
      fetch: (async (input: RequestInfo | URL) => {
        const path = new URL(String(input), ORIGIN).pathname;
        return answers[path]?.clone() ?? new Response("", { status: 404 });
      }) as typeof fetch,
    };
    const reported: PlatformFault[] = [];
    watchPlatformFaults(target, ORIGIN, (fault) => reported.push(fault));

    const timedOut = await target.fetch("/api/narrate?digest=2026-10-22");
    expect(timedOut.status).toBe(504);
    await target.fetch("/api/narrate");
    await target.fetch("/api/costs");
    await target.fetch("/api/config");
    expect(reported).toEqual([
      { kind: "platform", route: "/api/narrate", message: "FUNCTION_INVOCATION_TIMEOUT" },
    ]);
  });
});
