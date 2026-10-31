import { describe, expect, it, vi } from "vitest";
import {
  destinationsToWarm,
  immediateTransition,
  isImmediate,
  markCurrent,
  pressedDestination,
  shouldRefresh,
} from "./navigationBoost";

/** The few element methods the helpers use, without a DOM. */
class FakeLink {
  attributes = new Map<string, string>();
  constructor(
    readonly kind: "item" | "brand" | "other",
    href: string,
    current = false,
  ) {
    this.attributes.set("href", href);
    if (current) this.attributes.set("aria-current", "page");
  }
  get href(): string {
    return `https://news.someshks.work${this.attributes.get("href")}`;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  closest(selector: string): FakeLink | null {
    if (selector === "a.app-nav-item") return this.kind === "item" ? this : null;
    if (selector === ".app-nav-brand") return this.kind === "brand" ? this : null;
    return null;
  }
}

function nav(current: string | null) {
  const items = ["/", "/library", "/settings"].map(
    (href) => new FakeLink("item", href, href === current),
  );
  const root = {
    querySelectorAll: (selector: string) =>
      selector.includes("[aria-current]")
        ? items.filter((item) => item.getAttribute("aria-current") !== null)
        : items,
  };
  return { items, root: root as unknown as ParentNode };
}

const asElement = (link: FakeLink) => link as unknown as HTMLAnchorElement;
const currentHrefs = (items: FakeLink[]) =>
  items.filter((item) => item.getAttribute("aria-current") === "page").map((item) => item.href);

describe("pressedDestination", () => {
  it("is the navigation item that was pressed", () => {
    const { items, root } = nav("/");
    expect(pressedDestination(asElement(items[1] as FakeLink), root)).toBe(items[1]);
  });

  it("is Today's item for the wordmark, which leads to the same page", () => {
    const { items, root } = nav("/library");
    const brand = new FakeLink("brand", "/");
    expect(pressedDestination(asElement(brand), root)).toBe(items[0]);
  });

  it("is nothing for a link outside the navigation, or for no link at all", () => {
    const { root } = nav("/");
    expect(pressedDestination(asElement(new FakeLink("other", "/d/2026-10-07")), root)).toBeNull();
    expect(pressedDestination(undefined, root)).toBeNull();
    expect(pressedDestination(null, root)).toBeNull();
  });
});

describe("markCurrent", () => {
  it("moves the current mark to the pressed item and leaves exactly one", () => {
    const { items, root } = nav("/");
    markCurrent(asElement(items[2] as FakeLink), root);
    expect(currentHrefs(items)).toEqual(["https://news.someshks.work/settings"]);
  });

  it("marks an item when none was current, as on the Create page", () => {
    const { items, root } = nav(null);
    markCurrent(asElement(items[1] as FakeLink), root);
    expect(currentHrefs(items)).toEqual(["https://news.someshks.work/library"]);
  });
});

describe("destinationsToWarm", () => {
  it("is every destination except the one on screen", () => {
    expect(destinationsToWarm(nav("/library").root)).toEqual([
      "https://news.someshks.work/",
      "https://news.someshks.work/settings",
    ]);
  });

  it("is all three on a page that belongs to none of them", () => {
    expect(destinationsToWarm(nav(null).root)).toHaveLength(3);
  });
});

describe("shouldRefresh", () => {
  const untouched = { path: "/library", touched: false, hidden: false };
  const changed = { type: "PAGE_CHANGED", path: "/library" };

  it("refreshes the page on screen when it changed and nobody has used it", () => {
    expect(shouldRefresh(changed, untouched)).toBe(true);
  });

  it("leaves a page alone once it has been touched, or while it is hidden", () => {
    expect(shouldRefresh(changed, { ...untouched, touched: true })).toBe(false);
    expect(shouldRefresh(changed, { ...untouched, hidden: true })).toBe(false);
  });

  it("ignores a change to another page and any other message", () => {
    expect(shouldRefresh({ type: "PAGE_CHANGED", path: "/" }, untouched)).toBe(false);
    expect(shouldRefresh({ type: "SKIP_WAITING" }, untouched)).toBe(false);
    expect(shouldRefresh(null, untouched)).toBe(false);
    expect(shouldRefresh("PAGE_CHANGED", untouched)).toBe(false);
  });
});

describe("immediateTransition", () => {
  it("makes the change at once and reports it done before it reports the move finished", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      const transition = immediateTransition(() => {
        order.push("update");
      });
      void transition.updateCallbackDone.then(() => order.push("done"));
      void transition.finished.then(() => order.push("finished"));
      await transition.ready;
      await Promise.resolve();
      expect(order).toEqual(["update", "done"]);
      // The marks that draw the page's own fade come off on `finished`, so it must outlast the fade.
      await vi.advanceTimersByTimeAsync(300);
      expect(order).toEqual(["update", "done"]);
      await vi.advanceTimersByTimeAsync(100);
      expect(order).toEqual(["update", "done", "finished"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is told apart from the browser's own transition, and from a look-alike", () => {
    const made = immediateTransition();
    expect(isImmediate(made)).toBe(true);
    const lookAlike = { updateCallbackDone: Promise.resolve(), finished: Promise.resolve() };
    expect(isImmediate(lookAlike)).toBe(false);
    expect(isImmediate(null)).toBe(false);
    expect(isImmediate(undefined)).toBe(false);
  });
});
