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

  it("answers with the row as it stands once the browser has refused the press", async () => {
    const refused = (async () => ({ daily: false, weekly: false, ready: false })) as never;
    // A refusal for good turns the browser's permission to denied, which takes the row away.
    const denied = () => readyView({ ...base, permission: "denied" });
    expect(await setReady(true, refused, denied)).toEqual({ show: false, checked: false });
  });
});
