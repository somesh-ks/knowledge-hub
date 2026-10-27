import { describe, expect, it } from "vitest";
import { parseStreamDoc } from "./liveStream";

const doc = (extra: Record<string, unknown>) =>
  JSON.stringify({
    id: "ep-20261027-1200",
    title: "AI",
    status: "writing",
    turns: [{ speaker: "a", text: "Hello." }],
    format: "readout",
    ...extra,
  });

describe("the live copy of a script", () => {
  it("keeps a hex cover colour and drops anything else, since the player sets it as CSS", () => {
    expect(parseStreamDoc(doc({ cover_key: "#2a6f4e" }))?.cover_key).toBe("#2a6f4e");
    for (const hostile of ["red", "url(https://x.test/a)", "#fff;position:fixed", 7]) {
      expect(parseStreamDoc(doc({ cover_key: hostile }))?.cover_key).toBeUndefined();
    }
  });
});
