# 2026-10-10: Design pass, two-level Settings and autosave

One session, run as a design-engineering pass over every screen: two rounds of four read-only auditors, and workers in worktrees for the fixes. Current facts are in [state.md](../state.md); the decisions are D51 to D54.

## What changed and why
- Audit: four auditors (reader pages, Library and app chrome, player, Settings and Create) measured the frozen baseline in Chromium at phone and desktop sizes, light and dark, and returned 98 findings with file and line. Each finding was verified in the browser before it was handed to a worker.
- Dropdowns: the owner asked for every dropdown to look like the Anthropic model list. Every select now opens that drawn list through `appearance: base-select`, set in one place; the model field reads as a select (hand cursor, caret once focused, a press opens the whole list).
- Settings (D51): the owner called the podcast settings complex and asked for breadcrumbs and autosave. Settings is two levels with one job per page, the title carries the way back, and changes save themselves with a short settle, one request per batch, Undo for removals and the app's toast for status.
- Mobile (D52): the floating Create button shows only on Today and the Library; pressing the current tab scrolls it to the top.
- Workers fixed the reader pages (label-in-name on source links, sticky tabs hiding focus, the contents mark at the end of a page, the app bar's scroll line), the Library and chrome (the 320px overflow behind the failing layout test, toasts over the Create button, press scaling on labels), the player (the speed panel's tap-through, the transcript's last turn under the bar, any speed kept) and the Create panel (busy Generate, the sticky foot's hairline, full-width single voice).
- Second audit: once everything was merged, four fresh auditors found 59 more (Settings 15, reader 14, player 15, Library, Create and chrome 15). The worst: the saving toast covered the control just changed; section tabs filled history so Back took six presses to leave a briefing; on desktop "Back to now" sat under the bar so a click seeked; Back left the page instead of closing the player; Enter in Create's Title (the phone's Done key) started a paid run. 58 were fixed then, and the last (the latest briefing at its dated address) once the owner left the open decisions to the pass. A verifier then re-measured the player fixes and caught two that had not held (the seek strip still reached over the page; played and unplayed too close in light mode), fixed with the strip inside the bar and a notch at the playhead.
- Owner notes during the pass: the plus and the More dots read too thin (now Phosphor bold, and three drawn circles of radius 20); the first-load budget may be 110 KB but should stay low (D53, with the measured split and what could still come off in first-load-js.md).

## What went wrong
- Three of four worker worktrees started from the stale local `main`; caught by a worker, fixed with a fast-forward merge.
- Autosave re-sent a removal in a loop until a test counted the requests.
- An autosave test assumed four quick changes always go in one request, which a loaded machine does not keep.
- Two workers hit their 60-turn limit mid-brief, one worker's commit trailers landed on the subject line, and one worker's cleanup killed every test server on the machine; see learnings.md.
- A first fix for the player's track contrast passed review in code and failed in the browser; only a measuring verifier caught it.

## Left for the owner
- The owner then left the open decisions to the pass: fields got a 3:1 outline and Previous and Next the skips' muted ink (D54); the latest briefing at its dated address counts as Today (D52); React keeps loading on idle, because on-demand would slow the first Play (D53).
- The flaky flick tests were the harness, not the gestures: the test finger now states each event's time, and a mouse drag arrives as the small moves a real mouse reports.
- Not done here: a real iPhone, and Safari 27 (WebKit is not installed in this container).
