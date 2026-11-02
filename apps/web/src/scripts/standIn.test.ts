import { describe, expect, it } from "vitest";
import { destinationOf, targetOf } from "./standIn";

describe("the stand-in page", () => {
  // Bug (owner, 2026-11-02): Try again after a reload landed on Latest, whatever page was asked for.
  it("brings in the page that was asked for, query and anchor included, and never Latest by default", () => {
    expect(targetOf({ pathname: "/settings/saved", search: "", hash: "" })).toBe("/settings/saved");
    expect(targetOf({ pathname: "/d/2026-10-04-weekly", search: "?t=1", hash: "#stories" })).toBe(
      "/d/2026-10-04-weekly?t=1#stories",
    );
  });

  it("marks the tab the page belongs to", () => {
    expect(destinationOf("/")).toBe("today");
    expect(destinationOf("/settings/saved")).toBe("settings");
    expect(destinationOf("/d/2026-10-04-weekly")).toBe("library");
  });
});
