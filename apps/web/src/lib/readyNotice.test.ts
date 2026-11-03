import { describe, expect, it } from "vitest";
import type { Capabilities } from "./pushClient";
import { readyView, setReady } from "./readyNotice";

const base: Capabilities = {
  supported: true,
  apple: false,
  standalone: false,
  permission: "default",
  chosen: { daily: false, weekly: false, ready: false },
};

describe("the ready row on a sheet", () => {
  it("is hidden where a message cannot arrive, so a sheet never offers what cannot work", () => {
    expect(readyView({ ...base, supported: false }).show).toBe(false);
    expect(readyView({ ...base, permission: "denied" }).show).toBe(false);
    expect(readyView({ ...base, supported: false, apple: true }).show).toBe(false);
  });

  it("is on only with the choice and the browser's permission together", () => {
    const chosen = { ...base.chosen, ready: true };
    expect(readyView({ ...base, chosen }).checked).toBe(false);
    expect(readyView({ ...base, chosen, permission: "granted" })).toEqual({
      show: true,
      checked: true,
    });
  });

  it("reports off when the browser refused the permission the press asked for", async () => {
    const refused = (async () => ({ daily: false, weekly: false, ready: false })) as never;
    expect(await setReady(true, refused)).toBe(false);
  });
});
