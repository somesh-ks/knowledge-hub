import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToast, showToast, TOAST_MS } from "./toastStore";

afterEach(() => {
  dismissToast();
  vi.useRealTimers();
});

describe("toast store", () => {
  it("shows one toast at a time; a new one replaces the old", () => {
    showToast({ message: "One", actionLabel: "Open" });
    showToast({ message: "Two", actionLabel: "Open" });
    expect(getToast()?.message).toBe("Two");
  });

  it("lets a message with no action go by itself", () => {
    vi.useFakeTimers();
    showToast({ message: "Nothing cleared the bar." });
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(getToast()).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(getToast()).toBeNull();
  });

  it("keeps a message with an action until it is used or dismissed", () => {
    vi.useFakeTimers();
    showToast({ message: "Briefing ready", actionLabel: "Open", kind: "success" });
    vi.advanceTimersByTime(TOAST_MS * 10);
    expect(getToast()?.kind).toBe("success");
    dismissToast();
    expect(getToast()).toBeNull();
  });

  it("does not let an old timer close a newer toast", () => {
    vi.useFakeTimers();
    showToast({ message: "First" });
    vi.advanceTimersByTime(TOAST_MS - 100);
    showToast({ message: "Second", actionLabel: "Open" });
    vi.advanceTimersByTime(1000);
    expect(getToast()?.message).toBe("Second");
  });
});
