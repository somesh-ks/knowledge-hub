import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { STATE_FILES } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addUsage,
  checkBudget,
  DEFAULT_MONTHLY_CHARS,
  describeRefusal,
  emptyUsage,
  loadUsage,
  parseMonthlyChars,
  recordUsage,
  rollOver,
  saveUsage,
  usageMonth,
} from "../src/audio/budget.js";
import { loadAllCosts } from "../src/cost/ledger.js";
import type { TempRoot } from "./audio-fixtures.js";
import { makeTempRoot, writeRepoFile } from "./audio-fixtures.js";

const OCTOBER = new Date("2026-10-07T06:00:00Z");
const usage = (month: string, characters: number) => ({
  version: 1 as const,
  speechify: { month, characters },
});

describe("parseMonthlyChars", () => {
  it("defaults to 500,000 when unset or empty", () => {
    expect(parseMonthlyChars(undefined)).toBe(500_000);
    expect(parseMonthlyChars("")).toBe(DEFAULT_MONTHLY_CHARS);
  });

  it("reads a positive integer from a string or number", () => {
    expect(parseMonthlyChars("100000")).toBe(100_000);
    expect(parseMonthlyChars(250_000)).toBe(250_000);
  });

  it.each(["abc", "0", "-5", "1.5", "12k"])("rejects %j", (raw) => {
    expect(() => parseMonthlyChars(raw)).toThrow(/SPEECHIFY_MONTHLY_CHARS/);
  });
});

