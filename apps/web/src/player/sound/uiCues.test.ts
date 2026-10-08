import { describe, expect, it } from "vitest";
import {
  type ControlInfo,
  createRateLimit,
  cueForKind,
  cueForOutcome,
  isSoundKind,
  kindFor,
} from "./uiCues";

const control = (over: Partial<ControlInfo>): ControlInfo => ({
  tag: "button",
  role: null,
  inputType: null,
  dataSound: null,
  internalLink: false,
  on: null,
  expanded: null,
  playsItem: false,
  closesDialog: false,
  disabled: false,
  ...over,
});

describe("kindFor", () => {
  it("makes moving between destinations a navigate", () => {
    expect(kindFor(control({ tag: "a", internalLink: true }))).toBe("navigate");
    expect(kindFor(control({ role: "tab" }))).toBe("navigate");
    expect(kindFor(control({ playsItem: true }))).toBe("navigate");
  });

  it("stays silent for links that leave the site", () => {
    expect(kindFor(control({ tag: "a", internalLink: false }))).toBe("none");
  });

  it("makes chips, switches, checkboxes, radios, menu picks and the sort a select", () => {
    expect(kindFor(control({ on: true }))).toBe("select");
    expect(kindFor(control({ role: "switch", on: false }))).toBe("select");
    expect(kindFor(control({ role: "menuitem" }))).toBe("select");
    expect(kindFor(control({ tag: "input", inputType: "checkbox" }))).toBe("select");
    expect(kindFor(control({ tag: "input", inputType: "radio" }))).toBe("select");
    expect(kindFor(control({ tag: "select" }))).toBe("select");
  });

  it("makes a disclosure an open or a close by its state after the click", () => {
    expect(kindFor(control({ expanded: true }))).toBe("open");
    expect(kindFor(control({ expanded: false }))).toBe("close");
    expect(kindFor(control({ closesDialog: true }))).toBe("close");
  });

  it("leaves a plain button silent, so Save and Delete answer with their outcome", () => {
    expect(kindFor(control({}))).toBe("none");
    expect(kindFor(control({ tag: "input", inputType: "text" }))).toBe("none");
  });

  it("lets data-sound override the role, and none opt out", () => {
    expect(kindFor(control({ tag: "a", internalLink: true, dataSound: "none" }))).toBe("none");
    expect(kindFor(control({ dataSound: "open" }))).toBe("open");
    expect(kindFor(control({ role: "switch", dataSound: "navigate" }))).toBe("navigate");
    expect(kindFor(control({ dataSound: "loud" }))).toBe("none");
  });

  it("never sounds for a disabled control", () => {
    expect(kindFor(control({ role: "tab", disabled: true, dataSound: "select" }))).toBe("none");
  });
});

describe("cueForKind", () => {
  it("uses the cues the sound package already has", () => {
    expect(cueForKind("navigate")?.name).toBe("scrubDetent");
    expect(cueForKind("select", true)?.name).toBe("toggleOn");
    expect(cueForKind("select", false)?.name).toBe("toggleOff");
    expect(cueForKind("open")?.name).toBe("sheetOpen");
    expect(cueForKind("close")?.name).toBe("sheetClose");
    expect(cueForKind("none")).toBeNull();
  });

  it("keeps the navigate tick quieter than the scrub tick it borrows", () => {
    expect(cueForKind("navigate")?.options?.gain).toBeLessThan(1);
  });

  it("maps outcomes to the success and failure cues", () => {
    expect(cueForOutcome("success").name).toBe("generateDone");
    expect(cueForOutcome("failure").name).toBe("error");
  });
});

describe("isSoundKind", () => {
  it("accepts the five kinds only", () => {
    for (const kind of ["navigate", "select", "open", "close", "none"]) {
      expect(isSoundKind(kind)).toBe(true);
    }
    expect(isSoundKind("success")).toBe(false);
    expect(isSoundKind(null)).toBe(false);
  });
});

describe("createRateLimit", () => {
  it("drops taps inside the gap and lets the next one through after it", () => {
    const allow = createRateLimit(90);
    expect(allow(1_000)).toBe(true);
    expect(allow(1_040)).toBe(false);
    expect(allow(1_089)).toBe(false);
    expect(allow(1_090)).toBe(true);
  });

  it("does not let a burst push the window forward", () => {
    const allow = createRateLimit(100);
    expect(allow(0)).toBe(true);
    for (let t = 10; t < 100; t += 10) expect(allow(t)).toBe(false);
    expect(allow(100)).toBe(true);
  });
});
