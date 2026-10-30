import { parseHTML } from "linkedom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The delegation rule over a real (linkedom) tree: one press, one cue, from the nearest control.
const played: string[] = [];
vi.mock("./soundController", () => ({
  playUiCue: (cue: { name: string } | null) => {
    if (cue) played.push(cue.name);
    return cue !== null;
  },
  cuePlayedSince: () => false,
}));

const { document, Element, HTMLInputElement, HTMLDetailsElement } = parseHTML(`<!doctype html><body>
  <button id="save">Save</button>
  <button id="off" disabled><span id="off-inner">Off</span></button>
  <a id="link" class="button-filled" href="/create"><span id="link-inner">Catch up</span></a>
  <div id="option" role="option" aria-selected="true">Design</div>
</body>`);
let onUiEvent: (event: Event) => void;

beforeAll(async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { Element, HTMLInputElement, HTMLDetailsElement });
  ({ onUiEvent } = await import("./uiClicks"));
  // After the import: the module wires its own listeners when it sees a document.
  // The announced cue (singularity:cue) is Node's event, which linkedom cannot dispatch.
  document.dispatchEvent = () => true;
  Object.assign(globalThis, { document });
});

afterEach(() => {
  played.length = 0;
  // The rate limit drops a cue inside its gap of the last one.
  vi.advanceTimersByTime(500);
});

/** A press the person made: the delegated listener reads only these fields. */
const press = (id: string): void =>
  onUiEvent({
    type: "click",
    isTrusted: true,
    timeStamp: 1e9,
    target: document.getElementById(id),
  } as unknown as Event);

describe("the delegated interface sound", () => {
  it("plays one cue for a button", () => {
    press("save");
    // The tap borrows the scrub detent's tick (uiCues.ts).
    expect(played).toEqual(["scrubDetent"]);
  });

  it("plays one cue for a press on an element inside a link styled as a button", () => {
    press("link-inner");
    expect(played).toHaveLength(1);
  });

  it("plays none for a disabled control, or for what is inside one", () => {
    press("off");
    press("off-inner");
    expect(played).toEqual([]);
  });

  it("plays a select cue for a listbox option, which is not a native control", () => {
    press("option");
    expect(played).toEqual(["toggleOn"]);
  });
});
