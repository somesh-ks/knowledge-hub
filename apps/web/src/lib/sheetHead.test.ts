import { describe, expect, it } from "vitest";
import { escapeHtml, iconHtml, sheetHeadHtml } from "./sheetHead";

describe("sheetHead helpers", () => {
  it("escapes html characters safely", () => {
    expect(escapeHtml('<div class="test">& \' "</div>')).toBe(
      "&lt;div class=&quot;test&quot;&gt;&amp; &#39; &quot;&lt;/div&gt;",
    );
  });

  it("renders an icon with data-icon for ink alignment", () => {
    const icon = iconHtml("close", "lg");
    expect(icon).toContain('class="icon-glyph icon-glyph-lg"');
    expect(icon).toContain('data-icon="close"');
    expect(icon).toContain('aria-hidden="true"');
    expect(icon).toContain("<svg");
  });

  it("renders a sheet header row with close button", () => {
    const head = sheetHeadHtml("Edit block", "title-1", "data-menu-close", {
      "data-sheet-title": "",
    });
    expect(head).toContain('class="sheet-head"');
    expect(head).toContain(
      '<h2 class="sheet-title text-heading" id="title-1" data-sheet-title>Edit block</h2>',
    );
    expect(head).toContain("data-menu-close");
    expect(head).toContain('aria-label="Close"');
  });
});
