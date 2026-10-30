# 2026-10-29: one version of each shared component

The owner asked whether the design system's components could be consolidated ("so many variations and duplicates"). Buttons were already on their way (D237). This is the inventory of the rest and the plan, [D243](../decisions/design-system.md).

## What the scan found

A scan of every selector in `apps/*/src/styles` (730 classes) against every markup and script file, then the real CSS rendered side by side at 390px.

- **60 classes no markup uses.** The old manage rows (20), the unused Base UI switch, range and hint card in `sheets.css` (15), four player leftovers, and ten `text-*` type roles with `scroll-area`, `pad-safe-*`, `stagger` and `is-loading` in `foundations.css`. PR A removes 45 of them; the 15 foundations utilities stay for PR F to give users.
- **Thirteen families drawn more than once:**

| Family | Copies today | Becomes |
| --- | --- | --- |
| Switch | `settings-switch`, `switch` (unused) | Switch |
| Slider | `settings-range`, `speed-slider`, `dock-volume-level`, `dock-seek` | Slider |
| Field | `sheet-input` = `manage-input`; `search-field`, `sort-field`, four selects (`picker`, `multiselect`, `create-select`, native) | Field, Search field, Select |
| Menu | `hero-menu-list`, `menu-sheet`, `multiselect-list`, `picker-pop`; two option rows | Menu, Option |
| Notice | `banner`, `player-notice`; three field-error lines | Banner, Field error |
| Segmented | `segmented-nav`, `segmented-choice`, `segmented` | Segmented control |
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

He went away after "fire away". Made on his behalf, each reversible: the darker slider track; the 32px corner for source and score cards; the filled segmented control; the player notice as a banner.

## Not verified

Classes built from strings at run time (none found by search); the open states of every sheet and menu are not in the page-level comparison, so each family PR screenshots them.
