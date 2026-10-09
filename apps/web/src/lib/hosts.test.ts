import { describe, expect, it } from "vitest";
import { HOSTS, hostOf } from "./hosts";

describe("hosts", () => {
  it("names the two voices and tells them apart by more than tone", () => {
    expect(hostOf("a").name).toBe("Ada");
    expect(hostOf("b").name).toBe("Leo");
    expect(HOSTS.a.initial).not.toBe(HOSTS.b.initial);
    expect(HOSTS.a.tone).not.toBe(HOSTS.b.tone);
  });

  it("gives an unknown speaker to the lead", () => {
    expect(hostOf("x")).toBe(HOSTS.a);
  });
});