describe("usageMonth", () => {
  it("is the Stockholm calendar month", () => {
    expect(usageMonth(OCTOBER)).toBe("2026-10");
  });

  it("rolls over at Stockholm midnight, not UTC midnight", () => {
    // 23:30 UTC on 30 September is 01:30 on 1 October in Stockholm (UTC+2 in summer time).
    expect(usageMonth(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10");
    expect(usageMonth(new Date("2026-09-30T21:59:00Z"))).toBe("2026-09");
  });

  it("handles winter time (UTC+1)", () => {
    expect(usageMonth(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01");
  });
});

describe("rollOver", () => {
  it("keeps usage from the same month", () => {
    expect(rollOver(usage("2026-10", 1200), "2026-10").speechify.characters).toBe(1200);
  });

  it("starts at zero when the stored month is older", () => {
    expect(rollOver(usage("2026-09", 430_000), "2026-10")).toEqual(emptyUsage("2026-10"));
  });

  it("starts at zero when nothing is stored", () => {
    expect(rollOver(undefined, "2026-10")).toEqual(emptyUsage("2026-10"));
  });
});

describe("checkBudget", () => {
  const monthlyChars = 500_000;
  const limit = 450_000;

  it("allows a request that fits under 90 percent", () => {
    const decision = checkBudget({
      usage: usage("2026-10", 10_000),
      now: OCTOBER,
      requested: 5000,
      monthlyChars,
    });
    expect(decision).toEqual({
      ok: true,
      month: "2026-10",
      used: 10_000,
      requested: 5000,
      limit,
      remaining: 440_000,
    });
  });

  it("allows a request that lands exactly on 90 percent", () => {
    expect(
      checkBudget({ usage: usage("2026-10", 445_000), now: OCTOBER, requested: 5000, monthlyChars })
        .ok,
    ).toBe(true);
  });

  it("refuses a request one character over 90 percent", () => {
    const decision = checkBudget({
      usage: usage("2026-10", 445_000),
      now: OCTOBER,
      requested: 5001,
      monthlyChars,
    });
    expect(decision).toEqual({
      ok: false,
      reason: "monthly_budget",
      month: "2026-10",
      used: 445_000,
      requested: 5001,
      limit,
      monthlyChars,
    });
  });

  it("refuses a request that alone exceeds the limit", () => {
    expect(
      checkBudget({ usage: emptyUsage("2026-10"), now: OCTOBER, requested: 450_001, monthlyChars })
        .ok,
    ).toBe(false);
  });

  it("scales the limit with the configured allowance", () => {
    const small = checkBudget({
      usage: emptyUsage("2026-10"),
      now: OCTOBER,
      requested: 9001,
      monthlyChars: 10_000,
    });
    expect(small.ok).toBe(false);
    expect(small.limit).toBe(9000);
  });

  it("ignores last month's characters after the rollover", () => {
    const decision = checkBudget({
      usage: usage("2026-09", 449_000),
      now: OCTOBER,
      requested: 5000,
      monthlyChars,
    });
    expect(decision.ok).toBe(true);
    expect(decision.used).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects a requested count of %s", (requested) => {
    expect(() =>
      checkBudget({ usage: emptyUsage("2026-10"), now: OCTOBER, requested, monthlyChars }),
    ).toThrow();
  });

  it("describes a refusal with the numbers", () => {
    const decision = checkBudget({
      usage: usage("2026-10", 449_000),
      now: OCTOBER,
      requested: 5000,
      monthlyChars,
    });
    if (decision.ok) throw new Error("expected a refusal");
    const text = describeRefusal(decision);
    for (const part of ["2026-10", "449000", "5000", "450000", "500000"])
      expect(text).toContain(part);
  });
});

describe("addUsage", () => {
  it("adds to the current month", () => {
    expect(addUsage(usage("2026-10", 100), OCTOBER, 50)).toEqual(usage("2026-10", 150));
  });

  it("rolls over before adding", () => {
    expect(addUsage(usage("2026-09", 400_000), OCTOBER, 50)).toEqual(usage("2026-10", 50));
  });

  it("rounds and never subtracts", () => {
    expect(addUsage(usage("2026-10", 100), OCTOBER, 10.6).speechify.characters).toBe(111);
    expect(addUsage(usage("2026-10", 100), OCTOBER, -40).speechify.characters).toBe(100);
  });
});

const PRICES = JSON.stringify({
  version: 1,
  as_of: "2026-10-21",
  prices: [
    {
      provider: "speechify",
      product: "*",
      units: { characters: { usd: 10, per: 1_000_000 } },
      as_of: "2026-10-21",
      confirmed: false,
    },
  ],
});

describe("usage file", () => {
  let temp: TempRoot;
  beforeEach(async () => {
    temp = await makeTempRoot();
  });
  afterEach(async () => {
    await temp.cleanup();
  });

  it("loads an empty usage when the file does not exist", async () => {
    expect(await loadUsage(temp.root, OCTOBER)).toEqual(emptyUsage("2026-10"));
  });

  it("loads the stored count for the current month", async () => {
    await writeRepoFile(temp.root, STATE_FILES.usage, JSON.stringify(usage("2026-10", 4242)));
    expect((await loadUsage(temp.root, OCTOBER)).speechify.characters).toBe(4242);
  });

  it("rolls a stored count from an earlier month over to zero", async () => {
    await writeRepoFile(temp.root, STATE_FILES.usage, JSON.stringify(usage("2026-09", 400_000)));
    expect(await loadUsage(temp.root, OCTOBER)).toEqual(emptyUsage("2026-10"));
  });

  it("rejects a usage file that fails the schema", async () => {
    await writeRepoFile(temp.root, STATE_FILES.usage, JSON.stringify({ version: 2 }));
    await expect(loadUsage(temp.root, OCTOBER)).rejects.toThrow(/usage\.json is not valid/);
  });

  it("writes JSON with two-space indent, no BOM and a trailing newline", async () => {
    await saveUsage(temp.root, usage("2026-10", 7));
    const text = await readFile(join(temp.root, STATE_FILES.usage), "utf8");
    expect(text).toBe(
      '{\n  "version": 1,\n  "speechify": {\n    "month": "2026-10",\n    "characters": 7\n  }\n}\n',
    );
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("refuses to save an invalid file", async () => {
    await expect(
      saveUsage(temp.root, { version: 1, speechify: { month: "October", characters: 1 } }),
    ).rejects.toThrow();
  });

  it("accumulates across recorded runs", async () => {
    await recordUsage({ root: temp.root, now: OCTOBER, characters: 4710 });
    const after = await recordUsage({ root: temp.root, now: OCTOBER, characters: 5290 });
    expect(after.speechify.characters).toBe(10_000);
    expect((await loadUsage(temp.root, OCTOBER)).speechify.characters).toBe(10_000);
  });

  it("keeps every billing of one run in the cost ledger: six segments, or a partial stream and its retry", async () => {
    await writeRepoFile(temp.root, "config/prices.json", PRICES);
    const ledger = { runId: "ep-1", kind: "on_demand" as const, product: "simba-3.2" };
    for (const characters of [100, 200, 300, 400, 500, 600]) {
      await recordUsage({ root: temp.root, now: OCTOBER, characters, ledger });
    }
    const spent = (await loadAllCosts(temp.root)).reduce(
      (sum, record) => sum + (record.units.characters ?? 0),
      0,
    );
    expect(spent).toBe(2100);
  });

  it("starts a new month at the recorded amount", async () => {
    await recordUsage({
      root: temp.root,
      now: new Date("2026-09-30T10:00:00Z"),
      characters: 300_000,
    });
    const november = await recordUsage({
      root: temp.root,
      now: new Date("2026-11-02T10:00:00Z"),
      characters: 1000,
    });
    expect(november).toEqual(usage("2026-11", 1000));
  });

  it("leaves no temporary file behind", async () => {
    await recordUsage({ root: temp.root, now: OCTOBER, characters: 1 });
    expect(await readdir(join(temp.root, "state"))).toEqual(["usage.json"]);
  });
});
