import { describe, expect, it } from "vitest";
import { claimPrewarm, prewarmAllowed } from "./prewarmPage";

function memory(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("claimPrewarm", () => {
  it("lets a page through once per session", () => {
    const storage = memory();
    expect(claimPrewarm(storage, "2026-10-07")).toBe(true);
    expect(claimPrewarm(storage, "2026-10-07")).toBe(false);
    expect(claimPrewarm(storage, "ep-1")).toBe(true);
  });

  it("says no when storage is missing or throws", () => {
    expect(claimPrewarm(null, "x")).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };
    expect(claimPrewarm(broken, "x")).toBe(false);
  });
});

describe("prewarmAllowed", () => {
  it("holds back for a hidden tab, saved data and no connection", () => {
    expect(prewarmAllowed({ hidden: false, saveData: false, online: true })).toBe(true);
    expect(prewarmAllowed({ hidden: true, saveData: false, online: true })).toBe(false);
    expect(prewarmAllowed({ hidden: false, saveData: true, online: true })).toBe(false);
    expect(prewarmAllowed({ hidden: false, saveData: false, online: false })).toBe(false);
  });
});
