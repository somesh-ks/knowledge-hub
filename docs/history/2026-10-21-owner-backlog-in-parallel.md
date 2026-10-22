# 2026-10-21: the owner's backlog, built in parallel

Reasons: D126 to D130. Current behaviour: the player, library, settings, narration and navigation specs.

## What was asked

One long list from the owner: a chevron to close the player and Space to play and pause; the YouTube Music queue (Up next); a menu on every Library row with downloads for offline listening; episodes narrated ahead of the first Play; a Settings restructure (one voice pair, one global type mix, Sources and Preferences, Theme as a select, no breadcrumbs, no Weekly switch, Catch up as the name for on-request episodes); no Kimi models and a model list that tracks a benchmark.

## How it was split

Parallel workers, each in its own worktree on a branch from `integration`, each with a list of files it may touch and a budget of about 90 tool calls: player, Library menu and downloads with the service worker, engine pre-narration, settings pages, sources page, models, and this docs worker. A lead merged the branches into `integration` and ran the gate. One worktree started from an older base and had to be reset onto `integration` before anything was written. Workers that reached the cap without finishing were re-briefed with a smaller piece.

## What review caught

- The topics tab strip widened the page, and Chrome zoomed out: the grid column needed `minmax(0, 1fr)`.
- The Add source panel's rows were cramped; fixing them one by one led to the 8pt spacing system (its own decision).
- Space reopened the three-dots menu, because the menu took focus back when it closed from a tap elsewhere.

Final review of the combined branch, before the PR:
- A queued item dropped off the queue when its page was merely opened (the page loads it idle); it now leaves only when it plays. A player journey shows it red without the fix.
- The service worker had put itself in front of every audio read and narrate lookup to serve downloads; it now steps in only for downloaded addresses (held in memory) or offline. The 19 player journeys this broke were the alarm: their page-level mocks stopped seeing requests.
- The Library used `checkVisibility` (Safari 17.4 and later only); `secrets:push` never sent the second voice; the voice page hid that Weekly keeps its old voice until a shared pair is chosen.
- Two workers began from main instead of the integration branch (the spacing pass among them); the design checks then listed exactly the stylesheets the stale base had missed. The 8pt pass also made source rows 104px and pushed the two-column player 4px past a 1024x768 window; both fixed.
- The topic delete confirm moved into the lazy editor: the review fixes had put the settings and topic pages 7 bytes over the 109 KB first-load budget (now 108.9 KB, 92 bytes spare).

CI on the PR:
- A downloaded briefing offline missed its themed covers: Download saved only the plain pair, and the page and player draw `/covers/light|dark/`. It passed here because Playwright's offline did not reach the worker's own fetches in this container (an uncached cover still came back 200); CI's Chromium did. The test now empties the media cache and aborts cover requests through `context.route`.

## Unverified

- Download and offline Play on a real phone, against the Blob host's CORS.
- Queue drag and pull gestures on a real phone.
- Episode pre-narration's first live run, after the `podcast.yml` change (a separate PR the owner merges by hand) lands. Owner action: set the GitHub variable `SPEECHIFY_VOICE_ID_B` to match Vercel's.
- `?view=preferences` may flash Sources on load.
- The weekly model check (Mondays 08:52 Europe/Stockholm) was created without connectors; its first run shows whether it can browse and open PRs.

## Parked

Open items moved here from `state.md` to keep it within its budget, unchanged. Each still stands until its condition holds.

- Unit flake: the sound peak check failed once. closed when: 10 gates in a row pass.
- P3 polish from critic rounds 5 to 9 is in `git show 91bc533:docs/state.md`. closed when: the owner picks which to fix.
- From the 2026-10-08 QA sweep: a refused narration (429) shows no wait time; focus on opening the player is unchecked. closed when: the 429 names its wait and a keyboard test opens the player with focus inside.
- Costs and sizes reasoned, not measured: 150 to 400 extra Jev requests a run for the general feeds (against 165 on 2026-10-09), and the episode script's part sizes (D66 to D68). closed when: a run log reports the judge's request count with general topics on.
- Settings switches show the track colour until the script is ready; the 6 and 7 October audio says "Dispatch". closed when: the owner rules on each.
