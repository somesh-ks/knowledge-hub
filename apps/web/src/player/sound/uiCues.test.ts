import { describe, expect, it } from "vitest";
import { type ControlInfo, createRateLimit, cueForKind, cueForOutcome, kindFor } from "./uiCues";

const control = (over: Partial<ControlInfo>): ControlInfo => ({
  tag: "button",
  role: null,
  inputType: null,
  dataSound: null,
  on: null,
  expanded: null,
  playsItem: false,
  closesDialog: false,
  disabled: false,
  ...over,
});

describe("kindFor", () => {
  it("makes moving between destinations a navigate", () => {
    expect(kindFor(control({ tag: "a" }))).toBe("navigate");
    expect(kindFor(control({ role: "tab" }))).toBe("navigate");
    expect(kindFor(control({ playsItem: true }))).toBe("navigate");
  });

  it("makes chips, switches, checkboxes, radios, options and the sort a select", () => {
    expect(kindFor(control({ on: true }))).toBe("select");
    expect(kindFor(control({ role: "switch", on: false }))).toBe("select");
    expect(kindFor(control({ role: "option" }))).toBe("select");
    expect(kindFor(control({ tag: "input", inputType: "checkbox" }))).toBe("select");
    expect(kindFor(control({ tag: "input", inputType: "radio" }))).toBe("select");
    expect(kindFor(control({ tag: "select" }))).toBe("select");
  });

  it("makes a disclosure an open or a close by its state after the click", () => {
    expect(kindFor(control({ expanded: true }))).toBe("open");
    expect(kindFor(control({ expanded: false }))).toBe("close");
    expect(kindFor(control({ closesDialog: true }))).toBe("close");
  });

  it("gives an action button, a menu action and a skip a tap, so no button is mute", () => {
    expect(kindFor(control({}))).toBe("tap");
    expect(kindFor(control({ role: "menuitem" }))).toBe("tap");
    expect(kindFor(control({ tag: "input", inputType: "submit" }))).toBe("tap");
  });

  it("keeps a text field and a slider silent", () => {
    expect(kindFor(control({ tag: "input", inputType: "text" }))).toBe("none");
    expect(kindFor(control({ tag: "input", inputType: "range" }))).toBe("none");
  });

  it("lets data-sound override the role, and none opt out", () => {
    expect(kindFor(control({ tag: "a", dataSound: "none" }))).toBe("none");
    expect(kindFor(control({ dataSound: "none" }))).toBe("none");
    expect(kindFor(control({ dataSound: "open" }))).toBe("open");
    expect(kindFor(control({ role: "switch", dataSound: "navigate" }))).toBe("navigate");
    expect(kindFor(control({ dataSound: "loud" }))).toBe("tap");
  });

  it("never sounds for a disabled control", () => {
    expect(kindFor(control({ role: "tab", disabled: true, dataSound: "select" }))).toBe("none");
  });
});

describe("cueForKind", () => {
  it("keeps the navigate tick quieter than the scrub tick it borrows", () => {
    expect(cueForKind("navigate")?.options?.gain).toBeLessThan(1);
  });

  it("maps outcomes to the success and failure cues", () => {
    expect(cueForOutcome("success").name).toBe("generateDone");
    expect(cueForOutcome("failure").name).toBe("error");
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
