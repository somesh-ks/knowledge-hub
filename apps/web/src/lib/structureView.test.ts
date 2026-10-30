import type { StructureBlock } from "@singularity/core";
import { describe, expect, it } from "vitest";
import {
  blockCount,
  blockName,
  blockSummary,
  isFrame,
  moved,
  promptKey,
  rowsHtml,
  type SectionOffer,
  type SkipLists,
  type StructureData,
} from "./structureView";

describe("structureView", () => {
  const sections: SectionOffer[] = [
    { id: "design", name: "Design & UX", topics: ["design"] },
    { id: "tech", name: "Technology", topics: ["tech"] },
  ];

  const data: Pick<StructureData, "sections" | "texts" | "builtins"> = {
    sections,
    texts: ["Built-in rundown prompt", "Built-in close prompt"],
    builtins: { rundown: 0, close: 1 },
  };

  const skip: SkipLists = { daily: [], weekly: [] };

  it("formats section count plainly", () => {
    expect(blockCount(1)).toBe("1 section");
    expect(blockCount(5)).toBe("5 sections");
  });

  it("resolves block names for sections and standard types", () => {
    expect(blockName({ type: "hello" }, sections)).toBe("Hello");
    expect(blockName({ type: "rundown" }, sections)).toBe("Rundown");
    expect(blockName({ type: "section", id: "design", depth: "brief" }, sections)).toBe(
      "Design & UX",
    );
    expect(blockName({ type: "custom", title: "My Segment", brief: "..." }, sections)).toBe(
      "My Segment",
    );
  });

  it("produces prompt keys and block summaries", () => {
    expect(promptKey({ type: "section", id: "design", depth: "brief" })).toBe("section:design");
    expect(promptKey({ type: "rundown" })).toBe("rundown");
    expect(blockSummary({ type: "rundown" })).toBe("Auto");
    expect(blockSummary({ type: "custom", title: "My Segment", brief: "..." })).toBe(
      "Your own block",
    );
  });

  it("identifies frame blocks that cannot move or leave", () => {
    expect(isFrame({ type: "hello" })).toBe(true);
    expect(isFrame({ type: "sign_off" })).toBe(true);
    expect(isFrame({ type: "rundown" })).toBe(false);
    expect(isFrame({ type: "section", id: "design", depth: "brief" })).toBe(false);
  });

  it("moves non-frame blocks safely", () => {
    const blocks: StructureBlock[] = [
      { type: "hello" },
      { type: "rundown" },
      { type: "section", id: "design", depth: "brief" },
      { type: "sign_off" },
    ];
    const reordered = moved(blocks, 1, 2);
    expect(reordered[1]?.type).toBe("section");
    expect(reordered[2]?.type).toBe("rundown");

    // Frames cannot be moved or moved into
    expect(moved(blocks, 0, 1)).toEqual(blocks);
    expect(moved(blocks, 1, 3)).toEqual(blocks);
  });

  it("renders rowsHtml with typed template helpers and correct data attributes", () => {
    const blocks: StructureBlock[] = [
      { type: "hello" },
      { type: "rundown" },
      { type: "section", id: "design", depth: "brief", max_stories: 3 },
      { type: "sign_off" },
    ];

    const html = rowsHtml(blocks, data, skip);

    // Hello and sign_off are frames and should not render rows
    expect(html).not.toContain("Hello");
    expect(html).not.toContain("Sign-off");

    // Rundown row
    expect(html).toContain('class="settings-row structure-row" data-index="1"');
    expect(html).toContain('class="icon-btn press structure-grip"');
    expect(html).toContain('aria-label="Move Rundown"');
    expect(html).toContain("data-grip");
    expect(html).toContain('class="settings-label">Rundown</span>');

    // Section row
    expect(html).toContain('class="settings-row structure-row" data-index="2"');
    expect(html).toContain('class="settings-label">Design &amp; UX</span>');
    expect(html).toContain('aria-label="Move Design &amp; UX"');

    // Menu actions rendered via menuItemHtml
    expect(html).toContain('class="menu-item" type="button" role="menuitem" data-act="up"');
    expect(html).toContain('class="menu-item" type="button" role="menuitem" data-act="down"');
    expect(html).toContain('class="menu-item" type="button" role="menuitem" data-act="edit"');
    expect(html).toContain(
      'class="menu-item menu-item-danger" type="button" role="menuitem" data-act="remove"',
    );

    // Data-icon ink alignment
    expect(html).toContain('data-icon="grip"');
    expect(html).toContain('data-icon="moreVert"');
    expect(html).toContain('data-icon="arrowUp"');
    expect(html).toContain('data-icon="pencilSimple"');
    expect(html).toContain('data-icon="trash"');
  });

  it("disables Move up on the first movable row and Move down on the last, and neither between", () => {
    const blocks: StructureBlock[] = [
      { type: "hello" },
      { type: "rundown" },
      { type: "section", id: "design", depth: "brief" },
      { type: "section", id: "tech", depth: "brief" },
      { type: "sign_off" },
    ];
    const html = rowsHtml(blocks, data, skip);
    const row = (index: number): string =>
      html.match(new RegExp(`data-index="${index}"[\\s\\S]*?</li>`))?.[0] ?? "";

    expect(row(1)).toContain('data-act="up" disabled');
    expect(row(1)).not.toContain('data-act="down" disabled');
    expect(row(2)).not.toContain("disabled");
    expect(row(3)).toContain('data-act="down" disabled');
    expect(row(3)).not.toContain('data-act="up" disabled');
  });

  it("marks off sections with data-off and data-quiet", () => {
    const blocks: StructureBlock[] = [
      { type: "hello" },
      { type: "section", id: "tech", depth: "brief" },
      { type: "sign_off" },
    ];
    const offSkip: SkipLists = { daily: ["tech"], weekly: ["tech"] };
    const html = rowsHtml(blocks, data, offSkip);

    expect(html).toContain("data-off data-quiet");
    expect(html).toContain("Off in daily and weekly");
  });
});
