import { describe, expect, it } from "vitest";
import { cancelRun } from "./cancelRun";

const answering = (status: number) => async () => new Response("{}", { status });

describe("stopping a generation", () => {
  it("sends the run id to /api/cancel and reads the answer", async () => {
    let sent: { url: string; init?: RequestInit } | null = null;
    const result = await cancelRun(4242, async (url, init) => {
      sent = { url: String(url), init };
      return new Response("{}", { status: 202 });
    });
    expect(result).toBe("cancelled");
    expect(sent).toMatchObject({ url: "/api/cancel", init: { method: "POST" } });
    expect(JSON.parse(String((sent as unknown as { init: RequestInit }).init.body))).toEqual({
      run_id: 4242,
    });
    expect(await cancelRun(1, answering(409))).toBe("finished");
  });

  // The list shows Cancel again after a failure, so a refusal, a fault and a lost connection all say
  // "failed" and never throw into a click handler.
  it("calls a refusal, a fault and a lost connection failed, never throwing", async () => {
    for (const status of [400, 404, 429, 503])
      expect(await cancelRun(1, answering(status))).toBe("failed");
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await cancelRun(1, offline)).toBe("failed");
  });
});
