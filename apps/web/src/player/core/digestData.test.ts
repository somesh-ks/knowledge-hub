import { describe, expect, it } from "vitest";
import { describeMediaError, describePlayRejection } from "./audioErrors";
import { DIGEST_DATA_ELEMENT_ID, isPlayerDigestData, readDigestData } from "./digestData";
import { makeDigest, makeDigestWithoutAudio } from "./testing";

function documentWith(text: string | null): Pick<Document, "getElementById"> {
  return {
    getElementById: (id: string) =>
      id === DIGEST_DATA_ELEMENT_ID && text !== null
        ? ({ textContent: text } as HTMLElement)
        : null,
  };
}

describe("reading the digest data element", () => {
  it("parses a valid digest with and without audio", () => {
    const digest = makeDigest();
    expect(readDigestData(documentWith(JSON.stringify(digest)))?.id).toBe("2026-10-07");
    expect(
      readDigestData(documentWith(JSON.stringify(makeDigestWithoutAudio())))?.audio,
    ).toBeNull();
  });

  it("returns null when the page has no element, no text or broken JSON", () => {
    expect(readDigestData(documentWith(null))).toBeNull();
    expect(readDigestData(documentWith(""))).toBeNull();
    expect(readDigestData(documentWith("{not json"))).toBeNull();
  });

  it("rejects data that would crash the player", () => {
    const base = makeDigest();
    expect(isPlayerDigestData({ ...base, items: "nope" })).toBe(false);
    expect(isPlayerDigestData({ ...base, audio: { url: 3 } })).toBe(false);
    expect(isPlayerDigestData({ ...base, cover: null })).toBe(false);
    expect(isPlayerDigestData({ ...base, items: [{ id: 1 }] })).toBe(false);
    expect(isPlayerDigestData(null)).toBe(false);
    expect(isPlayerDigestData([])).toBe(false);
  });
});

describe("media errors", () => {
  it("says what happened and what to do for each failure", () => {
    expect(describeMediaError(2, true)?.message).toMatch(/connection/);
    expect(describeMediaError(3, true)?.kind).toBe("decode");
    expect(describeMediaError(4, true)?.kind).toBe("unavailable");
    expect(describeMediaError(undefined, true)?.kind).toBe("unknown");
  });

  it("blames the connection when offline, whatever the code", () => {
    expect(describeMediaError(4, false)?.message).toMatch(/offline/i);
  });

  it("does not treat an abort as an error", () => {
    expect(describeMediaError(1, true)).toBeNull();
    expect(
      describePlayRejection(Object.assign(new Error(), { name: "AbortError" }), true),
    ).toBeNull();
  });

  it("explains a blocked play and an unsupported source", () => {
    expect(
      describePlayRejection(Object.assign(new Error(), { name: "NotAllowedError" }), true)?.kind,
    ).toBe("blocked");
    expect(
      describePlayRejection(Object.assign(new Error(), { name: "NotSupportedError" }), true)?.kind,
    ).toBe("unavailable");
    expect(describePlayRejection("weird", true)?.kind).toBe("unknown");
  });

  it("keeps every message free of em dashes and exclamation marks", () => {
    for (const code of [2, 3, 4, undefined]) {
      const message = describeMediaError(code, true)?.message ?? "";
      expect(message).not.toMatch(/[\u2014\u2013!]/);
    }
  });
});
