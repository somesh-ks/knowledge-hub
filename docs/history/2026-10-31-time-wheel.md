# 2026-10-31: the hour select opens as a wheel (D269)

After D265 put every phone select in the standard sheet, the owner asked for the iPhone's rotating cylinder for the time, in the same sheet. An Android clock dial was asked about first and dropped: it is the browser's own dialog, shows minutes the schedule does not store, and would be the one exception to the sheet.

- Change: `design-system/wheel.ts` and `styles/wheel.css` (a scroll-snap list whose rows tilt, pack and fade by their distance from a fixed band, driven by `--wheel-d`); `selectSheet.ts` draws it for a select with `data-wheel`; the Daily and Weekly time carry it. Menu's own stylesheet gives a wheel sheet a lower end.
- Checked: tap, drag, arrow keys and an outside tap at 390px with emulated touch; the journey in `podcast.spec.ts` now sets a length by row and the hour by wheel and sees both saved; light and dark stills and a drag recording in `/mnt/project-files/design-system/wheel/`. Not checked on a real iPhone or Android: the scroll feel and the snap.
- Left: a haptic tick on each row (`wheeldetent` is the hook; the haptic tokens are another thread's); the searchable picker keeps its own sheet.
