import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTapRecovery } from "./tapRecovery";

describe("a tap whose click never came", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Bug it prevents (owner, 2026-11-03, Android Chrome): after a flick up to the open player the next
  // tap, on Play or anything, showed its press and did nothing. Chrome sends the pointer's down and up
  // for such a tap but no click, and every control in the player waits for the click.
  it("is clicked once, at the control it landed on; a click that comes is left alone, and a drag or a hold clicks nothing", () => {
    let under: unknown = null;
    const page = Object.assign(new EventTarget(), { elementFromPoint: () => under });
    vi.stubGlobal("document", page);
    vi.stubGlobal(
      "MouseEvent",
      class extends Event {
        detail: number;
        constructor(type: string, init: { detail?: number } & EventInit) {
          super(type, init);
          this.detail = init.detail ?? 0;
        }
      },
    );
    installTapRecovery();
    const clicks: Event[] = [];
    const control = Object.assign(new EventTarget(), {
      isConnected: true,
      closest: (selector: string) => (selector.includes("button") ? control : null),
    });
    control.addEventListener("click", (event) => clicks.push(event));
    under = control;
    const fire = (type: string, extra: object = {}, at = 0): Event => {
      const event = Object.assign(new Event(type, { cancelable: true }), {
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        detail: 1,
        clientX: 10,
        clientY: 10,
        ...extra,
      });
      Object.defineProperty(event, "target", { value: control });
      Object.defineProperty(event, "timeStamp", { value: at });
      page.dispatchEvent(event);
      return event;
    };
    const tap = (extra: object = {}, held = 60): void => {
      fire("pointerdown", extra, 0);
      fire("pointerup", extra, held);
    };

    // No click comes: one is made after the wait, not before.
    tap();
    expect(clicks).toHaveLength(0);
    vi.advanceTimersByTime(60);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ detail: 1 });
    // The browser's own click, late, is the same tap: it is stopped.
    const late = fire("click");
    expect(late.defaultPrevented).toBe(true);

    // The click comes with the tap: nothing is made.
    tap();
    fire("click");
    vi.advanceTimersByTime(100);
    expect(clicks).toHaveLength(1);

    // A drag off the control, a drift, a cancelled pointer, a hold and a mouse press click nothing.
    fire("pointerdown");
    under = null;
    fire("pointerup", {}, 60);
    under = control;
    fire("pointerdown");
    fire("pointermove", { clientY: 60 });
    fire("pointerup", {}, 60);
    fire("pointerdown");
    fire("pointercancel");
    fire("pointerup", {}, 60);
    tap({}, 600);
    tap({ pointerType: "mouse" });
    vi.advanceTimersByTime(100);
    expect(clicks).toHaveLength(1);
  });
});
