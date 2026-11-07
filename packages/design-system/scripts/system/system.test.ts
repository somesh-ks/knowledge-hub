import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSystem, classTokens, LLMS_PATH, SYSTEM_PATH } from "./build.js";
import { findParts, findTokens } from "./query.js";
import type { System } from "./types.js";
import { usageComment } from "./usage.js";

/**
 * The file as published, which `npm run ds` answers from. Whether it matches the code the apps draw
 * the system with is checked where both are visible (scripts/system.test.ts at the repository root).
 */
const system = JSON.parse(readFileSync(SYSTEM_PATH, "utf8")) as System;
const ids = new Set(system.parts.map((part) => part.id));

describe("the design system file", () => {
  // Prevents a "not this, use that" pointing at a part that does not exist.
  it("points every alternative at a part", () => {
    const dangling = system.parts.flatMap((part) =>
      (part.not ?? [])
        .filter((item) => !ids.has(item.use) && !item.use.startsWith("nothing"))
        .map((item) => `${part.id} -> ${item.use}`),
    );
    expect(dangling).toEqual([]);
    expect(ids.size).toBe(system.parts.length);
  });

  // Prevents publishing an opaque hex for a translucent color: the scrim was listed as #151618, which
  // reads as solid and drops the 42% that makes it a scrim.
  it("gives no hex to a translucent color", () => {
    for (const built of [system, buildSystem()]) {
      const scrim = built.tokens.find((token) => token.name === "--color-scrim");
      expect(scrim?.light).toContain(" / ");
      expect(scrim?.hex).toBeUndefined();
      expect(built.tokens.find((token) => token.name === "--color-surface")?.hex).toBeDefined();
    }
  });

  // Prevents a part showing another rule's comment: `.settings-row .multiselect` has a comment of its
  // own, and it was shown as the usage of the settings row. A class may also open a group ("a, b {")
  // elsewhere with no comment of its own; the comment is the one over its own rule.
  it("takes a usage comment from the rule of the class alone", () => {
    const root = mkdtempSync(join(tmpdir(), "usage-"));
    mkdirSync(join(root, "styles"), { recursive: true });
    writeFileSync(
      join(root, "styles/x.css"),
      "/* inside the row */\n.row .field {\n  color: red;\n}\n\n.row,\n.plain {\n  display: flex;\n}\n\n/* the row itself */\n.row {\n  color: blue;\n}\n",
    );
    expect(usageComment("styles/x.css", ".row", root)).toBe("the row itself");
    expect(usageComment("styles/x.css", ".plain", root)).toBe("");
  });

  // Prevents the index outgrowing its purpose: it is read whole, so each byte is paid for on every task.
  it("keeps llms.txt under 14 KB", () => {
    expect(Buffer.byteLength(readFileSync(LLMS_PATH))).toBeLessThan(14 * 1024);
  });
});

describe("class detection", () => {
  // Prevents a dead class passing for a live part: role="switch" and the word in prose once made
  // `.switch` look used in 49 files while no markup wore it, and an agent was sent to it.
  it("counts only names written as classes", () => {
    const used = classTokens(
      `<input class="settings-switch x" role="switch" /> <a class:list={["a-b", cond && 'c-d']}> switch (mode) {} el.classList.add("e-f") iconBtnHtml({ className: "g-h i-j" })`,
    );
    expect([...used].sort()).toEqual(["a-b", "c-d", "e-f", "g-h", "i-j", "settings-switch", "x"]);
  });
});

describe("the lookup", () => {
  // Needs from the first lookup trial (14 tasks given to agents that had no tool): the part an
  // experienced person would pick must be the first answer, or the lookup costs more than it saves.
  const NEEDS: [need: string, part: string][] = [
    [
      "add a switcher between the Stories and Transcript views of the same episode",
      "segmented-nav",
    ],
    ["let the user choose a summary length: exactly one of 3, 5 or 10 minutes", "segmented-choice"],
    ["let the user tick several topics to include", "filter-chip"],
    ["a new bottom sheet needs a title and a close control in its header", "sheet"],
    ["a new form sheet needs one main Save button and a Cancel beside it", "button-filled"],
    // A phrase a part lists under "not when" must not rank that part first.
    ["a second action beside the main one", "button-tonal"],
    ["a new page has nothing to list yet and must say so", "empty-state"],
    ["tell the user, persistently at the top of a page, that a download failed", "banner"],
    ["after the user deletes an episode, show a brief message with an Undo action", "toast"],
    ["add a row that opens a sub-page when tapped", "row-action"],
    ["add a compact dropdown to sort a list by date or by title", "select"],
  ];

  it.each(NEEDS)("answers %j with %s first", (need, part) => {
    expect(findParts(system, need, 3)[0]?.part.id).toBe(part);
  });

  // Prevents a token lookup that cannot find the tonal fill, the muted ink or the sheet's motion.
  it("finds a token by what it is for", () => {
    const names = (need: string) => findTokens(system, need, 5).map((hit) => hit.token.name);
    expect(names("quiet secondary text that still passes 4.5:1 contrast")).toContain(
      "--color-on-surface-muted",
    );
    expect(names("tonal background for a control sitting on the page")).toContain(
      "--color-surface-container",
    );
    expect(names("bottom sheet slide-in duration")).toContain("--duration-sheet-in");
    expect(names("round the top corners of a bottom sheet")).toContain("--shape-sheet");
  });

  it("answers nothing for a need no part covers", () => {
    expect(findParts(system, "xyzzy plugh", 3)).toEqual([]);
  });
});
