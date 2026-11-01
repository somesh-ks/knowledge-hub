import { describe, expect, it } from "vitest";
import { type Capabilities, globalState, notificationState } from "./pushClient";

const ready: Capabilities = {
  supported: true,
  apple: false,
  standalone: false,
  permission: "granted",
  chosen: { daily: true, weekly: false, ready: false },
};

describe("the Notifications row's state (D284)", () => {
  // The bug it prevents: a row that says On while the browser blocks or cannot deliver, or an iPhone
  // person in Safari tapping On for a switch that can never work (iOS delivers only to the Home Screen app).
  it("reads the browser and the person's switch together", () => {
    expect(notificationState(ready)).toBe("on");
    expect(
      notificationState({ ...ready, chosen: { daily: false, weekly: false, ready: false } }),
    ).toBe("off");
    expect(notificationState({ ...ready, permission: "default" })).toBe("off");
    expect(notificationState({ ...ready, permission: "denied" })).toBe("blocked");
    expect(notificationState({ ...ready, supported: false, apple: true })).toBe("needs_install");
    expect(notificationState({ ...ready, supported: false, apple: true, standalone: true })).toBe(
      "unsupported",
    );
  });

  // The bug it prevents: the global switch saying On or Off while only some kinds are on.
  it("puts the global switch in the mixed state while only some kinds are on", () => {
    expect(globalState({ daily: false, weekly: false, ready: false })).toBe("off");
    expect(globalState({ daily: true, weekly: false, ready: true })).toBe("mixed");
    expect(globalState({ daily: true, weekly: true, ready: true })).toBe("on");
  });
});
