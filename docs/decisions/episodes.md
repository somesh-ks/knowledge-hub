# Decisions: episodes

What an episode or briefing is: kinds and structure, length, regenerate, Catch up, runs and the run card. Rules and the Index are in [README.md](README.md).

## D7: Podcast feed deferred

- Date: 2026-10-05
- Status: Not now
- Decision: No private podcast feed (`/feed.xml`) in v1.
- Reason: The web player is the product. A feed adds a delivery surface to maintain before the web path has been tested.
- Rejected: Shipping the feed at launch.
- Revisit if: iOS lock-screen playback proves flaky in the spike. Podcast apps are the most reliable background path on iOS, so the feed is the first fallback.

## D8: "Thought of the Day" cut

- Date: 2026-10-05
- Status: Cut
- Decision: The digest has no "Taste & Thought of the Day" section.
- Reason: It breaks the brevity bar. Everything in a digest is an item the reader can use.
- Rejected: Keeping it as a short closing line.

## D37: Custom podcast episodes live in `Podcasts/` and are built by a workflow

- Date: 2026-10-08
- Decision: The Create page posts a request (topics, length of 3 to 15 minutes, format: readout, discussion or headlines, look-back window, tone) to `/api/podcast`, which dispatches `podcast.yml`. `dispatch podcast` selects stories from published briefings in the window, has the writer produce a script of turns, checks every number against the stories, and commits `Podcasts/YYYY/MM/<id>.md`. Episodes appear in the Library and play through D33, one segment per turn, with a second voice for the second host (`SPEECHIFY_VOICE_ID_B`).
- Why: a function is too short-lived to write a script, and reusing judged, summarized stories makes an episode cost one writer call.
- Rejected: storing episodes as digests (a digest needs three items and a date id); a fresh fetch and judge per episode in the first version.
- Limits: 2 episodes a day, a 30 minute cooldown, 15,000 characters per episode.
- Status: unverified live.

## D44: An episode can be deleted, or regenerated with the listener's feedback

- Date: 2026-10-08
- Decision: `podcast.yml` still passes one JSON input to `dispatch podcast --request`; it is now a new episode (no `action`), `{"action":"delete","id"}` or `{"action":"regenerate","id","feedback"}` (`PodcastCommand` in core; feedback 1 to 500 characters, control characters become spaces). Delete removes `Podcasts/YYYY/MM/<id>.md` and commits `chore(podcast): remove <id>` through the existing `podcast` allowlist (`Podcasts/` only, unchanged). Regenerate reuses the stored request of the old file, writes a new episode with a new id, removes the old file after generation succeeds, and commits both in one `feat(podcast): replace <old> with <new>`. The feedback reaches the writer as an optional `ScriptInput.feedback`, rendered in the user message inside the untrusted-text wrapper and never overriding the rules about facts and numbers. The new file records `replaces` and `feedback` (optional, so old files parse). `--dry-run` generates or reports and removes nothing.
- Why: the owner wanted to delete an episode after it is made, and to regenerate it with extra feedback when the content is not right.
- Cost: a regeneration is a full writer run. A failed one leaves the old episode in place.
- Rejected: editing an episode in place (script, audio and checks are made together); keeping the old episode beside the new one.

## D45: The briefing's hour, cadence and topics are set in Settings

- Date: 2026-10-08
- Decision: the hour (Stockholm), the cadence (1, 2, 3 or 7 days) and the covered sections of the scheduled briefing live in `config/schedule.json`, written by the `schedule.set` config op from Settings, Schedule. A missing file means 07:00, every second day, every enabled topic. `run.yml` carries one schedule entry per hour, and its job runs only for the entry that equals the repository variable `RUN_CRON`, which the site sets when the hour is saved.
- Why: the owner asked to choose when the briefing is made and what it covers, from the app. The repository is private, so an hourly job that gates itself would bill up to 744 minutes a month; a job skipped by its `if` starts no runner and costs nothing.
- Cost: the hour lives in two places (the file for display, the variable for the trigger). If the variable cannot be written the page says so and the rest is still saved. GitHub can still fire a schedule hours late.
- Owner: add "Variables: Read and write" to the site's GitHub token, and merge the workflow change by hand.
- Rejected: an hourly job with a gate (minutes); Vercel Cron (once a day on the Hobby plan, static, imprecise); letting the app edit the workflow file (the token cannot change workflows).

## D65: The weekly podcast takes its day; the daily cadence counts from it

