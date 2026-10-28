# Control Archetypes Guide

Standardized control reference for Singularity. When adding or modifying interactive controls (buttons, chips, tabs, switches, sheets), select directly from this catalog. Creating bespoke button classes is strictly forbidden unless formally added to `BESPOKE_CONTROLS` in `styles.test.ts` with an approved decision rationale.

---

## 1. Decision Matrix

| Archetype | Class / Element | Primary Purpose | When to Use |
| :--- | :--- | :--- | :--- |
| **Primary Button** | `.btn-primary` | High-emphasis trigger | Single primary action per card or surface (Hero Play, Sheet Submit). |
| **Secondary Button** | `.btn-secondary` | Medium-emphasis companion | Paired alongside a primary button (Share, Cancel, Dismiss). |
| **Tonal Button** | `.btn` | Low-emphasis neutral trigger | Standard surface actions (Settings head links, Library filters). |
| **Icon Button** | `.icon-btn.press` | Single glyph action | Compact controls (More options, Close, Edit, Reorder grip). |
| **Action Chip** | `.chip` | Status + action pill | Episode duration, playback status pill. Uses fixed-width sizers. |
| **Filter Chip** | `.filter-chip` | Multi-select toggle | Category and format filtering (Daily, Weekly, Episodes). Wraps input. |
| **Segmented Nav** | `.segmented-nav-tab` | View switcher | Sliding pill tablist switching active view (Stories vs Transcript). |
| **Segmented Choice** | `.segmented-choice-item` | Single option picker | Radio group for discrete values (3 min, 5 min, 10 min). |
| **Row Action** | `.row-action` | Full-row navigation trigger | Settings and menu rows acting as pressable tiles off hairlines. |
| **Floating Action** | `CreateFab.astro`, `AddFab.astro` | Floating action trigger | Prominent mobile creation triggers pinned above bottom dock. |
| **Bottom Sheet** | `SheetFrame.tsx` (dialogs), `MenuSheet.astro` (menus) | Bottom-sheet presentation under 40rem | Dialogs are modal; menus are popovers styled as bottom sheets. Lists, menus and selects on a phone sit in one, never in a small popover. |

---

## 2. Markup & Usage Contracts

### Primary Action (`.btn-primary`)
High-emphasis filled tonal pill.
```html
<button class="btn-primary" type="button">Play</button>
<button class="btn-primary" type="button" disabled>Play</button>
```
* **Rules**: At most one per surface. Minimum 44px touch target. Never bold label text.

### Secondary Action (`.btn-secondary`)
Medium-emphasis tonal surface paired with primary.
```html
<button class="btn-secondary" type="button">Share</button>
```
* **Rules**: Always matches primary button height. Tonal background, no harsh border outlines.

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

The only non-standard control classes are the ones listed in `BESPOKE_CONTROLS` in `apps/web/src/styles/styles.test.ts`, each with the reason it exists (the floating actions, the player transport and dock, the speed controls, the source row actions, menu rows, toast actions and a few more). Read that list instead of a copy here: it is the one the test enforces. A new control reuses a matrix archetype; adding to the list needs the owner's approval.

---

## 4. Universal Design & Performance Rules

1. **No Bold Labels**: Labels on buttons and rows stay regular weight (400 or 500); bold captures too much optical attention (D73, D125).
2. **Never Scale Words on Press**: Label controls and worded buttons show a press on their background fill or tonal overlay, never by scaling text geometry down.
3. **No Layout Shift**: Controls must never jump or change geometry when state toggles.
4. **Strict Token Colors**: All control backgrounds, active layers, and ink colors must resolve to semantic color tokens (`--color-surface-*`, `--color-accent-*`, `--color-on-surface-*`). A hex or `rgb()` literal in a source file fails `npm run design-check`.
5. **Phone Sheets over Popovers**: Under 40rem, lists and menus open as bottom sheets, never popovers (D167, Ledger section 11).
6. **First-Load JS Ceiling (130 KB)**: First-load JavaScript has a 130 KB gzipped ceiling (`FIRST_LOAD_BUDGET_BYTES`, D141). React islands wake on interaction or playback via `client:wake` (D178). Never load unhydrated client runtimes into first paint.
