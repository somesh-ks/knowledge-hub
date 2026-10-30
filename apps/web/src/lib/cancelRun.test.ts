import { describe, expect, it } from "vitest";
import { cancelRun } from "./cancelRun";

const answering = (status: number) => async () => new Response("{}", { status });

describe("stopping a generation", () => {
  it("sends the run id to /api/cancel and reads the answer", async () => {
    let sent: { url: string; init?: RequestInit } | null = null;
    const result = await cancelRun(
      4242,
      async (url, init) => {
        sent = { url: String(url), init };
        return new Response("{}", { status: 202 });
      },
      "tok",
    );
    expect(result).toBe("cancelled");
    expect(sent).toMatchObject({ url: "/api/cancel", init: { method: "POST" } });
    expect(JSON.parse(String((sent as unknown as { init: RequestInit }).init.body))).toEqual({
      run_id: 4242,
      cancel_token: "tok",
    });
    expect(await cancelRun(1, answering(409), "tok")).toBe("finished");
  });

  // The list shows Cancel again after a failure, so a refusal, a fault and a lost connection all say
  // "failed" and never throw into a click handler.
  it("calls a refusal, a fault and a lost connection failed, never throwing", async () => {
    for (const status of [400, 403, 404, 429, 503])
      expect(await cancelRun(1, answering(status), "tok")).toBe("failed");
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await cancelRun(1, offline, "tok")).toBe("failed");
  });

  // A run another device or the schedule started has no token here (D242): it is not asked for.
  it("sends nothing for a run this browser holds no token for", async () => {
    let sent = 0;
    const counting = async () => {
      sent += 1;
      return new Response("{}", { status: 202 });
    };
    expect(await cancelRun(7, counting, null)).toBe("failed");
    expect(sent).toBe(0);
  });
});
