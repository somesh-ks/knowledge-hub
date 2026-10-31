# Sheet and Drawer

2026-10-30. D243 part D, Sheet, after #481 merged. Work is on #484.

## What happened

The sheet shell existed three ways: dead `dialog.sheet` rules in `foundations.css` (deleted first), the Base UI `.sheet-*` set, and the native `dialog.create-sheet`, which four other panels wore through a `regen-sheet` script hook. They became the Sheet (native) and the Drawer (Base UI), the Dialog got `dialog-title`, and the player's `.segmented` (dead since the tabs moved to `segmented-nav`) was deleted.

## Proof

Built markup of all 38 fixture pages is identical modulo class names and the new `data-sheet` attribute. `parity-sheet.cjs` in `/mnt/project-files/design-system/` opens every template sheet, menu sheet, Dialog and the Generate drawer at 390 and 1280, light and dark, and compares computed styles, boxes and `::backdrop`.

## Left

E (Row, Card) and F (Icon, Badge, Type roles): see `/mnt/project-files/design-system/handoff-e-f.md`.
