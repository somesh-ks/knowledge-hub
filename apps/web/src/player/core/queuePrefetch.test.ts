import { describe, expect, it } from "vitest";
import { mayPrefetch } from "./queuePrefetch";

// A metered link is paid for by the listener; fetching ahead there is a cost they did not choose.
describe("fetching queued audio ahead", () => {
  it("waits for an unmetered, fast, online link", () => {
    expect(mayPrefetch(undefined, true)).toBe(true);
    expect(mayPrefetch({ effectiveType: "4g" }, true)).toBe(true);
    expect(mayPrefetch({ effectiveType: "4g" }, false)).toBe(false);
    expect(mayPrefetch({ effectiveType: "4g", saveData: true }, true)).toBe(false);
    expect(mayPrefetch({ effectiveType: "4g", type: "cellular" }, true)).toBe(false);
    expect(mayPrefetch({ effectiveType: "3g" }, true)).toBe(false);
  });
});
