import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  iconBtnHtml,
  iconHtml,
  menuItemHtml,
  settingsTextHtml,
  sheetHeadHtml,
} from "./sheetHead";

describe("sheetHead helpers", () => {
  it("escapes html characters safely", () => {
    expect(escapeHtml('<div class="test">& \' "</div>')).toBe(
      "&lt;div class=&quot;test&quot;&gt;&amp; &#39; &quot;&lt;/div&gt;",
    );
  });

  it("renders an icon with data-icon for ink alignment", () => {
    const icon = iconHtml("close", "icon-lg");
    expect(icon).toContain('class="icon icon-lg"');
    expect(icon).toContain('data-icon="close"');
    expect(icon).toContain('aria-hidden="true"');
    expect(icon).toContain("<svg");
  });

  it("renders a sheet header row with close button", () => {
    const head = sheetHeadHtml("Edit block", "title-1", "data-menu-close", {
      "data-sheet-title": "",
    });
    expect(head).toContain('class="create-sheet-head"');
    expect(head).toContain('<h2 class="sheet-title" id="title-1" data-sheet-title>Edit block</h2>');
    expect(head).toContain("data-menu-close");
    expect(head).toContain('aria-label="Close"');
  });

  it("renders a menu item with data-act, role, and icon", () => {
    const item = menuItemHtml({
      act: "edit",
      glyph: "pencilSimple",
      label: "Edit block",
    });
    expect(item).toContain('class="hero-menu-item"');
    expect(item).toContain('role="menuitem"');
    expect(item).toContain('data-act="edit"');
    expect(item).toContain('data-icon="pencilSimple"');
    expect(item).toContain("Edit block");
  });

  it("renders a disabled menu item with extra classes", () => {
    const item = menuItemHtml({
      act: "remove",
      glyph: "trash",
      label: "Remove",
      disabled: true,
      extraClass: "hero-menu-delete",
    });
    expect(item).toContain('class="hero-menu-item hero-menu-delete"');
    expect(item).toContain(" disabled");
    expect(item).toContain('data-act="remove"');
  });

  it("renders settings text with label and optional hint", () => {
    const withHint = settingsTextHtml({
      label: "Top picks",
      hint: "Deep coverage",
    });
    expect(withHint).toBe(
      '<div class="settings-text"><span class="settings-label">Top picks</span><span class="settings-hint">Deep coverage</span></div>',
    );

    const withoutHint = settingsTextHtml({ label: "Rundown" });
    expect(withoutHint).toBe(
      '<div class="settings-text"><span class="settings-label">Rundown</span></div>',
    );
  });

  it("renders an icon button with proper attributes and ink margins", () => {
    const btn = iconBtnHtml({
      label: "More options",
      glyph: "moreVert",
      className: "icon-btn-end structure-more",
      popoverTarget: "menu-1",
      dataAttrs: {
        "aria-haspopup": "menu",
        "data-hero-more": true,
      },
    });
    expect(btn).toContain('class="icon-btn press icon-btn-end structure-more"');
    expect(btn).toContain('aria-label="More options"');
    expect(btn).toContain('popovertarget="menu-1"');
    expect(btn).toContain('aria-haspopup="menu"');
    expect(btn).toContain("data-hero-more");
    expect(btn).toContain('data-icon="moreVert"');
  });

  it("escapes dynamic attributes in menuItemHtml and iconBtnHtml", () => {
    const item = menuItemHtml({
      act: 'edit" data-evil="true',
      glyph: "pencilSimple",
      label: "Safe Label",
      extraClass: 'bad" class="injected',
    });
    expect(item).toContain('data-act="edit&quot; data-evil=&quot;true"');
    expect(item).toContain('class="hero-menu-item bad&quot; class=&quot;injected"');

    const btn = iconBtnHtml({
      label: "Safe Btn",
      glyph: "moreVert",
      className: 'injected" onclick="alert(1)',
      popoverTarget: 'pop" target="evil',
      describedBy: 'desc" aria-label="evil',
    });
    expect(btn).toContain('class="icon-btn press injected&quot; onclick=&quot;alert(1)"');
    expect(btn).toContain('popovertarget="pop&quot; target=&quot;evil"');
    expect(btn).toContain('aria-describedby="desc&quot; aria-label=&quot;evil"');
  });
});