- Date: 2026-10-11
- Decision: While the weekly podcast is on, its day (Stockholm date) has no scheduled briefing: the gate (`decideRun`) answers "today is the weekly podcast's day; no briefing" whatever the cadence says, and the weekly pass runs from its hour as before. The daily cadence counts from the later of the last regular run (published or nothing) and the last weekly pass that published, so the briefing after a weekly podcast keeps the cadence's spacing. A forced or on-demand run still makes a briefing on that day. The cron route starts nothing at the daily hour on the weekly day. The Daily page's next-briefing estimate follows the same rule, and its When hint names the day ("Stockholm time, none on Sundays").
- Why: the owner asked that a collision on the weekly day go to the weekly podcast, and chose the cadence counting from it over the briefing coming back the next day. The weekly pass fetches its own seven-day window, so it loses nothing without the day's briefing, and it no longer has the day's best stories claimed by a briefing published minutes earlier.
- Cost: with every second day and a Sunday weekly, the week settles into Tuesday, Thursday and Saturday briefings plus the Sunday weekly. A weekly pass that fails leaves its day with nothing, and the next briefing comes the day after. A weekly pass that found nothing does not count, so the briefing comes the next day.
- Rejected: the briefing the next day (a briefing the morning after the weekly repeats its news); a skipped briefing recorded as its own outcome in `state/last-run.json` (a state schema change for what the weekly record already says).

## D67: Create shows one list of topic chips; the audience presets them; an episode can mix briefing and general topics

- Date: 2026-10-11
- Decision: The Create panel (page and sheet) shows one chip list for both audiences: Design, AI, Technology, World, Business, Science, Culture, Sports, then the owner's own topics. Design sends the briefing sections `design` and `ui-craft`, AI sends `ai`, Technology sends `tech` (the owner's own sources); the rest send their general topic ids. Written for no longer hides chips: switching it replaces the selection with that audience's preset (Somesh: Design, AI, Technology; General: World, Business, Technology, Science, Culture, Sports), and the page starts with Somesh's. The audience still sets how the script is written. The engine splits a request's ids into briefing ids (read from published digests, Top picks always included) and general ids (read from news feeds), shares the episode's story count between the two in proportion to their topics (at least one each), hands unused room to the other, and alternates them strongest first. One side finding nothing is a warning; both is an error. Core no longer refuses a general request with briefing ids. Trending and the general Technology desk are not chips; a stored `technology` reads as `tech`.
- Why: the owner asked for Design, AI and Technology as Somesh's topics "to keep things lean", for Design, AI and Technology to be available in General mode from the sources they chose, and for the selector to change the selection while showing every chip.
- Cost: eight chips where there were five or six. A mixed episode reads digests and feeds, and its two halves were ranked differently (judge scores, outlet coverage), so the alternation is a fair share, not one ranking.
- Rejected: hiding the other audience's chips (the owner wants every chip visible); one chip per briefing section (Design Engineering on its own made the list longer than the owner's three).
- Supersedes: D39's per-audience topic lists and D43's rule that a general episode takes only general ids.

## D68: An episode opens with a rundown, deep-dives its lead stories, gives the rest as nuggets and closes short

- Date: 2026-10-11
- Decision: Readout and discussion scripts follow one order: a one-line hello; a rundown that names the first stories in a clause each (3 at 3 minutes, 4 at 5 and 10, 5 at 15); deep dives on the lead stories (none at 3 minutes, 1 at 5, 2 at 10 and 3 with ten or more stories, 3 at 15 and 4 with fourteen or more), each what happened, why it matters and one concrete detail; the rest as news nuggets of a sentence or two; a short close (about 120, 250, 400 and 600 characters) of one or two questions or implications drawn only from the stories, or reactions a story block itself reports, never an invented opinion; a one-line sign-off. Stories arrive ranked, so the lead stories are the strongest. The frame (hello, rundown, close, sign-off) is sized per length instead of one constant, and the writer is given word counts per part. Headlines keeps its old shape.
- Why: the owner asked for quick teasers of what is in the episode, deep dives into the important stories, and a short thought-provoking close, "focus on the news nuggets".
- Cost: the part sizes are estimates, not measured on real runs, and more stories fit in a length than before (a 15-minute readout carries up to 35, was 31). The close can only pass on what people are saying when a story block quotes it; nothing reads discussion from elsewhere.
- Rejected: a close built from what people say online (no such source is read, and the writer would invent it).

## D76: Create is the New episode form: three questions first, the defaults under More options

- Date: 2026-10-12
- Decision: The side column's button, the floating button, the panel and the page that start a podcast are all called New episode, and the button inside reads "Generate • N mins" (the owner's wording). Topics, Length and Format are the questions. Written for, Voice (Voices for a discussion), Look back, Tone and Title wait under More options, whose line says what they are set to; the wide /create page holds them open. Choices are tonal segments that hug their content. A discussion's voices are labelled with the hosts the episode will be written with (`hostNamesFor`); a readout names no one. The button says "Starting..." beside a spinner while the request is in flight. The sheet takes the page's own surface and pins its button to the foot, over a hairline that fades in. `/create` sits under the Library: Back leads there and Library is the current tab at every width.
- Why: the owner called the boxed form "ai slop". It asked seven questions of equal weight, and three decide the episode; the rest have defaults that were right for most requests.
- Cost: changing a voice or the tone takes one more press; a request made from the defaults shows only the line that names them.
- Rejected: a wizard (one more step than the form); hiding the defaults with no summary line (the owner could not tell what a request would use).

## D80: An episode is written to 95% of what its stories can carry, and a script a little under the floor is kept

