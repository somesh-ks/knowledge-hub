import { describe, expect, it } from "vitest";
import {
  createModalScope,
  INERT_MARKER,
  type ScopeDocument,
  type ScopeElement,
  type ScopeKeyEvent,
} from "./modalScope";

/** A stand-in element: attributes in a map, children in a list, and the few selectors the scope asks about. */
class FakeElement implements ScopeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  focusCalls = 0;

  constructor(
    readonly tag: string,
    attributes: Record<string, string> = {},
    children: FakeElement[] = [],
  ) {
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
    this.children.push(...children);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  /** Understands a comma list of tag names and [attribute] tests, which is all the scope uses. */
  matches(selectors: string): boolean {
    return selectors.split(",").some((raw) => {
      const selector = raw.trim();
      const attribute = /^\[([a-z-]+)(?:=([a-z]+))?\]$/.exec(selector);
      if (!attribute) return selector === this.tag;
      const name = attribute[1] ?? "";
      return attribute[2] === undefined
        ? this.attributes.has(name)
        : this.attributes.get(name) === attribute[2];
    });
  }

  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  querySelector(selectors: string): FakeElement | null {
    return this.descendants().find((element) => element.matches(selectors)) ?? null;
  }

  contains(other: unknown): boolean {
    return other === this || this.descendants().includes(other as FakeElement);
  }

  focus(): void {
    this.focusCalls += 1;
    owner?.setActive(this);
  }
}

class FakeDocument implements ScopeDocument {
  readonly body: FakeElement;
  activeElement: FakeElement | null;
  readonly listeners = new Set<(event: ScopeKeyEvent) => void>();

  constructor(children: FakeElement[]) {
    this.body = new FakeElement("body", {}, children);
    this.activeElement = this.body;
  }

  setActive(element: FakeElement): void {
    this.activeElement = element;
  }

  querySelectorAll(selectors: string): FakeElement[] {
    return this.body.descendants().filter((element) => element.matches(selectors));
  }

