import { describe, expect, it } from "vitest";
import { toResponse } from "./http";

describe("toResponse", () => {
  it("writes a JSON body with the status", async () => {
    const response = toResponse({ status: 202, body: { run_id: 1 } });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ run_id: 1 });
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("is uncacheable and unsniffable by default", () => {
    const response = toResponse({ status: 200, body: {} });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("lets a handler set its own cache window and other headers", () => {
    const response = toResponse({
      status: 429,
      body: {},
      headers: { "Cache-Control": "private, max-age=3", "Retry-After": "60" },
    });
    expect(response.headers.get("cache-control")).toBe("private, max-age=3");
    expect(response.headers.get("retry-after")).toBe("60");
  });
});
