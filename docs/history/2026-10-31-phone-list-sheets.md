# 2026-10-31: one bottom sheet for a select's list on a phone (D265)

The owner found the Daily and Weekly hour list on a phone "a very weird bottom sheet with the highlights", with rows too close, and asked for one kind of bottom sheet everywhere, at design-system level.

- Cause: D167 drew the browser's own select list as a sheet with CSS (`::picker(select)`). The browser's option fill is a shade off the sheet in dark, so every row looked like a button, and a list the browser draws cannot hold a title or Close.
- Change (#500): `design-system/selectSheet.ts` stops the native list below 40rem and opens the Menu's sheet with the field's label as its title; `--size-option` (48px) is the row of the select, picker and menu sheets; a menu sheet stops at 70% of the screen and scrolls under its head.
- Checked: 390px screenshots before and after in `/mnt/project-files/design-system/option-sheet/`; the site browser suite (421 tests) and a new journey in `podcast.spec.ts`. Not checked on a real phone: whether a given browser opens its own list despite the stop on `mousedown` and `click`.
- Left: the searchable picker (time zone, voice) keeps its own sheet with a search box; the multi-select stays an anchored popover.
