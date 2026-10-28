# Control Archetypes Guide

Standardized control reference for Singularity. When adding or modifying interactive controls (buttons, chips, tabs, switches), select directly from this catalog. Creating bespoke button classes is strictly forbidden unless formally added to `BESPOKE_CONTROLS` in `styles.test.ts` with an approved decision rationale.

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
* **Rules**: Always requires an `aria-label`. Minimum 44px touch bounding box. `.press` handles active scale/fill.

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

---

## 3. Bespoke Controls Inventory

The following 12 bespoke controls are the only non-standard controls permitted in `styles.test.ts`. Each exists for a documented architectural reason:
1. `create-fab`: Floating create button with custom sheet origin.
2. `play-fab`: Circular floating play button overlaid on story artwork.
3. `add-fab`: Topics panel floating add button.
4. `view-btn`: Library gallery/list two-segment icon toggle.
5. `dock-btn`: Mini-player dock icon actions sized to the bottom bar.
6. `dock-open`: Persistent dock button expanding the full player surface.
7. `transport-btn`: Core audio playback transport on player scale.
8. `transport-skip`: Player skip forward / backward variant.
9. `speed-btn`: Playback speed popover trigger.
10. `speed-preset`: Speed option inside popover panel.
11. `source-plus-btn`: Sources list inline add control.
12. `source-edit`: Text action link on source row.

---

## 4. Universal Design Rules

1. **No Bold Labels**: Labels on buttons and rows stay regular weight (400 or 500); bold captures too much optical attention (D73, D125).
2. **Never Scale Words on Press**: Label controls and worded buttons show a press on their background fill or tonal overlay, never by scaling text geometry down.
3. **No Layout Shift**: Controls must never jump or change geometry when state toggles.
4. **Strict Token Colors**: All control backgrounds, active layers, and ink colors must resolve to semantic color tokens (`--color-surface-*`, `--color-accent-*`, `--color-text-*`). Raw hex codes or un-tokenized lengths fail CI immediately.

