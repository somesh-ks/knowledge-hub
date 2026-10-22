import { describe, expect, it, vi } from "vitest";
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
      "/api/config": new Response('{"error":"synthesis_failed"}', {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
      // No header: Vercel's own error page, which prints the code on a line of its own.
      "/api/stream": new Response(
        "An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT\n\niad1::abcde-123\n",
        { status: 504, headers: { "content-type": "text/plain; charset=utf-8" } },
      ),
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
    const page = await target.fetch("/api/stream");
    // The caller's body is untouched by the copy read off its path.
    expect(await page.text()).toContain("An error occurred");
    await vi.waitFor(() => expect(reported).toHaveLength(2));
    expect(reported).toEqual([
      { kind: "platform", route: "/api/narrate", message: "FUNCTION_INVOCATION_TIMEOUT" },
      { kind: "platform", route: "/api/stream", message: "FUNCTION_INVOCATION_TIMEOUT" },
    ]);
  });
});