  addEventListener(_type: "keydown", listener: (event: ScopeKeyEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "keydown", listener: (event: ScopeKeyEvent) => void): void {
    this.listeners.delete(listener);
  }

  press(key: string, defaultPrevented = false): void {
    for (const listener of [...this.listeners]) listener({ key, defaultPrevented });
  }
}

let owner: FakeDocument | null = null;

/** A body shaped like a real page: header, main, the two islands, live regions, a data script. */
function makePage() {
  const page = new FakeElement("section", { inert: "" });
  const opener = new FakeElement("button");
  const surface = new FakeElement("div", {}, [page, opener]);
  const playerIsland = new FakeElement("astro-island", {}, [surface]);
  const toast = new FakeElement("div", { popover: "manual" });
  const sheetsIsland = new FakeElement("astro-island", {}, [toast]);
  const header = new FakeElement("header");
  // The header's More menu is an auto popover inside the page behind the player.
  const moreMenu = new FakeElement("div", { popover: "" });
  const main = new FakeElement("div", {}, [new FakeElement("main", {}, [moreMenu])]);
  const announcer = new FakeElement("div", { "aria-live": "polite" });
  const routeAnnouncer = new FakeElement("div", { "aria-live": "assertive" });
  const data = new FakeElement("script");
  const template = new FakeElement("template");
  const openSheet = new FakeElement("div", { inert: "" });
  const doc = new FakeDocument([
    header,
    main,
    playerIsland,
    sheetsIsland,
    template,
    data,
    announcer,
    routeAnnouncer,
    openSheet,
  ]);
  owner = doc;
  return {
    doc,
    page,
    opener,
    surface,
    playerIsland,
    sheetsIsland,
    header,
    main,
    announcer,
    routeAnnouncer,
    data,
    template,
    openSheet,
    scope: createModalScope(() => doc),
  };
}

describe("entering the modal scope", () => {
  it("makes the rest of the body inert and marks each element it touched", () => {
    const { scope, surface, page, header, main } = makePage();
    scope.enter({ surface, page }, () => undefined);
    for (const element of [header, main]) {
      expect(element.hasAttribute("inert")).toBe(true);
      expect(element.hasAttribute(INERT_MARKER)).toBe(true);
    }
    expect(scope.isEntered()).toBe(true);
  });

  it("leaves the player's own island, live regions, popover hosts and unrendered elements alone", () => {
    const made = makePage();
    made.scope.enter({ surface: made.surface, page: made.page }, () => undefined);
    for (const element of [
      made.playerIsland,
      made.sheetsIsland,
      made.announcer,
      made.routeAnnouncer,
      made.data,
      made.template,
    ]) {
      expect(element.hasAttribute("inert")).toBe(false);
      expect(element.hasAttribute(INERT_MARKER)).toBe(false);
    }
  });

  it("does not claim an element that was already inert", () => {
    const { scope, surface, page, openSheet } = makePage();
    scope.enter({ surface, page }, () => undefined);
    expect(openSheet.hasAttribute(INERT_MARKER)).toBe(false);
    scope.leave({ page, focusTo: null });
    // Someone else's inert survives the scope.
    expect(openSheet.hasAttribute("inert")).toBe(true);
  });

  it("turns the page into a modal dialog, takes it out of inert and focuses it", () => {
    const { scope, surface, page, doc } = makePage();
    scope.enter({ surface, page }, () => undefined);
    expect(page.hasAttribute("inert")).toBe(false);
    expect(page.attributes.get("role")).toBe("dialog");
    expect(page.attributes.get("aria-modal")).toBe("true");
    expect(doc.activeElement).toBe(page);
  });

  it("never stacks marks or listeners when entered twice", () => {
    const { scope, surface, page, doc, header } = makePage();
    scope.enter({ surface, page }, () => undefined);
    scope.enter({ surface, page }, () => undefined);
    expect(doc.listeners.size).toBe(1);
    expect(doc.querySelectorAll(`[${INERT_MARKER}]`)).toHaveLength(2);
    expect(header.hasAttribute("inert")).toBe(true);
  });
});

describe("Escape", () => {
  it("is heard on the document while the scope is entered, and not after", () => {
    const { scope, surface, page, doc } = makePage();
    let escapes = 0;
    scope.enter({ surface, page }, () => {
      escapes += 1;
    });
    doc.press("Escape");
    doc.press("Enter");
    expect(escapes).toBe(1);
    scope.leave({ page, focusTo: null });
    doc.press("Escape");
    expect(escapes).toBe(1);
    expect(doc.listeners.size).toBe(0);
  });

  it("is left to whoever already handled it, and to a sheet that holds focus", () => {
    const { scope, surface, page, doc, openSheet } = makePage();
    let escapes = 0;
    scope.enter({ surface, page }, () => {
      escapes += 1;
    });
    doc.press("Escape", true);
    expect(escapes).toBe(0);
    doc.setActive(openSheet);
    doc.press("Escape");
    expect(escapes).toBe(0);
    doc.setActive(doc.body);
    doc.press("Escape");
    expect(escapes).toBe(1);
  });
});

describe("leaving the modal scope", () => {
  it("gives every marked element back and removes the dialog role", () => {
    const { scope, surface, page, opener, doc, header, main } = makePage();
    scope.enter({ surface, page }, () => undefined);
    scope.leave({ page, focusTo: opener });
    expect(doc.querySelectorAll(`[${INERT_MARKER}]`)).toHaveLength(0);
    expect(header.hasAttribute("inert")).toBe(false);
    expect(main.hasAttribute("inert")).toBe(false);
    expect(page.hasAttribute("role")).toBe(false);
    expect(page.hasAttribute("aria-modal")).toBe(false);
    expect(scope.isEntered()).toBe(false);
  });

  it("finds its marks by query, so elements it never saw are cleaned too", () => {
    const { scope, surface, page, doc } = makePage();
    scope.enter({ surface, page }, () => undefined);
    // A navigation swapped the body: the marked nodes are gone and a stale one arrived.
    const stale = new FakeElement("div", { inert: "", [INERT_MARKER]: "" });
    doc.body.children.length = 0;
    doc.body.children.push(stale);
    scope.leave({ page, focusTo: null });
    expect(stale.hasAttribute("inert")).toBe(false);
    expect(stale.hasAttribute(INERT_MARKER)).toBe(false);
  });

  it("returns focus to the bar when focus was inside the page", () => {
    const { scope, surface, page, opener, doc } = makePage();
    scope.enter({ surface, page }, () => undefined);
    scope.leave({ page, focusTo: opener });
    expect(doc.activeElement).toBe(opener);
    expect(opener.focusCalls).toBe(1);
  });

  it("leaves focus where it is when it is already outside the page", () => {
    const { scope, surface, page, opener, doc, sheetsIsland } = makePage();
    scope.enter({ surface, page }, () => undefined);
    const toastButton = sheetsIsland.children[0];
    if (!toastButton) throw new Error("no toast");
    doc.setActive(toastButton);
    scope.leave({ page, focusTo: opener });
    expect(doc.activeElement).toBe(toastButton);
    expect(opener.focusCalls).toBe(0);
  });

  it("is safe when nothing was entered, and still sweeps a stale mark", () => {
    const { scope, page, opener, doc, header } = makePage();
    header.setAttribute("inert", "");
    header.setAttribute(INERT_MARKER, "");
    scope.leave({ page, focusTo: opener });
    expect(header.hasAttribute("inert")).toBe(false);
    expect(opener.focusCalls).toBe(0);
    expect(doc.listeners.size).toBe(0);
  });
});
