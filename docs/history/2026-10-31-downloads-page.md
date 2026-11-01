# 2026-10-31: Settings > Downloads (D281)

The owner asked for a place in Settings to manage downloads: delete one or all, search, and "don't keep any cap". A first draft (plain rows with an X) was dropped for the Library's List-view rows: album art, title, details, hover Play on a mouse, a ⋮ menu.

- Cause of the shape: which podcasts are saved is known only in Cache Storage, so the page carries every Library card and `downloadsPage.ts` marks the saved ones; the Library's own `data-downloaded` mark and `libraryMenu.ts` do the rest.
- Change: `pages/settings/downloads.astro`, `scripts/downloadsPage.ts`, `styles/downloads.css`; `LibraryItemMenu` takes `downloads` (Add to queue, Share, Remove download); the 10-download cap and its eviction are gone from `lib/downloads.ts` and `libraryDownloads.ts`.
- Calls made for the owner (coordinator, on his delegation): the ⋮ is drawn on a phone here although the Library hides it (D264); search shows from 8 downloads; the unit test of the oldest download's eviction was deleted with the cap.
- Checked: 390 and 1280 screenshots in light and dark; a journey in `libraryMenu.spec.ts` (download, find, cancel, remove after the confirm, gone after a reload) on the phone project. Not checked: the desktop project in CI, a real phone, offline use of the page itself (it is not in the offline shell).
- Left: play in place from a row waits for `playQueueItem` (#519) and the phone play button; an orphan download is not listed.
