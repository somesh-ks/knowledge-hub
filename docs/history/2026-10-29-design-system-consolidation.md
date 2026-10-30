# 2026-10-29: one version of each shared component

The owner asked whether the design system's components could be consolidated ("so many variations and duplicates"). Buttons were already on their way (D237). This is the inventory of the rest and the plan, [D243](../decisions/design-system.md).

## What the scan found

A scan of every selector in `apps/*/src/styles` (730 classes) against every markup and script file, then the real CSS rendered side by side at 390px.

- **60 classes no markup uses.** The old manage rows (20), the unused Base UI switch, range and hint card in `sheets.css` (15), four player leftovers, and ten `text-*` type roles with `scroll-area`, `pad-safe-*`, `stagger` and `is-loading` in `foundations.css`. PR A removes 43. The 15 foundations utilities stay for PR F to give users, and `filter-chips-scroll` and `meta-wrap` stay for the system PRs: `primitives.css` is a system file, and a system file's change travels in a labeled design-system PR (D237).
- **Thirteen families drawn more than once:**

| Family | Copies today | Becomes |
| --- | --- | --- |
| Switch | `settings-switch`, `switch` (unused) | Switch |
| Slider | `settings-range`, `speed-slider`, `dock-volume-level`, `dock-seek` | Slider |
| Field | `sheet-input` = `manage-input`; `search-field`, `sort-field`, four selects (`picker`, `multiselect`, `create-select`, native) | Field, Search field, Select |
| Menu | `hero-menu-list`, `menu-sheet`, `multiselect-list`, `picker-pop`; two option rows | Menu, Option |
| Notice | `banner`, `player-notice`; three field-error lines | Banner, Field error |
| Segmented | `segmented-nav`, `segmented-choice` (both deliberate: filled to navigate, outlined to pick a value), `segmented` (a third copy of the filled one) | Two kinds stay; `segmented` folds into `segmented-nav` |
| Sheet and dialog | `create-sheet`, `confirm-dialog`, `share-dialog`, the speed dialog, the React drawer | Sheet, Dialog |
| Row | `row-action`, `settings-row`, `source-row`, `story-row`, `player-upnext-row`, `player-queue-row`, `queue-row` | List row |
| Card | `card-group`, `topic-card` (32px corner), `source-card`, `score-card` (16px) | Card |
| Progress | `costs-meter`, `part-meter`, `card-progress`, `dock-progress`, `scrubber-fill`, `queue-ring` | Progress bar, Progress ring |
| Icon | `icon`, `ui-icon`; `icon-lg` twice | Icon |
| Badge | `card-downloaded`, `flag-badge`, `admin-tag`, `status-dot` | Badge, Status dot |
| Titles | `page-title`, `costs-total`, `health-answer`, `sheet-title`, `section-head`, and the unused `text-*` roles | Type roles |

## Plan

Six design-system PRs, each with 390 and 1280 screenshots in light and dark and a computed-style comparison of every page (the proof D237 used). A deletes the unused classes. B to F wait for #434's registry.

## Calls made for the owner

He went away after "fire away". Made on his behalf, each reversible: the darker slider track; the 32px corner for source and score cards; the player notice as a banner. The owner's reply (2026-10-30): the two segmented kinds are deliberate and stay; the rest can take expressive Material styling as it consolidates.

## Field (C, part 1)

`design-system/Field.astro` draws the text input, textarea and select: one class, `field-input`, replacing `manage-input` (32 call sites) and `sheet-input` (3). Its rules moved from `manage.css` and `sheets.css` into `field.css`. Computed styles of every field on 13 pages, at 390 and 1280, light and dark, rest, hover and focus, before and after: 0 differences (64 fields, 196 state checks).

Calls made for the owner: a disabled field dims like a disabled switch (`--opacity-disabled`) instead of the Generate sheet's lighter border and ink, because a disabled fieldset already dims its fields and the two looks would stack. The Generate sheet's textarea and Regenerate's now grow with their text from the shared 6rem minimum, as every other textarea does. The 28 page rules that bend a field (Create's filled title, the Settings select, the Topics panel) are listed in `PAGE_OVERRIDES` as debt; they were invisible to D253's test until the field became a component. Select and Menu follow in the same pull request.

## Select and Menu (C, parts 2 and 3)

`design-system/Select.astro` draws the select and its chevron in two variants: outlined (a value in a form; the Field's looks on a pill) and tonal (a sort or a filter chip, with `data-active` when its value is not the default). It replaces `manage-select` (14 sites), `sort-field` (6, in the reader, admin and design apps) and `create-select`; the wrapper's rules and the one open list moved from `manage.css`, `create.css`, `costs.css` and `primitives.css` into `select.css`. Scripts find a select with `closest("[data-select]")`. `value-select` (a select as a settings row's value) stays a page modifier in `settings.css` until Row becomes a component.

`design-system/Menu.astro` and `MenuItem.astro` draw the popover list and its rows: `hero-menu-list`, `hero-menu-item` and `hero-menu-delete` become `menu-list`, `menu-item` and `menu-item-danger`, with `menuListClass()` and `menuItemClass()` for islands and string builders and `MENU_SELECTORS` for scripts. The rules moved from `hero.css` into `menu.css`; `MenuSheet.astro` is gone. The picker's and the multi-select's option rows are not folded in yet: they are built by script with their own keys.

Proof: computed styles of every select (wrapper, native select, chevron, picker button) at rest, hover and focus on 13 pages at 390 and 1280, light and dark: 64 selects, 238 checks, no difference outside Create. Every popover menu forced open (156, 312 checks): no difference. The open lists of a sort and a settings select are pixel-identical.

Calls made for the owner: Create's voice select is outlined, not tonal. Filled with the container tone it sat on the More options card's own tone and showed no edge, only its chevron. The 12 page rules that place a menu (a Library card's, the Queue's, a story's, the emoji picker's, a structure row's) are listed as debt, as the Field's were.

## Not verified

Classes built from strings at run time (none found by search); the open states of every sheet and menu are not in the page-level comparison, so each family PR screenshots them.
