import { describe, expect, it } from "vitest";
import { type Capabilities, notificationState } from "./pushClient";

const ready: Capabilities = {
  supported: true,
  apple: false,
  standalone: false,
  permission: "granted",
  chosen: true,
};

describe("the Notifications row's state (D284)", () => {
  // The bug it prevents: a row that says On while the browser blocks or cannot deliver, or an iPhone
  // person in Safari tapping On for a switch that can never work (iOS delivers only to the Home Screen app).
  it("reads the browser and the person's switch together", () => {
    expect(notificationState(ready)).toBe("on");
    expect(notificationState({ ...ready, chosen: false })).toBe("off");
    expect(notificationState({ ...ready, permission: "default" })).toBe("off");
    expect(notificationState({ ...ready, permission: "denied" })).toBe("blocked");
    expect(notificationState({ ...ready, supported: false, apple: true })).toBe("needs_install");
    expect(notificationState({ ...ready, supported: false, apple: true, standalone: true })).toBe(
      "unsupported",
    );
  });
});
