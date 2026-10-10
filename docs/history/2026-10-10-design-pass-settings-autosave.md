# 2026-10-10: Design pass, two-level Settings and autosave

One session, run as a design-engineering pass over every screen with four read-only auditors and four workers in worktrees. Current facts are in [state.md](../state.md); the decisions are D51 and D52.

## What changed and why
- Audit: four auditors (reader pages, Library and app chrome, player, Settings and Create) measured the frozen baseline in Chromium at phone and desktop sizes, light and dark, and returned 98 findings with file and line. Each finding was verified in the browser before it was handed to a worker.
- Dropdowns: the owner asked for every dropdown to look like the Anthropic model list. Every select now opens that drawn list through `appearance: base-select`, set in one place; the model field reads as a select (hand cursor, caret once focused, a press opens the whole list).
- Settings (D51): the owner called the podcast settings complex and asked for breadcrumbs and autosave. Settings is two levels with one job per page, the title carries the way back, and changes save themselves with a short settle, one request per batch, Undo for removals and the app's toast for status.
- Mobile (D52): the floating Create button shows only on Today and the Library; pressing the current tab scrolls it to the top.
- Workers fixed the reader pages (label-in-name on source links, sticky tabs hiding focus, the contents mark at the end of a page, the app bar's scroll line), the Library and chrome (the 320px overflow behind the failing layout test, toasts over the Create button, press scaling on labels), the player (the speed panel's tap-through, the transcript's last turn under the bar, any speed kept) and the Create panel (busy Generate, the sticky foot's hairline, full-width single voice).

## What went wrong
- Three of four worker worktrees started from the stale local `main`; caught by a worker, fixed with a fast-forward merge.
- Autosave re-sent a removal in a loop until a test counted the requests.
- An autosave test assumed four quick changes always go in one request, which a loaded machine does not keep.

## Left for the owner
- Field borders stay hairlines (1.3:1); the auditors disagreed on whether WCAG 1.4.11 needs 3:1 there. `--field-border` exists for that choice.
- Muting Previous and Next in the player was proposed and not done.