- Date: 2026-10-12
- Decision: The writer is asked for 0.95 of the reachable length (it was 0.9); the floor stays 0.8. A reply at 95% of the floor or more is kept on any attempt and logged ("Kept a script a little under the floor"); only a shorter one is requested again. A returned story id is matched when a known id sits anywhere inside it (when only one does), and each story block puts `item_id:` on its own line, so a copied boundary marker no longer sinks a rewrite. A request's timeout is 60 s plus 25 ms for every token over 1,500, capped at 240 s (a 15 minute script gets about 183 s; Anthropic never gets under 120 s); a retry starts only if two timeouts still fit; no script attempt starts after 8 minutes. The number rewrites of a script run four at a time and are applied in script order. A failover warning gives the status, error class and a kind (authentication, model not found, rate limited) and never the provider's message. A source preview fetches each address once and the favicon beside the page.
- Why: the first script came back at 79 to 87% of the reachable length against an 80% floor, so most episodes were written twice (25 to 36 s each time). The writer is almost all of the 58 to 87 s a podcast step takes.
- Cost: a script can end up to 5% under the floor; `fitToBudget` still drops whole stories from the end when a script is over, which asking for 95% leaves room for. Measured only with fakes; the saving is expected on most episodes, not yet seen on a real run.
- Rejected: asking for 100% (a script over budget loses a story); expanding only the thin stories (a larger change, left for later).

## D84: A failed run keeps its request and offers Try again; a finished run clears itself; one run at a time

