# Control Archetypes Guide

Standardized control reference for Singularity. When adding or modifying interactive controls (buttons, chips, tabs, switches, sheets), select with `npm run ds -- find "<need>"`. Creating bespoke button classes is strictly forbidden unless formally added to `BESPOKE_CONTROLS` in `styles.test.ts` with an approved decision rationale.

---

## 1. Decision Matrix

Which part for which need is generated, so it cannot drift from the code: `npm run ds -- find "<need>"` answers one need, `npm run ds -- list` lists every part, and `tokens/llms.txt` is the whole index with each part's use-when and what to use instead. The source is `scripts/system/parts.ts`; a test holds it against the stylesheets. Section 2 has the markup of the common parts.

---

## 2. Markup & Usage Contracts

### Button (`design-system/Button.astro`, D237)
One component, three variants; a page never types the `button-*` classes (`designSystem.test.ts` fails it).
```astro
<Button variant="filled" type="submit">Save</Button>
<Button variant="tonal" class="topic-add-source" data-add-source>Add source</Button>
<Button variant="text" href="/library">See all</Button>
```
A script or island that draws one takes the class from `design-system/button.ts`: `class="${buttonClass("filled")}"`. `class` on the component is for placing it (a margin, a grid area), never for its look; `href` draws a link.
* **Filled**: at most one per surface. Minimum 44px touch target. Never bold label text.
* **Tonal**: always matches the filled button's height. Tonal background, no border outline.
* **Text**: an accent label with no container until hovered or pressed.
* **Changing a Button** is a design-system change: its own `design-system` PR, merged by the owner.

### Icon Action Button (`.icon-btn.press`)
Single icon button for toolbars and sheet headers.
```html
<button class="icon-btn press" type="button" aria-label="Close">
  <Icon name="close" class="icon-lg" />
</button>
```
* **Rules**: Always requires an `aria-label`. Minimum 44px touch bounding box. `.press` (foundations.css) gives the press as a state layer; the glyph never scales.

### Status & Play Chip (`.chip`)
Pill showing state and action.
```html
<button class="chip" type="button" data-state="idle">
  <span class="chip-glyph" aria-hidden="true"><Icon name="play" /></span>
  <span class="chip-label">5 min</span>
</button>
```
* **Rules**: Labels must never wrap. Use fixed-width sizer copies if text length dynamically changes to prevent layout shift.

### Filter Chip (`.filter-chip`)
Selectable filter option.
```html
<label class="filter-chip">
  <input type="checkbox" name="show" value="daily" checked />
  <Icon name="check" class="filter-chip-check" />
  <span>Daily</span>
</label>
```
* **Rules**: Always wraps an underlying `<input type="checkbox">` or `<input type="radio">`.

### Row Action (`.row-action`)
Settings row or menu option acting as a tactile tile.
```html
<a class="row-action" href="/settings/schedule">
  <span class="settings-text">
    <span class="settings-label">Daily</span>
    <span class="settings-hint">Every other day at 7</span>
  </span>
  <Icon name="chevronRight" />
</a>
```
* **Rules**: Presses as an elevated tile off dividing hairlines. Label is regular weight, never bold.

### Bottom Sheet (`SheetFrame.tsx`, `MenuSheet.astro`)

A phone shows a dialog or a menu as a bottom sheet; from 40rem it is a centered dialog or a small menu under its button (D167, Ledger section 11). There are two builds, and neither is hand-written markup:

* **A dialog** (Create, Settings, Generate): mount `apps/web/src/sheets/SheetFrame.tsx`. It wraps Base UI's `Drawer`, which provides the dialog semantics, focus trap, inert background, Escape, scrim tap, swipe to dismiss and Back-closes-the-sheet. It renders `.sheet-scrim`, `.sheet-viewport`, `.sheet-popup`, `.sheet-panel` and the `.sheet-head` with the title and Close; the title is a `Drawer.Title`, so its id is generated per instance.
* **A menu** (a row's dots, the More menu): put its items in `components/MenuSheet.astro`. It is a `popover` element (`.hero-menu-list.menu-sheet`) with `SheetHeader.astro` (title at the start, Close at the end) and `.hero-menu-item` rows; `scripts/heroMenu.ts` runs its keys, focus and pull-to-close. A script that redraws rows at runtime builds them with the helpers in `lib/sheetHead.ts`.

```astro
<MenuSheet id="row-menu-3" title="Daily">
  <button class="hero-menu-item" type="button" role="menuitem" data-act="edit">Edit</button>
</MenuSheet>
```

* **Rules**: Under 40rem, selects and menus open as bottom sheets, never popovers a tap can fall through. Top corners rounded only (`--radius-sheet`). Motion uses `--duration-sheet-in` (300 ms), `--duration-sheet-out` (220 ms) and `--ease-drawer`; a dialog's height cap is `--sheet-max-height` (a `MenuSheet` has none, so keep its item list short); the bottom padding clears `--safe-bottom`. All of it is in `sheets.css` and `hero.css`; never restyle it per page.

---

## 3. Bespoke Controls Inventory

The only non-standard control classes are the ones listed in `BESPOKE_CONTROLS` in `apps/web/src/styles/styles.test.ts`, each with the reason it exists (the floating actions, the player transport and dock, the speed controls, the source row actions, menu rows, toast actions and a few more). Read that list instead of a copy here: it is the one the test enforces. A new control reuses a part from `npm run ds -- list`; adding to the list needs the owner's approval.

---

## 4. Universal Design & Performance Rules

1. **No Bold Labels**: Labels on buttons and rows stay regular weight (400 or 500); bold captures too much optical attention (D73, D125).
2. **Never Scale Words on Press**: Label controls and worded buttons show a press on their background fill or tonal overlay, never by scaling text geometry down.
3. **No Layout Shift**: Controls must never jump or change geometry when state toggles.
4. **Strict Token Colors**: All control backgrounds, active layers, and ink colors must resolve to semantic color tokens (`--color-surface-*`, `--color-accent-*`, `--color-on-surface-*`). A hex or `rgb()` literal in a source file fails `npm run design-check`.
5. **Phone Sheets over Popovers**: Under 40rem, lists and menus open as bottom sheets, never popovers (D167, Ledger section 11).
6. **First-Load JS Ceiling (130 KB)**: First-load JavaScript has a 130 KB gzipped ceiling (`FIRST_LOAD_BUDGET_BYTES`, D141). React islands wake on interaction or playback via `client:wake` (D178). Never load unhydrated client runtimes into first paint.
7. **Specificity & `:where()` Scoping**: When styling compound or pseudo-state selectors on shared utility classes (e.g. `:has()`, `:focus-visible`, or state layers), wrap them in `:where()` to avoid inflating specificity over page-level overrides (#386, commit 2510be54). Rationale comments (`/* D-number ... */`) in shared stylesheets are load-bearing and must be extended, never removed.
8. **Dual-Rendering Markup Parity**: When building rows or components rendered both at build time in Astro and at runtime in client scripts (such as `structureView.ts` and `structureEditor.ts`), use the typed HTML template helpers in `apps/web/src/lib/sheetHead.ts` (`menuItemHtml`, `settingsTextHtml`, `iconBtnHtml`, `sheetHeadHtml`) rather than manual string concatenation.
