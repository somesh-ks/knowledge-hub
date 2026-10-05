import { describe, expect, it } from "vitest";
import { createLogger, redact } from "./context.js";

describe("redact", () => {
  it("replaces secret values and ignores short strings", () => {
    expect(redact("token=abcd1234efgh end", ["abcd1234efgh"])).toBe("token=[redacted] end");
    expect(redact("a b c", ["a"])).toBe("a b c");
  });
});

describe("createLogger", () => {
  it("redacts secrets in structured output", () => {
    const lines: string[] = [];
    const log = createLogger({
      json: true,
      secrets: ["supersecretvalue"],
      write: (l) => lines.push(l),
    });
    log.info("calling", { header: "Bearer supersecretvalue" });
    expect(lines[0]).not.toContain("supersecretvalue");
    expect(lines[0]).toContain("[redacted]");
  });
});