- Date: 2026-10-12
- Decision: The run indicator keeps the request of an episode that failed and offers Try again, which sends it again and follows the new run. A refusal names its own wait (a 429) and a request that cannot go from the line (a 401, or no passphrase) reopens the form filled in. Opening the new episode, or having it on screen, clears "Episode ready" and gives back the room it held. While an episode is being made, New episode says so (to a screen reader) instead of sending a second request, and a regenerate hands the indicator its request too. The lines read "Episode queued", "Writing your episode", "Adding it to your Library", "Couldn't make the episode" and "Still being made. It will appear in your Library." A briefing keeps "Updating the site".
- Why: a failed run said "later" and left nothing to press, "Episode ready" stayed on every page until dismissed, and a second request could start while the first ran.
- Cost: the request is kept in the browser (session storage) until the run ends; New episode still opens its sheet while a run is going, and says why only to a screen reader; a regenerate's fallback reopens its panel on that episode's own page only.
- Rejected: retrying by itself (a failure that repeats would spend the day's limit); blocking the sheet while a run is going (the owner may want to read the form).

## D87: New episode says when a choice changed the topics and offers Undo; the Library searches with an excerpt around the match

- Date: 2026-10-12
- Decision:
  - Choosing Written for, when the topics have not been touched, swaps the ticked topics for that audience's set. The page now says so under Written for ("Topics set for General", a status region) with an Undo that restores the previous ticks; ticking a topic by hand removes the Undo. The audience keeps the owner's names, General and Somesh.
  - The line above Generate is drawn only while the bar is really stuck to the bottom (`data-stuck`), and from 80rem the bar is not sticky and has no line. On a wide page More options follows Generate in the source, so Tab goes down the columns, its pinned row is a heading and not a Tab stop, and the side New episode button on `/create` is the current place (`aria-current="page"`, nothing to press).
  - The Title is a filled field (the tonal container with a 3:1 line under it); every other text field keeps D54's outline. A discussion's voices are labelled with the hosts' names ("Ada's voice").
  - A Library search shows the match under the card's facts, cut to start just before the hit, with the query's words at weight 500, up to two lines, ending "and 1 more"; the kind and length stay visible. "Most stories" is gone from the sort, because an episode's card never shows a story count. "Played" takes the length's place in the facts line, and a half-heard bar sits over the cover's bottom edge, so a card's height does not depend on its state. Today's Earlier briefings shelf leaves out the story count so its line never wraps. One page-title size from 64rem (22px) on the Library, Settings and New episode; Today's date stays the display size.
  - The Library filters by kind with three single-select chips (Daily, Weekly, Episodes; none ticked means all) in place of the "All" select; the sort stays a value chip. On a phone the chips have their own row and scroll sideways if they must. A card narrower than 10.5rem leaves out the story count, so its facts line never wraps.
  - The search pill and an open filter or sort list change fill on a press and draw the ring only for the keyboard.
- Why: the critic measured a preset swapping six topics out of sight in the phone sheet (the chips 309px above the screen) and then sending them; a line drawn over nothing on a short page; a Tab order that jumped across the wide form; a search that showed 24 characters of a headline cut before the word searched for.
- Cost: the preset line is one more thing in More options; the Library's story count shows only on the card, not in a search.
- Rejected: moving Written for above the topics (it asks the question in the wrong order for the person who wants Design, AI and Technology); renaming General to Anyone (the owner named it, and it matches the general topics it selects).
- Amends: D76 (the form) and D78 (search).

## D104: A briefing can be regenerated in place or deleted

- Date: 2026-10-13
- Decision:
  - The briefing page's More menu is the episode's: Share, Regenerate, Delete, on the latest and on older Daily and Weekly pages (HeroMenu.astro, one component). Delete opens the episode confirm (EpisodeActions.astro, `noun="briefing"`). Regenerate still opens the Generate sheet, whose request now carries the page's digest id (`replace`), because the sheet already follows a briefing run; the episode rewrite panel and the run indicator stay the episode's. Library cards stay without a menu, as episode cards have none.
  - `dispatch run --replace <id>` (run.yml input `replace`): the gate plans one pass with the old digest's id, kind and date, over its window start to now, whatever the cadence says, and frees that digest's stories in `state/seen.json`. The commit stage removes the old digest and its narration timeline and writes the new digest under the same id in one `chore(digest): replace <id>` commit, only when the new one published (a replacement that finds nothing keeps the old). It records the on-demand slot (the status route reads it) and leaves the regular record and the fetch window alone. The old MP3 stays in the Blob store until the audio job uploads the new one over the same path.
  - `dispatch run --delete <id>` (run.yml input `delete`; the run is named "delete <id>"): removes the digest and its timeline in one `chore(digest): remove <id>` commit through the `run` write guard; no other step runs. `POST /api/generate` takes `{action:"delete", id}` or `{replace, feedback?}`, refuses an id the build does not list, applies the delete limits (10 s, 20 a day) to a delete and leaves delete runs out of the Regenerate cooldown. A device that deleted hides the briefing's Library card and page at once (the episode mechanism, ids from `/d/` too).
- Why: the owner asked that every kind of podcast can be shared, regenerated and deleted; D103's Regenerate made a new digest and left the old one.
- Cost: the narration MP3 of a deleted briefing stays in Blob until pruned; the latest briefing's Today page shows until the redeploy, as an episode does.
- Rejected: a second workflow for delete (run.yml already holds the write guard path and the concurrency group); a new id for the replacement (it breaks links and order).

## D109: Regenerate chooses the topics again and takes comments

- Date: 2026-10-14 (owner: "better control of either choosing the topics again, and have some comments"; #102)
- Decision: the Regenerate dialog of an episode and of a briefing has the app's topic chips, prefilled with what the original was made with (at least one stays chosen), over a Comments field. The choice applies to that regeneration only. An episode sends `topic_ids` through `podcast.yml`; a briefing sends `topics` only when it differs from the original's, as a `run.yml` input passed to `dispatch run --stage write --topics`. A briefing's choice filters at the write stage, so it can drop a topic but cannot add one the run did not fetch.
- Why: the owner's list asked for a weight slider in the dialog; asked whether it should override one run or save, the owner chose topics and comments instead.
- Rejected: weight sliders in the dialog (a one-run weight needs a run-level override; a saved one silently changes every later briefing).

## D114: Every episode is written for the owner; the New episode form is shorter

- Date: 2026-10-14 (the owner: "Remove, always Somesh"; "Add lookback after length"; #123)
- Decision: the General audience and the Written for control are gone; a hidden `audience` field always sends `custom`. Design, AI and Technology start ticked. The form is Title, Topics, Length, Look back; More options holds Format, Voice and Tone, and its line reads "{format} · {tone} tone".
- Why: the owner never chose General, and the preset with its Undo line was a step before every episode.
- Cost: a general-news episode is made by ticking the general topics by hand.
- Rejected: keeping General as a preset under More options.

## D119: spares keep a briefing at its length

- Date: 2026-10-15 (the owner's brief: "episodes ignore the length setting"; then "go crazy! I'd like to get high quality output")
- Decision:
  - A regular briefing with a length, and every weekly, selects `withSpares(wanted)` stories: the length's stories plus 30%, at most the hard maximum (`run/scheduleSize.ts`). All of them are extracted, written, voice-checked and grounded.
  - `selection.json` carries `length_chars`, the narration the length holds. Validation airs survivors until their measured tellings fill it, at most one story over and never short while spares remain; it leaves out first the lowest-scored story of a topic that has another, so each topic keeps its best. A briefing whose writer ran long is trimmed the same way. Unaired stories are recorded in `written.json` as `select` drops and in `validate-report.json` as `spares_unaired`.
  - A later pass of the same run may still take the spares; it loses at most the length's count of stories, as before.
  - The run artifact keeps `written.json` and `validate-report.json` for 30 days.
- Why: the 2026-10-15 daily chose 14 stories for five minutes and aired 4. Four were not written (Sonnet was failing and Qwen wrote) and grounding dropped six. Every drop after selection came off the length.
- Cost: about 30% more writer and grounding calls on a deep pool; none on a thin one, which has no spares to take.
- Rejected: a second write round after validation (the stages run as separate workflow steps, and validation has no selection logic); selecting the length alone and accepting the loss.
- Revisit if: `validate-report.json` shows spares unaired on most runs (lower the share) or drops beyond the spares (raise it, or fix the cause of the drops).

## D168: the primary action is Catch up, Latest is a bolt, and a toast swipes away

- Date: 2026-10-23 (the owner: "rename new episode to catch-up, change fire emoji for latest to zap emoji"; "I need to be able to swipe away snack bars or toasts on mobile")
- Decision: The action that makes an episode on request is called Catch up on the floating button, the side column, the sheet's title, the Create page and the Library's empty state, and in the manifest's shortcut: the name of the kind those episodes are filed under (the Library chip, Listen in), so the button names what it makes. Spelled "Catch up", the app's existing noun, not the owner's "catch-up". Latest's glyph is Phosphor's lightning, regular and fill; the flame is gone from the glyph set. A toast slides sideways under a finger and leaves past 35% of its width or at 0.6 px/ms (`Toaster.tsx`); a shorter drag springs it back. A swipe dismisses, it never undoes: a removal's wait still ends in the removal. A mouse does not drag it, and a press on its buttons is theirs.
- Why: "New episode" named the mechanism; the Library already called the result Catch up. A phone's snackbar is swiped away everywhere else, and the toast's close button shows only while an action is offered.
- Cost: four browser tests and four specs renamed; a reader who learnt "New episode" finds Catch up in its place.
- Amends: D52 (the floating button's word).

## D170: a modular podcast structure, accepted

- Date: 2026-10-23 (the owner: "there must be a segmented selector, one for source types, another for podcast structure (making it modular, able to add and delete new sections)... The scope is set for all kinds of podcasts. Evolve this idea to address all gaps before building it")
- Status: accepted, not built. [The design](../design/podcast-structure.md) answers the ask: one structure per kind (daily, weekly, catch up) as an ordered list of blocks (hello, rundown, sections with depth and count, top picks, trending, release news, close, sign-off) in `config/structure.json`, one `structure.set` op, read by curate (section order and allowances) and by the episode planner and prompt; a Preferences view with the queue's reorder gestures and a sheet to add or edit a block; defaults that reproduce today's shapes exactly, so nothing changes until edited. The owner answered its five questions on 2026-10-24 (both shapes follow it, a `custom` block with a title and a brief, one list per kind, no separate Catch up editor, its own file); the design holds the answers.
- Why: a briefing's reading order and an episode's script shape live in two files nobody can edit; the owner wants to compose them.
- Revisit if: phase 1 of the design shows the planner cannot reproduce today's shapes from the default blocks.

## D176: the podcast structure, phase 1: the defaults are today's, counts are optional

- Date: 2026-10-24 (the owner: "kick off multiple agents to get them all implemented")
- Decision: `config/structure.json` (D170) is read by curate, the digest and the Catch up planner. A kind the file leaves out runs the code path it ran before, so nothing changes until the owner saves a kind. Daily and weekly start with no rundown and no close, since their narration never had either; Catch up starts with both. A block's count is optional, and absent means the engine's own allowance (three Top picks, five for a section with its own allowance), so the defaults copy no constant into the file. A structure holds 32 blocks, not twelve: each custom and general topic brings a section. A stored kind leaves out a section it does not list; a topic made later is added to every stored kind (`topic.upsert`), and `topic.scope` putting a topic in adds its block, while `skip_topics` still takes one out. A digest whose built-in sections read out of their fixed order keeps a `section_titles` snapshot, so the page and the narration read the owner's order. In Catch up a section the form picks still airs when the structure does not name it, after the named ones; Top picks, Trending and release news air only with their block.
- Daily and weekly (the owner chose, 2026-10-24: "Rundown in code, rest Catch up only"): a rundown block makes the narration name the first stories by their chapters after the opening ("Coming up: ..."), its count kept in the digest's `rundown` so a later edit never changes old audio. A close or a custom block is refused for those kinds; Catch up takes both.
- Why: the design assumed every episode is written by the script writer; only Catch up is. Daily and weekly narration is code around stories written one by one, so a close and a custom brief have no writer there.
- Revisit if: the owner wants custom blocks in daily or weekly, which needs a model call per briefing.

## D182: each block's prompt is the owner's to replace, per kind

- Date: 2026-10-24 (the owner: "the block level model instructions must be open for editing"; on the cards, "The full prompt per block" and "Separate per kind")
- Decision: `config/structure.json` keeps `prompts` by kind and block key (`section:<id>` or the block type), apart from the blocks, set one at a time by `structure.prompt` (null puts back the built-in). The built-in prompts live in `packages/core/src/blockPrompts.ts`, the strings the engine sends, so the page shows exactly what the writer is told. Daily and weekly: a story block's prompt replaces the fields and fact rules for the stories of that section (they are batched apart); the voice from `config/voice.md`, the source handling and the reply's JSON shape stay in code, and the linter, numbers and grounding checks still run. The hello, rundown and sign-off are spoken by code there, so they take no prompt. Catch up: every block but an owner block (whose brief is its prompt) takes one, delimited in the message as the owner's text; a prompt set while the kind is on its defaults runs the defaults as a structure.
- Why: one request per prompt keeps a reorder small and a 6000-character prompt inside the settings request limit; a prompt kept apart survives a block's removal and Undo.
- Revisit if: login (Google, in progress) lands, since until then anyone with the URL can edit a prompt (D160); or a prompt edit is wanted for the voice itself.

## D184: Each podcast looks back as far as its settings page says

- Date: 2026-10-25 (the owner, on the Structure view's per-block "Newer than": "this should be gone if we are handling globally for daily and weekly setting")
- Decision: Daily and Weekly each have a Look back row in Episode: since the last episode (the default, no field written) or 12 hours, 1, 2, 3 or 7 days, stored as `lookback_hours` at the top of `config/schedule.json` and in `weekly`. Selection drops a story dated (or, undated, fetched) before the lookback as `too_old`. Catch up and briefings run by hand ignore it.
- Why: the fetch window (since the last fetch, at most 7 days) decides what is read; the lookback only narrows what airs, so it cannot reach stories the engine never fetched, and an unset field keeps every run as it was.
- Revisit if: a lookback longer than the fetch window is wanted, which needs the fetch to read further back.
- Superseded by: D215 (2026-10-29): the row, the stored fields and the `too_old` drop are gone.

## D191: one podcast structure, chosen by listener profile, sized to the episode's length

- Date: 2026-10-25 (the owner: "have one global structure of the podcast instead of daily, weekly, catch up"; "the current podcast structure is very focused on design engineers. If you can add a profile selector in preferences settings page").
- Decision: `config/structure.json` holds one block list for every podcast type, `{version: 1, profile, blocks, prompts}`; a Profile select on `/settings/preferences` (Artist, Designer, Founder, General, Journalist, Product Manager, Researcher, Software Engineer, Student, then Custom) loads a preset list, and any edit turns the profile Custom and keeps the list. The engine applies the one structure and scales each block's count by the episode's length over ten minutes (`score/sectionPlan.ts`). Daily and Weekly show the profile as a disabled select with "Set once for every podcast in Preferences" linking there. The old per-kind shape reads as Custom (the daily list, else the first present) and the next save rewrites it.
- Why: three lists said the same thing three times and read as a design-engineering product; a profile names the listener, and the length already says how much a block holds.
- Rejected: a profile per podcast type (the owner asked for one global structure); hiding the Catch up frame rows (the owner keeps Hello and Sign-off listed for their prompts, D170).
- Revisit if: a type needs a block the others must not have (then a per-type override on top of the profile, not a second list).

## D207: a Regenerate can ask for its own length

- Date: 2026-10-28 (the owner's goal: the generation length needs fixing; length may need to go up).
- Decision: the Regenerate sheet has a Length (Usual, 3, 5, 10 or 15 min). The choice travels as `length_minutes` through `/api/generate` (one of the four, else 400), a `run.yml` input, `--length` on the gate step and `length_minutes` in the plan, which sizes the fetch and write steps in place of the schedule's length (`lengthMinutesFor`). Usual sends nothing, so a run without it is sized as before; Try again sends it again.
- Why: the schedule's length is the owner's standing choice (the store owns it, D149), and a short briefing could only be answered by changing it. A single run can now be made longer or shorter without touching the schedule. The four lengths are the schedule's; longer than 15 still needs chunked narration.
- Rejected: editing the schedule from the sheet (it would change every later run); a free number of minutes (the sizing, the pool and the narration limit are tuned for the four).
- Revisit if: a run at 10 or 15 minutes airs under 90% of it (`length_share`), or the narration request grows past 15 minutes.
- Amends: D204, which left a Length control out.

## D208: every generation under way in one list, each with a Cancel

- Date: 2026-10-28 (the owner: "a simpler way to track the queue of generation on mobile and desktop", an icon "not for downloads, but for generations", a list with a thumbnail, a bar, a time left and Cancel, "just like how a file download UI would look").
- Decision: `GET /api/generations` lists the Catch up and briefing runs that are queued or running (at most 6, each with the status route's stage, `progressOf`), and `POST /api/cancel` cancels one of ours (`cancelRun`; GitHub's 409 means it had finished). From 64rem an icon at the top of the side column opens a popover with a row per generation: cover, title, stage and time left, a bar, Cancel, and Listen now once a live episode can be heard. Its ring fills with the run's progress. With nothing under way it says "Nothing in the works" and offers a Catch up. Below 64rem the strip above the bottom bar gains "All generations", which opens the same list as a bottom sheet. A cancelled run ends as "Cancelled": no Try again, no failure. A briefing's time left comes from the medians of the last ten runs' `stage_ms` in `state/run-metrics.json` (three runs at least).
- Why: the strip follows one run, so a second one (a Regenerate during a Catch up, or one started in another tab) could not be seen or stopped from the page. The route is a write, so it takes the shared burst cap (D150, 10 a minute) and refuses an id that is not a dispatched run of `run.yml` or `podcast.yml`. With no auth (D201), anyone with the URL can stop the schedule's briefing too, as they can already delete one; a cancel stops spend and loses nothing that Regenerate cannot remake.
- Rejected: an icon in the phone's app bar (nothing needed often sits at the top of a phone, ledger section 1; the strip is already in the thumb's reach); one polling loop for the whole site (the list polls every 4 s only while open, and the strip's own poll keeps the ring); Pause (GitHub cannot).
- Known gap (CodeRabbit, 2026-10-28): the narration job runs inside `podcast.yml` (step "Recording voices"), so Cancel there stops it before the usage ledger's final commit. The episode is already committed; only that run's usage charge for segments already made is lost, so the monthly counter can read low by up to one episode's narration. A crash or timeout has the same window; Cancel makes it reachable on purpose.
- Revisit if: the token turns out to lack Actions write (Cancel then says it could not), the usage counter is seen reading low after a cancel (then refuse Cancel from the voices stage, or commit usage per segment), or owners ask for the list on a phone's top bar.
- Amends: D204 (one run card).

## D211: what the owner sees and hears says podcast, not briefing; code names keep briefing for now

- Date: 2026-10-29 (the owner: "Call briefing a podcast everywhere"; later, "rename everywhere, including URLs, folders, fields; keep redirects").
- Decision: every word the person reads or hears now says podcast where it said briefing: pages, buttons, toasts, the run card, Health, the manifest, accessible names, the host's spoken sign-off and the CLI. An on-demand item is still an episode where the copy sets the two apart ("a podcast or an episode"). The three display nouns (`ChipNoun`, `AudioNoun`, `NarrationNoun`) became `"podcast" | "episode"`. No URL contained the word, so no redirect is needed. Not changed: identifiers, file names, CSS classes, data attributes and persisted fields (`kind: "briefing"` in share and analytics records, `what: "briefing"` in runs, `last_briefing` health ids), the prompts the writer and judge read, engine log lines, the changelog's past entries and the docs.
- Why: the code already uses `podcast` for the two-host episode engine (`planPodcast`, `/api/podcast`, `PodcastRequest`), so a mechanical `briefing` to `podcast` rename would collide with it and merge two run kinds (`what`) into one value. The words a person meets are the part the owner asked about; names inside the code are not seen. Prompts change model output, so they move only with an eval.
- Rejected: a search and replace over all 1,600 uses (collisions, and persisted fields in stored share and analytics records would stop matching); renaming the URL space (`/d/` is the digest, not the word briefing).
- Revisit if: the engine's `podcast` names are renamed to `episode` first (then the `briefing` identifiers can follow with a dual-read for stored fields), or the owner wants `/d/` to become `/p/` (then add redirects).

## D212: a podcast takes three regenerations, with no daily limit of its own

- Date: 2026-10-29 (the owner: "3 regenerations per podcast with a tooltip counter", "no day limit").
- Decision: each podcast (a Daily, a Weekly, an on-demand briefing or a Catch up episode) can be regenerated three times (`MAX_REGENERATIONS` in core). The count lives in the file's own front matter (`regenerations`, written by the replacement run as the old count plus one; an episode carries it into the episode that replaces it). The server reads it live from the content store and answers a fourth with 409 `regeneration_limit` before a run is dispatched; a count it cannot read (store down, listed file unreadable) answers 503 "try again", never 0 (decided for the owner while away, 2026-10-29). The Regenerate item says "2 of 3 regenerations left" as its tooltip (`title`) and is disabled, with "Regenerated 3 times, the most a podcast takes", once spent. A regeneration is exempt from the briefing's 6-hour and 3-a-day limits and from the episodes' 2-minute and 12-a-day limits on the regenerate action itself; it waits 30 seconds against a double tap, with a ceiling of 25 runs a day of the route's workflow against a runaway script (the run list GitHub returns holds 30, so 50 could never be reached, and delete runs share those 30 slots, so the ceiling is a guard, not an exact count). Its workflow run no longer counts toward a new Catch up's limits, because `podcast.yml` now names its runs (D213).
- Why: the owner wants the count to bound spend per podcast, not the clock; a daily cap stopped a second try an hour later for no reason the owner could see.
- Rejected: counting from the workflow run list (it forgets after a few days and cannot tell which podcast); a counter in the settings store (a second place to drift from the file).
- Revisit if: a regeneration becomes cheap enough to need no count, or the file moves to the store as the only truth (D173).

## D213: two Catch ups a day that came out; a failed run does not count

- Date: 2026-10-29 (the owner: "catch-up podcasts 2 per day", "cap 2 successful").
- Decision: a new Catch up is refused (429 `daily_cap`, "That's today's limit. Try again in...") once two Catch ups have come out or are still being made in the last 24 hours; the answer says how long until the older one is a day old. A run that failed or was cancelled does not count, so a failure can be tried again. The old limits stay as a guard on tries: two minutes apart and twelve runs a day, failed ones included. Deleting a Catch up frees nothing, because the cost is spent. To tell a new Catch up from a regeneration or a delete in the run list, `podcast.yml` names its runs (`run-name`): "episode", "regenerate <id>" or "delete <id>". A run of the old name "podcast" is counted as a Catch up for the first day.
- Why: the owner wants spend bounded by what was made, not by what was tried; the old 12 a day counted failures, regenerations and deletes alike.
- Rejected: counting episode files from the store (a delete would free a slot and a delete-and-remake loop would get round the cap); a counter in the settings store (a second place to drift).
- Revisit if: two a day turns out too tight for the owner, or the run list (30 runs) stops covering a day.

## D216: a ticked general topic gets a section under any profile, sized to the episode's length

- Date: 2026-10-29 (decided for the owner while away, from his #147 rule that the settings length is the only size limit and his repeated complaints of short podcasts).
- Decision: `loadSectionPlan` adds a brief section for each general topic the podcast ticks and the stored structure leaves out (D191 presets list none), before the sign-off, with `max_stories` 5 at the 10-minute reference, scaled by the episode's length (3 at 5 minutes). The same plan feeds selection and the validator, so the larger allowance holds through both.
- Why: the 2026-10-29 dry run showed 36 of 53 qualifying stories dropped `not_in_structure`, so the daily aired about 3.8 of 5 minutes. With the sections back it still selected 11 of 52 (30 `over_section_cap`) because a general section held a flat 2.
- Rejected: a flat higher allowance (ignores the length); skipping the allowance when under length (the validator would trim it back).
- Revisit if: the next two dailies still miss their length by more than 10%, or general topics crowd out the owner's own topics.
- Amends: D170, D191.

## D217: run.yml names every run for what it is

- Date: 2026-10-29 (the owner: unique run names per type for analytics and debugging; the queue shows only Catch ups and regenerations).
- Decision: `run.yml`'s `run-name` is `delete <id>`, `dry run <mode>`, `regenerate <digest id>`, the scheduler's `label` input (`daily <date>`, `weekly <date>`, `daily and weekly <date>`; the cron route sets it from the gate's decision), `on-demand`, or `scheduled` for GitHub's late fallback. The old name `run` is read as a briefing run. The generations list leaves out the schedule's own runs and any dry run, and a regeneration names its target; the Regenerate cooldown and health's `run_died` and `run_cancelled` read the prefixes. `podcast.yml` keeps `episode`, `regenerate <id>` and `delete <id>` (D213).
- Why: every briefing run was titled `run`, so a regeneration had no target, the schedule's run was counted as a Regenerate press (D61's noted cost) and nothing could be grouped by type.
- Rejected: a date in the Catch up name (the dispatch cannot know the episode id; the queue names it from its start time); a run-name per run number (unique but groups nothing).
- Amends: D61, D213.

## D218: a block's story count is a proportion, not a ceiling; the length is the limit

- Date: 2026-10-29 (decided for the owner while away, from his #147 rule that the settings length is the only size limit and D119's spares).
- Decision: selection takes each block's count first (so the sections keep their proportions), then fills the room the length leaves (the sized total with spares) with the best remaining stories, ignoring the counts. Validation already cuts the narration to the length, so the extras stand as spares for a story lost in writing. Release news keeps its tenth of the cap; a custom or general section with an allowance of its own keeps that allowance (D216).
- Why: the 2026-10-29 dry run after D216 selected 13 of 51 stories, exactly the Designer profile's counts scaled to 5 minutes; two were lost in writing, the refill kept none, and 11 items aired against about 15 wanted. The counts had left no spares.
- Rejected: raising the preset counts (changes what a profile means and still leaves no spares); a hard cap at the counts with validation trimming to them (the owner's length is the limit).
- Revisit if: one section crowds out the rest of an episode, or writing the extra stories costs more than the length they buy.
- Amends: D170, D176.

## D219: a day's Catch ups are one album, chosen by a select before Play

- Date: 2026-10-29 (the owner: "keep both catchups under same album ... a dropdown selector before the play button ... Catchup at 14, Catchup at 22"; "no shaking"; "share button an icon button"; "big cards for the different topic sections like in the settings page"; "Downloaded next to the subtitle").
- Decision: the Catch ups with one Stockholm date (`episode.date`) form an album. The grouping is by that date; D213's cap counts a rolling 24 hours, so the two are separate rules. A Catch up's page, and Latest when one is the newest, shows a select of them before Play when there are two or more; choosing one opens its page. Each option is named `Catch up at HH` for the hour it started, two digits so the names are one width, `HH:MM` on all of them when two started in one hour. The page script names them in the browser's zone for that visit only (nothing stored); the server draws Stockholm's hour, and the day boundaries and the grouping stay Stockholm's. The select is the shared `.sort-field`, as wide as its longest name, so switching moves nothing. The hero's row scrolls sideways when select, Play and Share do not fit (to the screen's edges on a phone). Share is a circle on the select's fill (the shared `.icon-btn` with its `.icon-btn-tonal` modifier, the secondary icon button) on every podcast page. A section's stories sit in one `.card-group` under the section's header, on briefings and episodes alike. "Downloaded" with a check circle ends the hero's facts line once the page is saved offline.
- Why: two Catch ups a day were two unrelated pages with unrelated covers; the owner thinks of them as one thing with two takes.
- Rejected: one Library card per day (a card's menu acts on one id, so Delete and Regenerate would be ambiguous; not asked for); switching in place without navigation (the player, transcript and story controls all read the page's own data); a select on a day with one Catch up.
- Revisit if: the owner wants the Library to group them, or the cap moves above two.
