# 2026-10-12 (evening): the owner's list after #93

The owner used the merged site and sent one list: interface sounds not working everywhere, the About text gone, a cramped New episode panel, the audience control wanted first with no label, Dry tone removed, the voice list empty in the form and not complete in Settings with no preview in the form, "narration is not available", the Model field in the wrong place with its id showing, a time zone list with a search field and its GMT offset, topics missing on Daily and Weekly, the New episode button not the nav items' size, the Contents list fixed on the page's middle, the bar's controls kept as before on a wide screen, the Stories and Transcript tabs "that I have told you multiple times", the speed between the two skips, and a card's title that changes colour so it is told from the art. Then a goal: use sk-design-engineering to tidy the loose ends.

## How it was done

- Four read-only scouts first (sounds, settings, player, form). Two ran out of turns without a report and the lead read that code itself. One worker took the sounds alone, in files nobody else touched; the lead reviewed its diff and cut one of its additions (a success chime on every autosave).
- The repository's own history said what "as before" meant: the pre-#93 transport (the bar keeps previous, play, next and the clock; the page shows the two skips with the speed between them) and the pre-#93 tabs (Chapters and Transcript for an episode). D92 had moved all five controls to the page; D101 returns the split.
- The live site was probed with read-only requests: the narration lookup, the voice list (125 voices) and a sample answer, and a malformed narration request is refused as invalid, so narration is configured. That puts the "not available" in the synthesis step, which needs the function log.
- A static design-engineering audit of the new surfaces (a reviewer on the skill's signals) found nine items; the high and medium ones were fixed: focus lost when the page's play control is hidden, the speed's Tab order outside Chromium, a flash of the wrong tab, locked chips at 1.5:1, forced-colours edges on the picker, a list left behind by a scroll, and a screen reader's touch not landing in the list.
- Checks: typecheck, Biome, the unit suite (243 files), the site browser suite and the player browser suite, each run again after the failures were fixed (the failures were the specs of the old layout, two new sound specs a worker had not run, and three bugs of the lead's own: the list closed by its own scroll, a 1px hidden select, a text transition under axe).

## What it shows

- The picker is a progressive enhancement of a select, so the saved-settings overlay, the autosave diff and every test that reads a select kept working; only the tests that operated the list needed a helper (`e2e/picker.ts`).
- The first-load budget is nearly spent (0.3 KB). Everything added is in lazy chunks (the picker, the voice samples, the page content), and one hook in the lazy half orders the transport.
