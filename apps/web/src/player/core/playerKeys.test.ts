import { describe, expect, it } from "vitest";
import { type PageSpaceEvent, SPACE_OWNERS, shouldToggleOnPageSpace } from "./playerKeys";

function press(key: string, extra: Partial<PageSpaceEvent> = {}): PageSpaceEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    ...extra,
  };
}

/** An element that matches the owner selector only when `owned` is true. */
function target(owned: boolean): Element {
  return {
    closest: (selector: string) => (owned && selector === SPACE_OWNERS ? {} : null),
  } as never;
}

const READY = { loaded: true, overlayOpen: false };

describe("Space anywhere on the page", () => {
  it("toggles from the body, from plain content and from nowhere", () => {
    expect(shouldToggleOnPageSpace(press(" "), target(false), READY)).toBe(true);
    expect(shouldToggleOnPageSpace(press("Spacebar"), target(false), READY)).toBe(true);
    expect(shouldToggleOnPageSpace(press(" "), null, READY)).toBe(true);
  });

  it("ignores every other key", () => {
    expect(shouldToggleOnPageSpace(press("k"), target(false), READY)).toBe(false);
    expect(shouldToggleOnPageSpace(press("Enter"), target(false), READY)).toBe(false);
  });

  it("does nothing until the player has something loaded", () => {
    expect(shouldToggleOnPageSpace(press(" "), target(false), { ...READY, loaded: false })).toBe(
      false,
    );
  });

  it("steps aside while a dialog or popover other than the player is open", () => {
    expect(
      shouldToggleOnPageSpace(press(" "), target(false), { ...READY, overlayOpen: true }),
    ).toBe(false);
  });

  it("steps aside for anything Space already does", () => {
    expect(shouldToggleOnPageSpace(press(" "), target(true), READY)).toBe(false);
  });

  it("steps aside for a modifier, a held key, a handled key and a composition", () => {
    for (const extra of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
      { repeat: true },
      { defaultPrevented: true },
      { isComposing: true },
    ]) {
      expect(shouldToggleOnPageSpace(press(" ", extra), target(false), READY)).toBe(false);
    }
  });

  it("names every element and role that owns Space", () => {
    const parts = SPACE_OWNERS.split(", ");
    for (const tag of ["input", "textarea", "select", "button", "a", "summary"]) {
      expect(parts).toContain(tag);
    }
    for (const role of [
      "button",
      "checkbox",
      "radio",
      "switch",
      "slider",
      "tab",
      "menuitem",
      "option",
      "link",
    ]) {
      expect(parts).toContain(`[role='${role}']`);
    }
    expect(parts).toContain("[contenteditable]:not([contenteditable='false'])");
  });
});
