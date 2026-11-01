# Index archive

The oldest rows of the decisions Index (D1 to D150), moved here so the live Index in [README.md](README.md) stays under its cap. Same format and same rules: the status column says whether a decision still holds, and a new decision that retires one edits its row here. Find a decision with `grep -rn "keyword" docs/decisions/`.

| ID | Decision | Status |
| :--- | :--- | :--- |
| D1 | Engine runs on GitHub Actions | active |
| D2 | The repository lives in this folder | active |
| D3 | Judge is TypeSafe Jev, writer is a cheap Nebius model chosen by a bake-off | active; the writer part superseded by D136 |
| D4 | Astro with React islands, Base UI and hand-written token CSS | active |
| D5 | One MP3 per digest with word marks, from Speechify | superseded by D33 for new narration |
| D6 | Daily cron with a calendar-date gate, plus a Sunday weekly pass | active; Vercel Cron since D61; no weekly D65 |
| D7 | Podcast feed deferred | active |
| D8 | "Thought of the Day" cut | active |
| D9 | Repository `somesh-ks/knowledge-hub`, private | active |
| D10 | Hosting on Vercel | partly superseded by D25 |
| D11 | Notification is the commit only | active |
| D12 | Voice limits confirmed | superseded by D34 |
| D13 | Accounts exist | active |
| D14 | Docs and config filenames are lowercase kebab-case | active |
| D15 | Persisted keys are snake_case and code follows them | active |
| D16 | Personal skill `sk-dispatch`, built separately | active |
| D17 | UI and sound design live in `docs/design/` | active |
| D18 | UI sounds are procedural Web Audio from `@dispatch/sound` | active |
| D19 | TypeScript 6 pinned repository-wide | active |
| D20 | One preferences key for theme and settings | active |
| D21 | Source health lives in state | active |
| D22 | `deploy.yml` owns the deploy | superseded by D25 |
| D23 | The engine tolerates audio failure | active |
| D24 | The writer model is picked from the live Nebius list | superseded by D136 |
| D25 | The Vercel GitHub integration deploys the site | active |
| D26 | Audio uploads use Vercel Blob OIDC credentials | active |
| D27 | Owner and Dependabot pull requests merge automatically | active |
| D28 | The audio job runs the Vercel CLI outside the checkout, and its failure is not a failed run | active |
| D29 | Narration is hosted: a spoken version per story and a code-built host frame | active |
| D30 | The reader is called Singularity; identifiers keep `dispatch` | see D179 |
| D31 | Visual language follows Google Podcasts and YouTube Music | active; play chip tonal since D72 |
| D32 | The player is one always-mounted surface, without Base UI Drawer | active |
| D33 | Narration is made on Play, story by story | active |
| D34 | Stories are told in four beats; the why line is no longer written | active |
| D35 | A Tech releases section, ranked by launch scale, with its own allowance | active |
| D36 | Topics and sources are data the owner edits from the app | active |
| D37 | Custom podcast episodes live in `Podcasts/` and are built by a workflow | active |
| D38 | Subagents are few, narrow, enforced and capped | active |
| D39 | Five topics, Top picks always included, General and Customized audiences | active; Create's topics are one list since D67 |
| D40 | Trending is ranked by coverage; discovery only suggests | active for discovery; Trending off, its outlets feed World since D69 |
| D41 | Passphrase off, code kept | superseded by D160 |
| D42 | One Jev request per item, and a per-run Firecrawl ceiling | active |
| D43 | General episodes are built from general-news feeds, ranked by coverage | active; ids mix with briefings since D67, feeds judged since D66 |
| D44 | An episode can be deleted, or regenerated with the listener's feedback | active |
| D45 | The briefing's hour, cadence and topics are set in Settings | active; `RUN_CRON` is the fallback trigger since D61 |
| D46 | The writer's provider and model are chosen in Settings | superseded by D136 |
| D47 | A move between pages is answered from a saved copy and swapped at once | active |
| D48 | One shader: a light in the cover's colours behind the header, on a GPU only | active |
| D49 | One Podcast settings page: Daily, Weekly, Custom, writer, topics, sources | layout superseded by D51; the 0 to 5 score by D55 |
| D50 | The open player: a speed slider, Chapters or a Speechify-style transcript, word marks stored beside each segment | active |
| D51 | Settings is two levels and saves itself; every select opens one drawn list | active; the Custom page superseded by D56 |
| D52 | On a phone Create floats only on Today and the Library, extended till you scroll | superseded by D60: Create floats on the Library alone |
| D53 | First-load JavaScript budget 110 KB, kept as low as the code allows | active |
| D54 | Form fields carry a 3:1 outline; in the player only Play is full ink | active for text fields (ink: D238); selects, segments, chips tonal since D72 |
| D55 | A source's score is out of 3: health, quality and trust; a weak part is not bought back | active; a word, not pips and a number, since D83 |
| D56 | One panel adds a topic or a source and edits a source; no Custom page | active |
| D57 | A topic's page edits its details and adds suiting sources; topics are listed by name | active; amended by D64 and D69 |
| D58 | The Model page offers six top Nebius writers by name, live list or not | superseded by D136 |
| D59 | On a phone, Play takes the floating button's place on an episode or old briefing | active; Today floats Play too since D60 |
| D60 | On a phone Create floats on the Library alone; every page with audio floats Play | active; Play floats once the hero's Play scrolls off since D77 |
| D61 | Vercel Cron starts the scheduled briefing in its hour; GitHub's schedule is the fallback | active |
| D62 | Daily and Weekly each choose topics; voice samples play in the site | active; each topic's Scope sets them since D69 |
| D63 | Daily and Weekly leave out topics, one chip each, stored as those left out | superseded by D69: storage stays, chips moved to each topic's Scope |
| D64 | Every topic can be renamed; what counts edits wherever the judge reads it | active |
| D65 | The weekly podcast takes its day; the daily cadence counts from it | active |
| D66 | General news topics are topics; their feeds are sources Jev judges every run, for scores and episodes only | active |
| D67 | Create shows one list of topic chips; the audience presets them; an episode can mix briefing and general topics | active |
| D68 | An episode opens with a rundown, deep-dives its lead stories, gives the rest as nuggets and closes short | active |
| D69 | Design, AI and Technology gather the judge topics; one alphabetical list, each topic sets its scope; sources filed under a topic | active |
| D70 | A scoring sample judges a few items a run for scores alone, so every source gets a score, switched-off ones too | active |
| D71 | Add topic modal: live suggested sources with Jev scores, timezone and scope chips | active; amended by D75, D79, D89 |
| D72 | The look is tonal: containers, state layers and round buttons, not outlines and invisible hovers | active |
| D73 | A steadier type scale: 16px reading, 18 to 20px headlines, 14px meta, 22px regular section headings | active |
| D74 | A discussion's hosts are named for their voices; the transcript names a speaker only on a change of speaker | active |
| D75 | Suggested sources are chosen from the source catalogue when the page is built, with no live lookup and no scores | active |
| D76 | Create is the New episode form: three questions first, the defaults under More options | active |
| D77 | A reading page: the headline is the link, Play is the one filled action, one hero for any title | active |
| D78 | The Library has one facts line per card, finds dates, keeps its search in the address and remembers what was played | active |
| D79 | A saved setting shows before the build, and a new topic stays on its list with its suggestions at once | active |
| D80 | An episode is written to 95% of what its stories can carry, and a script a little under the floor is kept | active |
| D81 | A workflow installs only what it runs; the audio job skips the Vercel pull with a Blob token | active; owner merges workflow files by hand |
| D82 | Play keeps an early tap, a new episode is pre-narrated, the deploy is noticed in 2.5 s | active |
| D83 | Settings shows a source's score as a word, its name opens its editor; Model default is called Default | amends D55's pips and D69's name links |
| D84 | A failed run keeps its request and offers Try again; a finished run clears itself; one run at a time | active |
| D85 | The player's chapters are timed and play their story; an unnamed discussion is named from its voices; one length rule | amends D74 |
| D86 | An action has its own tone, the player bar is one tonal block with the navigation, reading text keeps a 34rem measure | active; extends D72 |
| D87 | New episode says when a choice changed the topics, with Undo; the Library searches with an excerpt around the match | amends D76 and D78 |
| D88 | A reading page's section strip is opaque, a focused headline rings as one block, the playing hero Play is tonal, an old briefing offers Share | amends D77 |
| D89 | The time zone selector is withdrawn until the engine counts in a chosen zone; summaries follow what is saved | amends D71 and D79; the selector returned in D100 |
| D90 | The open player has one left edge, an even rhythm and two weights; its lists are one Tab stop each; Back goes back | amends D85 |
| D91 | Daily and Weekly offer only what a briefing uses; an edit made in the server's gap survives leaving the page | amends D74, D79 |
| D92 | The rundown is no story, a listener's move never scrolls the page, the open page owns the transport, a glyph says what its button does | amends D85 and D90 |
| D93 | A tab's jump puts the app bar away first, a kept-whole headline word stays atomic, offline switches off every control that starts a run | amends D88 |
| D94 | Up next narrates a briefing without audio, a phone's page never scrolls itself, a failure is told once, the open page closes by mouse | amends D92 |
| D95 | The Library's search finds the start of words, a list row keeps its title level, and a segmented choice keeps its width | amends D78 |
| D96 | An empty screen is one simple illustration, a title, one line and one filled action | active |
| D97 | What the device remembers reads the same everywhere, the worker keeps what a page fetches, and a refusal reads the same on every control | amends D92, D93 and D94 |
| D98 | A lost held change is told to the open page, a failure notice replaces the story line, an empty scene draws an object, not a control | amends D94, D96 and D97 |
| D99 | The test suite protects what fails silently, in one layer, once; the dev lab is retired; refused, lost and failed actions are told | amends D91, D97 and D98 |
| D100 | The time zone selector returns and the schedule counts in the chosen zone; a second voice; voice rows keep Play | amends D71, D89 and D91; Format ended in D215 |
| D101 | A long list is a searchable list; the bar keeps its controls on a wide screen; every recording has a transcript; every topic is shown | amends D76, D90, D92 and D100 |
| D102 | General topics play in Daily and Weekly; a topic is always on and has a summary card; the gate runs in parallel | amends D69, D87, D89, D90, D101 |
| D103 | Source scores as stars; source lists fold at seven; topic delete asks first; Regenerate takes feedback; first-load 150 KB | amends D55, D83, D53 |
| D104 | Every briefing has Share, Regenerate and Delete; Regenerate replaces that digest over its window; Delete removes its file and timeline | amends D88, D103 |
| D105 | A new episode plays from a live Blob copy while it is written; mobile sounds unlock on click; the spoken word lights at once | amends D82, D101 |
| D106 | The wide bar leads with what is playing and hides its volume until hover; sheets lose the grabber; a played chip offers Play again | amends D46, D58, D101 |
| D107 | The transcript's highlight pauses while the host speaks words the page does not show | amends D101, D105 |
| D108 | A user profile holds blocked domains and story votes; a block cuts an outlet on every fetch path; votes nudge ranking, listings and the writer, and are never shown | active |
| D109 | Regenerate chooses the topics again and takes comments, for an episode and a briefing, for that run only | amends D44, D103, D104 |
| D110 | Covers dated 2026-10 or later take one colour scheme a month, set layouts for Daily and Weekly, a round plate for On demand, contrast enforced in code | active |
| D111 | The open player has no drag handle and square top corners at every point of its travel | amends D32, D106 |
| D112 | Every page modulepreloads what it loads at start; press code loads at idle; the player's motion after first paint; first-load budget 109 KB | amends D53, D103 |
| D113 | Claude Sonnet 5.5 is the default writer for the page and the engine; the Model list has no Default row; Nebius starts on GLM-5.3 | superseded by D136 |
| D114 | Every episode is for the owner; New episode form is short | amends D39, D67, D76, D101 |
| D115 | Settings save quietly: no toast while a change saves or once it is saved; the toast is for a failure, an Undo or a partial save | amends D79, D91, D98 |
| D116 | docs/ is grouped by purpose: the record at the top, plan/, engineering/, design/, reference/; audits fold into history notes | amends D14 |
| D117 | Model picker: Anthropic, Nebius lists live (5 min cache); a Claude beyond the built-in two saves only if Anthropic lists it | superseded by D136 (the picker and `/api/models` are gone); amends D46, D58 |
| D118 | Jev 1.14.0 is pinned; Jev checks the strongest candidates against the owner's taste (votes, opens), replacing the vote nudge, within 15% | amends D3, D108 |
| D119 | A briefing sized by the owner's length writes 30% spares; validation airs the best survivors until measured narration fills the length, each topic's best kept | active |
| D120 | Science takes a one-outlet story that is clearly on topic; the other general topics keep the two-outlet rule | amends D40, D43 |
| D121 | Covers are drawn at medium chroma (OKLCH 0.12 or less); each monthly series has its own style set and prints on its own close tint of the month's paper | amends D110 |
| D122 | Covers a step brighter in both themes; the header light takes the cover's colours as three drifting lights; a theme change waits for covers | amends D48, D77, D121 |
| D123 | One AI model select on Settings; no manifest colour, so Android's bars follow the system; a launch screen; the playing cover lights the player | active, except the model select, which D136 removed; amends D51, D101 |
| D124 | Weights are five named stops and Off; sources have a Jev-classified format; a format mix per page; two stories per outlet | amends D57, D69, D83 |
| D125 | Headings never bold; Settings H2s at the 22px role; an Intelligence section for the model; Topics and sources: a search and a floating Add | amends D73, D123, D124 |
| D126 | A play queue, an Up next peek and sheet, a collapse chevron, Space to play | amends D102, D111 |
| D127 | Each Library row has a ⋮ menu (Download, Add to queue, Regenerate, Share, Delete); a download keeps audio and page in Cache Storage, max 10 | partly superseded by D281; amends D123 |
| D128 | `dispatch publish` pre-narrates recent episodes (every turn and its marks, by hash), and `podcast.yml` calls `audio.yml` after an episode commit | amends D82 |
| D129 | Settings restructured: Sources or Preferences per topic, one voice pair, Theme select | partly superseded by D195; amends D51, D87, D124, D125 |
| D130 | Kimi models are never offered; the Nebius five are ranked by EQ-Bench longform; a weekly scheduled check proposes a refresh by PR | superseded by D136 |
| D131 | An 8pt spacing system (4px only for named fine cases), rows that carry their own rhythm, headings never bold, enforced by `npm run design-check` | amends D73 |
| D132 | Two segmented controls (a choice with a check; a navigation tablist with a sliding pill) and one sheet header with Close at the end | amends D106 |
| D133 | The second owner round: Up next as a player tab, Settings cards, one search and chip style, Jev emoji, no Daily type | amends D126, D127, D129, D132 |
| D134 | The weekly writer model check is removed; the model list stays live from Nebius and the five are refreshed by hand | amends D130 |
| D135 | No batch API for the scheduled runs | superseded by D209 at step 3 |
| D136 | One model orchestrator: every call through `config/models.json` (Jev, Claude, Gemini; never Opus), with fallback chains | active; replaces D46, D58, D113, D130 |
| D137 | A cost ledger records every paid call (measured where the provider reports usage), split into shared and per-user costs, shown by `dispatch costs` and /analytics | active |
| D138 | Alexandria enriches thin text, never replaces it | active |
| D139 | Hardening: `dispatch health` reports silent faults, a daily workflow opens a `health` issue and retries once, the site reports its errors | active |
| D140 | Design system enforced in three layers (`design-check` hook, e2e, `design-audit` agent); icons only from Phosphor | amends D131 |
| D141 | The first-load budget is 130 KB | amends D112's 109 KB budget |
| D142 | A new topic is a row at once and opens a page before the build; one save carries Jev's emoji; a removal leaves the page at once with Undo | amends D79 |
| D143 | Every PR gets a code review before it merges, by hand once blocking findings are fixed | active; partly superseded by D254 for `[skip-review]` PRs; amended by D292 |
| D144 | Phone sheets close by pull or tap outside and show no Close | amends D132 |
| D145 | Network-first page loads; a build check on return | amends D47 |
| D146 | A deploy is offered in a toast; Vitals wait | amends D145 |
| D147 | Lab probe, not field Vitals | amends D146 |
| D148 | CI on pull requests only; browser suites by path, Dependabot or label | active |
| D149 | Owner config in Postgres; a git snapshot | active; off until set |
| D150 | Paid-route caps shared in Neon | amends D149 |
