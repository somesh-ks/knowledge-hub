# Dispatch: decision log

Each entry records what was decided, why, and what was rejected. Add new entries at the end with the next number. Do not rewrite an old entry: if a decision changes, add a new entry that supersedes it and set the old status to "Superseded by Dn".

From D124 on, an entry that supersedes another adds `- Context changed:` (one sentence: what made the old decision wrong), and an entry whose reason can expire (a provider, a price, a budget, an unmeasured guess) adds `- Revisit if:` (the evidence that would reopen it). Current behaviour lives in [specs/](specs/README.md).

The first build's plan and vision were retired on 2026-10-19: `git show 91bc533:docs/plan/build-plan.md` and `git show 91bc533:docs/plan/vision.md`.

D1 to D9 date from plan v2 (2026-10-05). D10 to D25 date from 2026-10-06. Reasons are the plan's working rationale; correct any the owner would state differently.

## Index

| ID | Decision | Status |
| :--- | :--- | :--- |
| D1 | Engine runs on GitHub Actions | active |
| D2 | The repository lives in this folder | active |
| D3 | Judge is TypeSafe Jev, writer is a cheap Nebius model chosen by a bake-off | active |
| D4 | Astro with React islands, Base UI and hand-written token CSS | active |
| D5 | One MP3 per digest with word marks, from Speechify | superseded by D33 for new narration |
| D6 | Daily cron with a calendar-date gate, plus a Sunday weekly pass | active; Vercel Cron since D61; no weekly since D65 |
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
| D24 | The writer model is picked from the live Nebius list | active |
| D25 | The Vercel GitHub integration deploys the site | active |
| D26 | Audio uploads use Vercel Blob OIDC credentials | active |
| D27 | Owner and Dependabot pull requests merge automatically | active |
| D28 | The audio job runs the Vercel CLI outside the checkout, and its failure is not a failed run | active |
| D29 | Narration is hosted: a spoken version per story and a code-built host frame | active |
| D30 | The reader is called Singularity; identifiers keep `dispatch` | see D179 |
| D31 | The visual language follows Google Podcasts and YouTube Music | active; the play chip is tonal since D72 |
| D32 | The player is one always-mounted surface, without Base UI Drawer | active |
| D33 | Narration is made on Play, story by story | active |
| D34 | Stories are told in four beats; the why line is no longer written | active |
| D35 | A Tech releases section, ranked by launch scale, with its own allowance | active |
| D36 | Topics and sources are data the owner edits from the app | active |
| D37 | Custom podcast episodes live in `Podcasts/` and are built by a workflow | active |
| D38 | Subagents are few, narrow, enforced and capped | active |
| D39 | Five topics, Top picks always included, General and Customized audiences | active; Create's topics are one list since D67 |
| D40 | Trending is ranked by coverage; discovery only suggests | active for discovery; Trending is off and its outlets feed World since D69 |
| D41 | Passphrase off, code kept | superseded by D160 |
| D42 | One Jev request per item, and a per-run Firecrawl ceiling | active |
| D43 | General episodes are built from general-news feeds, ranked by coverage | active; general ids mix with briefing ids since D67, and their feeds are judged sources since D66 |
| D44 | An episode can be deleted, or regenerated with the listener's feedback | active |
| D45 | The briefing's hour, cadence and topics are set in Settings | active; `RUN_CRON` is the fallback trigger since D61 |
| D46 | The writer's provider and model are chosen in Settings | active |
| D47 | A move between pages is answered from a saved copy and swapped at once | active |
| D48 | One shader: a light in the cover's colours behind the header, on a GPU only | active |
| D49 | One Podcast settings page: Daily, Weekly and Custom profiles, a shared writer vendor and model, topics and sources clubbed | page layout superseded by D51; the 0 to 5 score by D55 |
| D50 | The open player: a speed slider, Chapters or a Speechify-style transcript, word marks stored beside each segment | active |
| D51 | Settings is two levels and saves itself; every select opens one drawn list | active; the Custom page superseded by D56 |
| D52 | On a phone the Create button floats only on Today and the Library, extended until you scroll | superseded by D60: Create floats on the Library alone |
| D53 | First-load JavaScript budget 110 KB, kept as low as the code allows | active |
| D54 | Form fields carry a 3:1 outline; in the player only Play is in full ink | active for text fields; selects, segmented controls and chips are tonal since D72 |
| D55 | A source's score is out of 3: health, quality and trust, combined so a weak part cannot be bought back | active; shown as a word, not pips and a number, since D83 |
| D56 | One panel adds a topic or a source and edits a source; Settings has no Custom page | active |
| D57 | A topic's page edits its details and adds the sources that suit it; topics are listed by name | active; shipped topics take a new name, and app topics new wording, since D64; the judge topics show under Design, AI and Technology since D69 |
| D58 | The Model page offers six top Nebius writers by name, live list or not | active |
| D59 | On a phone, Play takes the floating button's place on an episode and an older briefing | active; Today floats Play too since D60 |
| D60 | On a phone Create floats on the Library alone; every page with audio floats Play, Today included | active; Play floats only once the hero's Play has scrolled away since D77 |
| D61 | Vercel Cron starts the scheduled briefing in its hour; GitHub's schedule is the fallback | active |
| D62 | Daily and Weekly each choose their topics; voice samples play through the site | active; each topic's Scope sets them since D69 |
| D63 | Daily and Weekly leave out topics, one chip per topic, stored as the topics left out | superseded by D69: the storage stays, the chips moved to each topic's Scope |
| D64 | Every topic can be renamed; what counts edits wherever the judge reads it | active |
| D65 | The weekly podcast takes its day; the daily cadence counts from it | active |
| D66 | General news topics are topics; their feeds are sources Jev judges every run, for scores and episodes only | active |
| D67 | Create shows one list of topic chips; the audience presets them; an episode can mix briefing and general topics | active |
| D68 | An episode opens with a rundown, deep-dives its lead stories, gives the rest as nuggets and closes short | active |
| D69 | Design, AI and Technology gather the judge topics; one alphabetical list where each topic sets its scope; every source filed under a topic | active |
| D70 | A scoring sample judges a few items a run for scores alone, so every source reaches a score, switched-off ones included | active |
| D71 | Streamlined add topic modal, live suggested sources with TypeSafe Jev scores, schedule timezone and topic scope indicator chips | active; amended by D75, D79, D89 |
| D72 | The look is tonal: containers, state layers and round buttons instead of outlines and invisible hover fills | active |
| D73 | A steadier type scale: 16px reading, 18 to 20px headlines, 14px meta, 22px regular section headings | active |
| D74 | A discussion's hosts are named after their voices; the transcript names a speaker only where the speaker changes | active |
| D75 | Suggested sources are chosen from the source catalogue when the page is built, with no live lookup and no scores | active |
| D76 | Create is the New episode form: three questions first, the defaults under More options | active |
| D77 | A reading page: the headline is the link, Play is the one filled action, one hero for any title | active |
| D78 | The Library has one facts line per card, finds dates, keeps its search in the address and remembers what was played | active |
| D79 | A saved setting shows before the build, and a new topic stays on its list with its suggestions at once | active |
| D80 | An episode is written to 95% of what its stories can carry, and a script a little under the floor is kept | active |
| D81 | A workflow installs only what it runs; the audio job skips the Vercel pull when the Blob token is set | active; the owner merges the workflow files by hand |
| D82 | Play keeps an early tap, a new episode is pre-narrated, the deploy is noticed in 2.5 s | active |
| D83 | Settings shows a source's score as one word, a source's name opens its editor, and the Model default is called Default | active; amends D55's pips and D69's name links |
| D84 | A failed run keeps its request and offers Try again; a finished run clears itself; one run at a time | active |
| D85 | The player's chapters are timed and play their story, a discussion without stored names is named from its voices, and one length rule runs through the app | active; amends D74 for episodes made before names were stored |
| D86 | An action has its own tone, the player bar is one tonal block with the navigation, and reading text keeps a 34rem measure | active; extends D72 |
| D87 | New episode says when a choice changed the topics and offers Undo; the Library searches with an excerpt around the match | active; amends D76 and D78 |
| D88 | On a reading page the section strip is opaque, a focused headline is ringed as one block, the playing hero Play is tonal, and an older briefing offers Share only | active; amends D77 |
| D89 | The time zone selector is withdrawn until the engine counts in a chosen zone; Settings summaries follow what was saved; episodes on request are Episodes | active; amends D71 and D79; the time zone selector returned in D100 |
| D90 | The open player has one left edge, an even rhythm and two weights; its lists are one Tab stop each; a story is a story everywhere; Back goes back | active; amends D85 |
| D91 | Daily and Weekly offer only what a briefing uses, and an edit made inside the server's gap survives leaving the page | active; amends D74 and D79; Format and the second voice returned in D100 |
| D92 | The rundown is no story, a listener's move never scrolls the page, the open page owns the transport, and a glyph says what its button does | active; amends D85 and D90 |
| D93 | A tab's jump puts the app bar away first, a headline word kept whole stays atomic, and offline switches off every control that starts a run | active; amends D88 |
| D94 | Up next narrates a briefing without audio, a phone's page never scrolls itself, a failure is told once, and the open page closes with a mouse | active; amends D92 |
| D95 | The Library's search finds the start of words, a list row keeps its title level, and a segmented choice keeps its width | active; amends D78 |
| D96 | An empty screen is one simple illustration, a title, one line and one filled action | active |
| D97 | What the device remembers reads the same everywhere, the worker keeps what a page fetches, and a refusal reads the same on every control | active; amends D92, D93 and D94 |
| D98 | A lost held change is told to the page that is open, a failure notice takes the story line's place, and an empty scene draws an object, not a control | active; amends D94, D96 and D97 |
| D99 | The test suite protects what fails silently, in one layer, once; the dev lab is retired; a refused model choice, a lost held change and a press in a failure are told | active; amends D91, D97 and D98 |
| D100 | The time zone selector returns and the schedule counts in the chosen zone; Daily and Weekly offer Format and a second voice again; every voice row keeps its play button | active; amends D71, D89 and D91 |
| D101 | A long list is a searchable list; the bar keeps its controls on a wide screen; every recording has a transcript; every topic is shown | active; amends D76, D90, D92 and D100 |
| D102 | General topics play in Daily and Weekly, a topic is always on and has a summary card, the bar has no chevron, titles are bigger, and the gate runs in parallel with the site type-checked | active; amends D69, D87, D89, D90, D101 |
| D103 | Source scores are out of 5 again, shown as a star rating; long source lists fold at seven; topic delete asks first; Regenerate on Today takes feedback; the first-load budget is 150 KB | active; amends D55, D83, D53 |
| D104 | Every briefing, daily or weekly, latest or older, has Share, Regenerate and Delete; Regenerate replaces that digest over its own window; Delete removes its file and timeline | active; amends D88, D103 |
| D105 | A new episode is playable from a live copy in Blob while it is still being written; mobile sounds unlock on click and play through the silent switch; the spoken word lights without lag; the player's switch is sticky on a phone | active; amends D82, D101 |
| D106 | The wide bar leads with what is playing and hides its volume slider until hover; bottom sheets lose the grabber and the corners; a played chip offers Play again; the Model field is a plain dropdown | active; amends D46, D58, D101 |
| D107 | The transcript's highlight pauses while the host speaks words the page does not show | active; amends D101, D105 |
| D108 | A user profile holds blocked domains and story votes; a block cuts an outlet on every fetch path; votes nudge ranking, listings and the writer, and are never shown | active |
| D109 | Regenerate chooses the topics again and takes comments, for an episode and a briefing, for that run only | active; amends D44, D103, D104 |
| D110 | Covers dated 2026-10 or later take one colour scheme per month, set layouts for Daily and Weekly and a round plate for On demand, with contrast enforced in code | active |
| D111 | The open player has no drag handle and square top corners at every point of its travel | active; amends D32, D106 |
| D112 | Every page modulepreloads what it loads at start; code a press needs loads at idle, never on the press; the player's motion loads after first paint; the first-load budget is 109 KB | active; amends D53, D103 |
| D113 | Claude Sonnet 5.5 is the default writer for the page and the engine; the Model list has no Default row; Nebius starts on GLM-5.3 | active; amends D46, D106 |
| D114 | Every episode is written for the owner: the General audience is retired, and the New episode form is Title, Topics, Length, Look back, with Format, Voice and Tone under More options | active; amends D39, D67, D76, D101 |
| D115 | Settings save quietly: no toast while a change saves or once it is saved; the toast is for a failure, an Undo or a partial save | active; amends D79, D91, D98 |
| D116 | docs/ is grouped by purpose: the record at the top, plan/, engineering/, design/, reference/; audits fold into their history notes; docs/README.md maps it all | active; amends D14 |
| D117 | The Model picker reads Anthropic's and Nebius's model lists live, cached five minutes; a Claude model past the built-in two saves only when Anthropic lists it | active; amends D46, D58 |
| D118 | Jev 1.14.0 is pinned by version; Jev checks the strongest candidates against the owner's taste (votes and opens) and that answer replaces the source-vote nudge, within the same 15% | active; amends D3, D108 |
| D119 | A briefing sized by the owner's length selects and writes 30% spares; validation airs the best survivors until their measured narration fills the length, each topic's best story kept | active |
| D120 | Science takes a one-outlet story that is clearly on topic; the other general topics keep the two-outlet rule | active; amends D40, D43 |
| D121 | Covers are drawn at medium chroma (OKLCH 0.12 or less); each monthly series has its own style set and prints on its own close tint of the month's paper | active; amends D110 |
| D122 | Covers a step brighter in both themes; the header light takes its colours from the drawn cover image and is three round, drifting lights; a theme change waits for the covers on screen and fades the window as one picture | active; amends D48, D77, D121 |
| D123 | One AI model select on Settings (newest Claude Opus, Sonnet, Haiku and five curated Nebius models); the manifest names no colour so Android's bars follow the system; a launch screen in the installed app; the playing cover lights the player page | active; amends D51, D101 |
| D124 | Weights are five named stops with plain story-kind names and Off as never-publish; every source has a format (Jev-classified) with search and filters; a format mix per page, a Perspective slider on general topics from Jev-rated lean, and two stories per outlet | active; amends D57, D69, D83 |
| D125 | Headings never bold (title and lead roles regular); Settings H2s at the 22px heading role; an Intelligence section for the model; Topics and sources is a search and a floating Add; a topic's format tabs, collapsed weight groups, Listen in on the card | active; amends D73, D123, D124 |
| D126 | A play queue, an Up next peek and sheet, a collapse chevron, Space to play | active; amends D102, D111 |
| D127 | Each Library row has a three-dots menu (Download, Add to queue, Regenerate, Share, Delete); a download keeps audio and page in Cache Storage, at most 10; a phone Library has no sort and one toolbar line | active; amends D123 |
| D128 | `dispatch publish` pre-narrates recent episodes (every turn and its marks, by content hash), and `podcast.yml` calls `audio.yml` after an episode commit | active; amends D82 |
| D129 | Settings restructured: a Sources or Preferences switch per topic, one voice pair, one global type mix, Theme as a select, no breadcrumbs | partly superseded by D195; amends D51, D87, D124, D125 |
| D130 | Kimi models are never offered; the Nebius five are ranked by EQ-Bench longform; a weekly scheduled check proposes a refresh by PR | active; amends D123 |
| D131 | An 8pt spacing system (4px only for named fine cases), rows that carry their own rhythm, headings never bold, enforced by `npm run design-check` and a rendered sweep | active; amends D73 |
| D132 | Two segmented controls (a choice with a check; a navigation tablist with a sliding pill) and one sheet header with Close at the end | active; amends D106 |
| D133 | The second owner round: Up next as a player tab, Settings cards, one search and chip style, Jev emoji, no Daily type | active; amends D126, D127, D129, D132 |
| D134 | The weekly writer model check is removed; the model list stays live from Nebius and the five are refreshed by hand | active; amends D130 |
| D135 | No batch API for the scheduled runs | active |
| D136 | One model orchestrator: every call through `config/models.json` (Jev, Claude, Gemini; never Opus), with fallback chains | active; replaces D46, D58, D113, D130 |
| D137 | A cost ledger records every paid call (measured where the provider reports usage), split into shared edition costs and per-user costs, reported by `dispatch costs` and on /analytics | active |
| D138 | Alexandria enriches thin text, never replaces it | active |
| D139 | Hardening: `dispatch health` reports silent faults, a daily workflow opens a `health` issue and retries once, pushes retry a lost ref-lock race, and the site reports its own errors | active |
| D140 | The design system is enforced in three layers: static rules in `npm run design-check`, a PostToolUse hook that runs them on every UI edit, and the `design-audit` agent before a UI PR; icons come only from the Phosphor package, checked by a drift test | active; amends D131 |
| D141 | The first-load budget is 130 KB | active; replaces D112's 109 KB |
| D142 | A new topic is a row at once and opens a page before the build; one save carries Jev's emoji; a removal leaves the page at once with Undo | active; amends D79 |
| D143 | Every PR gets a code review before it merges: the `review` label on opening, a hand merge after the review lands and its blocking findings are fixed | active |
| D144 | Phone sheets close by pull or tap outside and show no Close | active; amends D132 |
| D145 | Network-first page loads; a build check on return | amends D47 |
| D146 | A deploy is offered in a toast; Vitals wait | amends D145 |
| D147 | Lab probe, not field Vitals | amends D146 |
| D148 | CI on pull requests only; browser suites by path, Dependabot or label | active |
| D149 | Owner config in Postgres; a git snapshot | active; off until set |
| D150 | Paid-route caps shared in Neon | active; amends D149 |
| D151 | CI fails on a high advisory | active |
| D152 | Full-screen phone sheets show Close | amends D144 |
| D153 | Engagement and sharing | active |
| D154 | Simple Analytics and a Privacy page | active |
| D155 | Software Engineering topic | active; amends D69 |
| D156 | Field Vitals in Neon | amends D147 |
| D157 | Health: store, drift, warnings | amends D146 |
| D158 | Client faults | amends D157 |
| D159 | Deploy alerts | amends D157 |
| D160 | No passphrase | active |
| D161 | Publisher above the headline | active; amends D31 |
| D165 | Captions via Firecrawl | amends D138 |
| D166 | Firecrawl 100 a week | amends D42 |
| D167 | One shape per control | amends D72 |
| D168 | Catch up, bolt, swipe toasts | amends D52 |
| D169 | Queue gestures | amends D126 |
| D170 | Podcast structure | accepted |
| D171 | Richer covers | amends D121 |
| D172 | Store reads keep a copy | amends D149 |
| D173 | Content is data in one repository; builds ship code only | accepted |
| D175 | Ruleset on `main` | amends D143 |
| D176 | Structure phase 1 | amends D170 |
| D177 | Phone Costs switch | amends D169 |
| D178 | No island at first load | active; amends D112 |
| D180 | Eval on label only | amends D148 |
| D181 | Claude writes only | active |
| D183 | Costs read the bill | active |
| D184 | Podcast lookback | active |
| D179 | Every name says Singularity; saved state moves once | active |
| D182 | Block prompts | active |
| D185 | Repo config to store | amends D149 |
| D186 | Every control is a pill | amends D167 |
| D187 | Glyphs align by ink | active |
| D188 | Script-drawn markup | active |
| D189 | Catalogue route | active |
| D190 | Votes tune weights | partly superseded by D194 for topics |
| D191 | Structure by profile | amends D170, D176 |
| D192 | CodeRabbit review agent | amends D143 |
| D193 | Dock chevron; one-episode speed | amends D102 |
| D195 | Breadcrumb | amends D129 |
| D194 | Topic weight removed | supersedes D190 |
| D196 | Save refreshes copy | amends D172 |
| D197 | Strict publish time | amends D61 |
| D198 | Opus narration, MP3 fallback | active |
| D199 | Live content and tombstones | amends D173 |
| D200 | `fetch_via` through the store | active |
| D201 | No write-route auth until OAuth | amends D160 |
| D202 | A deploy loads itself | amends D146 |
| D203 | Lane free in the hold | amends D197 |

---

## D1: Engine runs on GitHub Actions

- Date: 2026-10-05
- Status: Confirmed. Replaces the earlier choice of a Claude Code cloud routine.
- Decision: The curation engine runs as a CLI (`dispatch run`) on GitHub Actions. Every other trigger (site button, skills, laptop) is a thin caller of the same CLI.
- Reason: Routines push to `claude/` branches by default, start with a restricted network allowlist, and expose an experimental trigger limited to 30 fires per hour. Actions is stable, has full network access and its own secret store. Model and judgment spend stays well under 1 USD a month, so the host choice is not a cost question.
- Rejected: A Claude Code cloud routine as the engine (limits above, and an agent with tools reading untrusted web text is the worst case for prompt injection). A laptop-only cron (misses runs when the machine is off). Claude API for curation (Nebius and Jev were chosen instead).

## D2: The repository lives in this folder

- Date: 2026-10-05
- Status: Confirmed
- Decision: The repository root is the owner's existing project folder on the laptop, five levels under the home directory.
- Reason: It already holds the planning files. The base path is 66 characters, and deep `node_modules` paths can approach the 260-character Windows limit, so enabling long paths is optional hardening that needs the owner's approval.
- Rejected: A shorter path elsewhere on disk.

## D3: Judge is TypeSafe Jev, writer is a cheap Nebius model chosen by a bake-off

- Date: 2026-10-05
- Status: The Jev judge stands. The writer-model half is superseded by D24.
- Decision: Typed judgments (category, craft depth, hype, sponsorship and funding flags, grounding checks) come from TypeSafe Jev. Summaries come from the cheapest Nebius model that clears the quality bar on a golden set, starting with Qwen3-32B (history: see D24). A Nebius judge stays wired as the fallback.
- Reason: Jev returns calibrated probabilities, so near-ties are handled honestly and weights can change without new calls. Writing cost is negligible at this volume, so the writer is chosen on quality and reliability with price as the tie-breaker.
- Rejected: One frontier model for both roles (more cost, no probabilities). A Nebius-only judge as the default (JSON answers without calibrated probabilities).
- Revisit if: Jev is repriced, rate-limited or withdrawn; revalidate quarterly.

## D4: Astro with React islands, Base UI and hand-written token CSS

- Date: 2026-10-05
- Status: Decided. Rationale in build-plan Section 8.1.
- Decision: The web app is Astro with React islands, Base UI for accessible unstyled parts, and CSS custom properties compiled from design tokens.
- Reason: Reading is HTML first with near-zero JavaScript. The audio element lives in a module, so it survives navigation. Base UI keeps the look ours.
- Rejected: A Vite React SPA with a router (heavier for a reading app). SvelteKit (leaves the React and Base UI ecosystem). Tailwind and shadcn (a templated look; the shadcn and Radix drawer rests on Vaul, which is unmaintained).

## D5: One MP3 per digest with word marks, from Speechify

- Date: 2026-10-05
- Status: Decided. Free-tier availability of marks is confirmed in the spike.
- Decision: Each digest has one MP3 made with Speechify `simba-3.2` and its word-level marks, plus a timeline file with an item start time for each item.
- Reason: The lock screen shows one track with a working scrubber, and every item becomes a seek target.
- Rejected: One audio file per section (breaks the lock-screen scrubber). A timeline estimated from character share as the default (kept only as the fallback).

## D6: Daily cron with a calendar-date gate, plus a Sunday weekly pass

- Date: 2026-10-05
- Status: Decided
- Decision: The schedule fires daily at 07:13 Europe/Stockholm. A regular digest is due when the Stockholm calendar date is two or more days after the last regular digest. On Sundays a weekly pass runs after the regular one.
- Reason: A delayed cron still lands on its own date, so drift never costs a cycle. 07:13 avoids the delays GitHub applies at the top of the hour.
- Rejected: Day-of-month `*/2` (resets at month end). A 07:00 cron (top-of-hour delays).

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

## D9: Repository `somesh-ks/knowledge-hub`, private

- Date: 2026-10-05
- Status: Confirmed
- Decision: The GitHub repository is `somesh-ks/knowledge-hub` and is private.
- Reason: The repo holds the taste model and summaries of third-party content, and the site is for one reader. The Free plan's 2,000 private-repo Actions minutes cover the expected use of about 120 a month.
- Rejected: A public repository. Private repos lack secret-scanning push protection on the Free plan, so gitleaks runs as a pre-commit hook and in CI.

## D10: Hosting on Vercel

- Date: 2026-10-06
- Status: Confirmed. Replaces the Cloudflare Workers static assets, R2, KV and Turnstile design. The CLI-deploy part (second bullet and the Git integration reasoning) is superseded by D25.
- Decision:
  - The site is static on Vercel. Only `/api/*` runs on the server, as Vercel Functions through `@astrojs/vercel`.
  - GitHub Actions deploys with `vercel pull`, `vercel build --prod` and `vercel deploy --prebuilt --prod`, run from `apps/web` with `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. The Vercel Git integration is not used.
  - Audio lives in a public Vercel Blob store, key `audio/<digest id>.mp3`. Hobby storage is 1 GB, so `dispatch publish --prune` deletes audio older than about 120 days.
  - `news.someshks.work` stays on Cloudflare DNS as one CNAME record, DNS only, pointing at the target Vercel shows. Vercel issues the certificate.
  - The Generate button is a Vercel Function with a scrypt passphrase check and a stateless cooldown and cap read from the GitHub API (one on-demand run per 6 hours, three per 24 hours). No KV and no Turnstile in v1.
- Reason: One platform covers static hosting, functions and public audio storage, so the Worker, R2 bucket, KV namespace and Turnstile widget drop out. The Git integration is avoided because pushes made with `GITHUB_TOKEN` do not reliably trigger it and Hobby blocks deploys whose commit author is not the account owner, which every bot commit would be. The reason for leaving Cloudflare hosting was not recorded by the owner; the points above are the technical case.
- Rejected: Staying on Cloudflare (Workers static assets, R2, KV, Turnstile). The Vercel Git integration for deploys. KV or an external store for Generate counters, and a Turnstile bot check (more accounts and moving parts; the runs list on GitHub is enough for v1).
- Residual risk: No per-IP failure counting and no bot check on `/api/generate`. The scrypt cost, a long passphrase, the unlisted URL and the run cap are the mitigations (build-plan Section 11).
- Revisit if: The Generate endpoint sees abuse, Blob Range playback fails on iOS, or Hobby limits bind.

## D11: Notification is the commit only

- Date: 2026-10-06
- Status: Confirmed
- Decision: A new digest is announced by its `chore(digest): YYYY-MM-DD` commit. There is no email, Gmail draft or push notification in v1.
- Reason: GitHub already emails the workflow owner when a scheduled run fails, and the owner reads the site daily. A Gmail draft adds a connector and permissions for little gain.
- Rejected: A Gmail draft per digest. Web push (listed as a later feature).

## D12: Voice limits confirmed

- Date: 2026-10-06
- Status: Confirmed as specified in build-plan Section 7.6
- Decision: Headline 12 words, summary 35 words and two sentences at most, why 18 words and one sentence, 8 to 12 items in a regular digest, floor 3, cap 12 (weekly 18).
- Reason: These hold the brevity bar: about two minutes to read and four to listen.
- Rejected: Looser limits, which let digests grow past the time budget.

## D13: Accounts exist

- Date: 2026-10-06
- Status: Confirmed
- Decision: Accounts at Nebius, TypeSafe, Exa, Firecrawl and Speechify already exist. Keys are stored only in the gitignored `.env`, GitHub Actions and Vercel, never in the repo or in chat.
- Reason: Phase 0 needed them before any key could be stored or any live call made.
- Rejected: Creating accounts during the spike.

## D14: Docs and config filenames are lowercase kebab-case

- Date: 2026-10-06
- Status: Confirmed
- Decision: Files under `docs/` and `config/` use lowercase kebab-case, for example `build-plan.md`, `sources.md` and `reader-prototype.html`.
- Reason: Names without spaces or capitals work in shell commands and URLs, and stay stable on case-sensitive CI runners.
- Rejected: Title Case names with spaces (the original planning files, such as "Build Plan.md").

## D15: Persisted keys are snake_case and code follows them

- Date: 2026-10-06
- Status: Confirmed
- Decision: Keys in frontmatter, JSON and state files are snake_case, and the TypeScript types in `packages/core` use the same names. Enum values keep their own spelling, such as `on-demand` and `ui-craft`.
- Reason: One spelling from file to type removes a mapping layer and a class of bugs.
- Rejected: camelCase in code with a translation layer at the file boundary.

## D16: Personal skill `sk-dispatch`, built separately

- Date: 2026-10-06
- Status: Confirmed
- Decision: A personal-scope skill, `sk-dispatch`, is built in the owner's `~/.agents/skills` with the skill creator (five-part layout, evals, Antigravity workflow). It works from any directory: it locates a checkout, or falls back to `gh` against `somesh-ks/knowledge-hub`. Actions: status, run (remote dispatch with watch), read the latest digest, learn, open the site. The in-repo skills `digest` and `learn` stay under `.claude/skills` for work inside the repo.
- Reason: Personal skills do not load in cloud sessions, and in-repo skills do not load outside the repo. Two layers cover both.
- Rejected: Exposing the in-repo skills through a personal-scope junction (the v2 plan). One in-repo skill only.

## D17: UI and sound design live in `docs/design/`

- Date: 2026-10-06
- Status: Confirmed
- Decision: The design lead specifies the interface in `docs/design/design-spec.md` and sound in `docs/design/sound-design.md`. The build plan keeps the product requirements and points to them.
- Reason: One canonical home for visual and interaction detail lets design and engineering proceed in parallel and keeps the build plan short.
- Rejected: Keeping the full UI specification inside the build plan.

## D18: UI sounds are procedural Web Audio from `@dispatch/sound`

- Date: 2026-10-06
- Status: Confirmed
- Decision: UI sounds are synthesized in the browser by the `@dispatch/sound` package. They are optional, restrained, off while narration plays unless the sound design says otherwise, respect the iOS silent switch, and are never used for high-frequency actions.
- Reason: Synthesis needs no sample files, adds almost no weight to the first load and can be tuned in code.
- Rejected: Sampled audio files (weight and licensing). No UI sounds at all.
- Revisit if: The spike shows Web Audio misbehaving on iOS with narration playing.

## D19: TypeScript 6 pinned repository-wide

- Date: 2026-10-06
- Status: Confirmed
- Decision: The root and `apps/web` pin `typescript` to `~6.0.3`, so the whole repository typechecks with one compiler.
- Reason: The Astro language tooling behind `astro check` breaks under TypeScript 7, and two versions in one workspace would check the engine and the site against different compilers.
- Rejected: TypeScript 7 with `astro check` dropped (loses type checks in templates). A different version per workspace.
- Revisit if: The Astro tooling supports TypeScript 7.

## D20: One preferences key for theme and settings

- Date: 2026-10-06
- Status: Confirmed
- Decision: Theme, interface sounds, volume and playback speed are one JSON object under the `localStorage` key `dispatch:preferences`. The inline theme script that runs before first paint reads the same key.
- Reason: One key means the pre-paint script and the settings store cannot drift apart.
- Rejected: A separate key for the theme and another for the other settings (two sources of truth for what the pre-paint script reads). A cookie (the site is static and nothing on the server reads it).

## D21: Source health lives in state

- Date: 2026-10-06
- Status: Confirmed
- Decision: Per-source consecutive failures and last success are stored in `state/source-health.json` and overlaid onto the registry when it is loaded. `config/sources.json` holds only hand-edited configuration.
- Reason: The write guard lets `run` change only `Digests/` and `state/`, and a run must not rewrite configuration the owner edits by hand.
- Rejected: Failure counters inside `config/sources.json` (the earlier design), which the guard would refuse and which would mix automated churn into reviewed configuration.

## D22: `deploy.yml` owns the deploy

- Date: 2026-10-06
- Status: Superseded by D25. As-built detail of D10, which held the commands and the reason for leaving the Git integration off.
- Decision: `deploy.yml` is a reusable workflow with its own concurrency group, `deploy`. It checks out `main`, not the caller's commit, and passes `VERCEL_TOKEN` only to the Vercel pull and deploy steps, never to the build.
- Reason: A called workflow that shares its caller's concurrency group is cancelled. The caller's commit predates the bot commit. The build runs repository code and dependencies, so it gets no token.
- Rejected: Sharing `run.yml`'s group. A token at job level. Deploying the caller's commit.

## D23: The engine tolerates audio failure

- Date: 2026-10-06
- Status: Confirmed
- Decision: When narration or the Blob upload fails, `dispatch publish` leaves the digest's `audio` as `null` and exits without failing, so the text digest ships. The next audio run narrates every digest that still lacks audio, and `run.yml` calls `audio.yml` while any digest from the last 7 days lacks it (D25).
- Reason: The briefing is read first. Audio is added to text that already exists, so a speech outage must not cost the day's digest.
- Rejected: Failing the run on a speech error. Holding the digest until audio exists.

## D24: The writer model is picked from the live Nebius list

- Date: 2026-10-06
- Status: Confirmed. Supersedes the writer half of D3.
- Decision: No model id is the default. List the models your key can use with `dispatch models`, verify the ids with `dispatch doctor --online`, compare candidates with `dispatch eval --yes --only bakeoff`, then set `DISPATCH_MODEL` and `DISPATCH_FALLBACK_MODEL`. Qwen3-32B is history.
- Reason: Qwen3-32B left Nebius's serverless tier on 2026-08-31, so any named default goes stale. Nebius's baseline limit is 60 requests per minute, which the fallback judge's batching respects.
- Rejected: Another hardcoded default (the same failure at the next retirement). Moving the writer to another provider (the Nebius account and credit exist, D13).
- Revisit if: Nebius changes its tiers or limits again.

## D25: The Vercel GitHub integration deploys the site

- Date: 2026-10-06
- Status: Confirmed, unproven until the first live deploy. Supersedes D22 and the CLI-deploy part of D10.
- Decision:
  - The Vercel project `knowledge-hub` is connected to `somesh-ks/knowledge-hub`, production branch `main`. Vercel builds on every push to `main`. Root Directory is `apps/web`, with "Include source files outside of the Root Directory" on (the default).
  - `apps/web/vercel.json` sets `installCommand` to `cd ../.. && npm ci --ignore-scripts`, `buildCommand` to `npm run build`, and an `ignoreCommand` that skips the build when a push touches nothing the site reads. Only `Digests`, `apps/web`, `packages`, `tokens`, `scripts` and the root package files matter; pushes to `state`, `config`, docs and `.github` are skipped.
  - Vercel Hobby deploys only a commit whose author is the Hobby team owner. The engine therefore commits as the owner, from the GitHub Actions variables `DISPATCH_GIT_NAME` (Somesh Kesarla Suresh) and `DISPATCH_GIT_EMAIL` (`26426782+somesh-ks@users.noreply.github.com`, the GitHub noreply address, which Vercel matches to the GitHub login). When both are unset the engine falls back to the old `dispatch-bot` identity, which Hobby blocks. Source: https://vercel.com/docs/deployments/troubleshoot-project-collaboration
  - `deploy.yml` is removed. `.github/workflows/audio.yml` replaces it: reusable (`workflow_call`) and manual (`workflow_dispatch`), with its own concurrency group, `audio`. It checks out `main`, installs, then one `Audio` step runs `dispatch publish --prune 120`, which uploads MP3s to Vercel Blob and commits and pushes the timeline metadata as the owner identity. That push triggers a second Vercel deploy that carries the audio. `run.yml` calls `audio.yml` when the Commit step's `deploy` output is true; the key keeps its name and now means "audio follow-up needed".
  - `ci.yml` has no deploy job. It still runs `changes`, `check` and `secrets` (gitleaks).
  - `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are no longer needed anywhere.
- Reason: Commits made with `GITHUB_TOKEN` are the reason D10 avoided the Git integration, but the integration reacts to the push and the commit author, not to the token. Committing as the owner satisfies Hobby and removes the CLI token, the project link and the pull, build and deploy steps. The build now runs inside Vercel, not in a workflow that held a deploy token.
- Consequence: A published digest deploys twice: once for the text, right after the Commit step, and once for the audio. The text is readable first, and the player shows no audio until the second deploy.
- Rejected: Keeping the CLI deploy (needs a token, an org id and a project id in GitHub, and a separate deploy workflow). A paid Vercel plan, which would accept bot authors. Deploy hooks (a secret URL to guard and no commit-level skip).
- Residual risk: Unproven until the first live deploy: the Vercel build of the `apps/web` workspace through the Git integration with this `installCommand`; the `ignoreCommand` on a shallow clone; Hobby accepting the owner-identity commit; two deploys per run. The GitHub login connected to Vercel must match the committer, so it must belong to the owner of the Hobby team.
- Revisit if: The first live deploy fails or skips, Hobby stops matching the noreply address, or the double deploy hits a Hobby limit.

## D26: Audio uploads use Vercel Blob OIDC credentials

- Decision: The Audio step links the project with `VERCEL_TOKEN`, runs `vercel env pull`, and the engine uploads with `VERCEL_OIDC_TOKEN` and `BLOB_STORE_ID`. `BLOB_READ_WRITE_TOKEN` still wins when set.
- Why: Vercel marks the long-lived Blob token sensitive and never shows it again; new stores default to OIDC.
- Rejected: Cloudflare R2 (more code and a new CSP rule); an upload route on the site (more code, one more secret).
- Status: unverified until the first audio run.

## D27: Owner and Dependabot pull requests merge automatically

- Decision: `automerge.yml` squash-merges a pull request when `ci` passes on its current head and the author is the owner or Dependabot. Dependabot skips major versions.
- Why: branch protection would block the digest commits that push to `main`, so the merge rule lives in a workflow instead.
- Limit: the workflow token cannot merge changes to `.github/workflows`; those merge by hand.

## D28: The audio job runs the Vercel CLI outside the checkout, and its failure is not a failed run

- Decision: `audio.yml` runs `vercel link` and `vercel env pull` in a scratch directory, takes only `VERCEL_OIDC_TOKEN` and `BLOB_STORE_ID` from the pulled file, and fails loudly when either is missing. `loadEnv` treats the `[SENSITIVE]` placeholder as unset. The Generate status endpoint reads the run record when the only failing step is the nested `Audio` step. The site build also runs when `state/last-run.json` changes.
- Why: the CLI edits `.gitignore`, which the write guard refuses; sourcing the whole pulled file lets it override secrets and mangles values with a dollar sign; the digest is already live when narration fails, so reporting "failed" invites a wasted retry; the site reads `last-run.json` for the "nothing cleared the bar" banner. This refines D25, which skipped every `state/` push.
- Rejected: `continue-on-error` on the audio job (not allowed on a reusable-workflow call and it would hide failures); exiting non-zero from `publish` on missing credentials (D23 and its tests keep narration non-fatal).
- Status: unverified until the first audio run succeeds.

## D29: Narration is hosted: a spoken version per story and a code-built host frame

- Decision: The writer returns an optional `spoken` telling (3 to 5 sentences, 40 to 95 words, 700 characters at most) beside the summary, stored on the digest item and never shown on the page. A digest item whose `spoken` fails lint, or states a number the headline and summary do not, loses `spoken` and narration reads the headline and summary as before. Around the stories, `audio/hostFrame.ts` adds an opening that names the product, the day and the count, a bridge into each later section, light connectives between stories and a sign-off (the `outro` segment). All of it is deterministic, chosen by hashing the digest and item ids, and none of it needs a model call, so old briefings gain it too. Headlines are asked to read like a person wrote them; a changelog shape ("X 2.0 released with Y") only warns.
- Why: the briefing is listened to, and a headline read as a title followed by a summary sounded transactional. Telling the story aloud and framing it fixes that without lowering the factual bar, because the summary stays the grounded text.
- Rejected: grounding the spoken text with Jev (more spend for a retelling of text already grounded; a number check is cheap); a model-written host frame (cost, and the same phrases would drift between runs); a clock-based greeting (a digest is written once and heard at any hour).
- Cost: the narration text of every briefing changes, so audio already stored for the old text is not reused. The sign-off adds one segment, so a story-by-story narration of 18 stories is 21 advanced Blob operations.
- Status: unverified against live Speechify.

## D30: The reader is called Singularity; identifiers keep `dispatch`

- Date: 2026-10-08
- Decision: Every string a reader sees or hears says Singularity: titles, the manifest, the wordmark on covers, the narration's opening line. The repository, the CLI, the `@dispatch/*` packages, `DISPATCH_*` variables, storage keys, cache names and element ids keep `dispatch`.
- Why: renaming identifiers would wipe saved preferences and playback positions and touch every import for no reader benefit.
- Rejected: a full rename.

## D31: The visual language follows Google Podcasts and YouTube Music

- Date: 2026-10-08
- Decision: Flat surfaces, hairline rows, one blue accent, Google Sans Flex in two weights, Phosphor icons from one generated source (`tokens/glyphs.json`), an outlined play chip as the one pill. Navigation is Today, Library, Create, Settings: a bottom bar below 64rem, a side column from 64rem. The Library is a cover grid with search, sort and filter. Type rule from the owner: no small text pressed against larger text, at most two type steps per block, a quiet line goes under its title with space, never above it. This updates D4 and D17; `docs/design/design-spec.md` describes the old look and is out of date.
- Why: the owner named the reference and asked for a real podcast app. A pinned reference beats a new invention.
- Rejected: Material Symbols (the owner asked for Phosphor); a page called Archive (no podcast app has one); reading time and per-section clocks in the reader (small text beside headings).
- Cost: the first-load JavaScript budget moved from 100 to 102 KB when the bottom bar became a full transport.

## D32: The player is one always-mounted surface, without Base UI Drawer

- Date: 2026-10-08
- Decision: A dock, a stage and a page live in one persisted island with no portal. One progress value drives the travel in CSS; a state machine owns open, drag and close; `inert` gives modal scope. Below 40rem the dock rides the page; from 40rem the dock stays put and the page rises behind it. The dock carries seek, a clock and volume on wide screens.
- Why: the old sheet lived in a body-level portal that a client-side navigation destroyed while the controller still thought it was open, which is what "stuck" was. Drawer cannot model a bar that is non-modal at rest and modal when open.
- Rejected: native `dialog` (cannot go from non-modal to modal without closing); a view transition for the cover (not interruptible).
- Status: Chromium verified by its suite; two mouse-drag tests failed on desktop and WebKit is unverified.

## D33: Narration is made on Play, story by story

- Date: 2026-10-08
- Decision: A briefing has no audio until someone plays it. Play asks `GET /api/narrate` for the briefing's segments (an intro, one per story, a sign-off), which costs no store operation because each segment's address is computed. The player tries each address and `POST`s only for a file that is missing, which needs the passphrase. The client presents the files as one track on a fixed timeline (`narration/trackAudio.ts`) and makes the next few ahead of the playhead. A briefing is charged whole to the monthly budget the first time any part of it is narrated. This supersedes D5 for new narration; the whole-briefing path and `audio.yml` remain.
- Why: a whole briefing took too long to synthesize inside a function for the first Play to be audible, and narrating every run spent characters on briefings nobody played. A byte stream to the browser would have lost scrubbing, story jumps and resume.
- Rejected: streaming audio to the browser; a manifest file (read-modify-write races between segments); listing the store on lookup (an anonymous caller could exhaust the Hobby Blob quota of 2,000 advanced operations a month).
- Open: a reader without the passphrase cannot make audio. Decide whether the engine should narrate each new briefing once, so the Play path never dead-ends for a wider audience.
- Status: unverified against live Speechify and Blob.

## D34: Stories are told in four beats; the why line is no longer written

- Date: 2026-10-08
- Decision: A story is a headline of at most 12 words and a summary of three or four sentences, 25 to 80 words: what happened, one number, why it matters, the catch from the source. Two sentences are accepted so a thin source is not padded. `why` stays optional in the schema so old briefings parse. Supersedes D12.
- Why: the owner wanted to understand a story cold, in the register of The Friday Checkout. Two sentences left no room for the number or the catch.
- Rejected: a required fifth field; migrating old briefings.

## D35: A Tech releases section, ranked by launch scale, with its own allowance

- Date: 2026-10-08
- Decision: Category `consumer_tech_releases` feeds a Tech releases section of up to 5 stories on top of the cap, never promoted to Top picks. The judge answers a five-level `launch_scale` question, used as the depth factor with a floor of 0.35. Tech-hinted sources get their own prefilter pool, ranked by how many outlets cover the same launch (`dedupe/storyCluster.ts`). Aggregated items are credited to their publisher.
- Why: launch news shows no technique, so craft depth scored every launch at the floor and the keyword prefilter dropped it first.
- Rejected: sharing the cap of 12; scoring tech by craft depth; a model call to rank launches before the judge.
- Cost: both question hashes changed, so the first run re-judges every cached item once.

## D36: Topics and sources are data the owner edits from the app

- Date: 2026-10-08
- Decision: `config/topics.json` holds the built-in categories and any topic the owner adds. A custom topic is judged by a Jev fit question built from its name and description, cached per topic in `state/topic-judgments.json`, scored as weight times fit, and gets its own section. The built-in category question and its hash are untouched. Sources gain an overlay, `config/sources.user.json`, so regenerating the registry never clobbers app edits. `dispatch sources suggest` finds feeds for a topic through Exa, validates them, scores them, and adds the top three on probation. The app edits config by dispatching `config.yml`, which runs `dispatch config apply` and commits through the write guard.
- Why: a new topic must not need a code change, and a Contents-write token on Vercel would be a far larger blast radius than dispatching a workflow.
- Rejected: one enum option per topic (re-judges everything on every edit); committing from the function.
- Cost: an edit takes about a minute to show, since the site is rebuilt.
- Status: unverified live (Jev fit questions, Exa discovery, the workflow).

## D37: Custom podcast episodes live in `Podcasts/` and are built by a workflow

- Date: 2026-10-08
- Decision: The Create page posts a request (topics, length of 3 to 15 minutes, format: readout, discussion or headlines, look-back window, tone) to `/api/podcast`, which dispatches `podcast.yml`. `dispatch podcast` selects stories from published briefings in the window, has the writer produce a script of turns, checks every number against the stories, and commits `Podcasts/YYYY/MM/<id>.md`. Episodes appear in the Library and play through D33, one segment per turn, with a second voice for the second host (`SPEECHIFY_VOICE_ID_B`).
- Why: a function is too short-lived to write a script, and reusing judged, summarized stories makes an episode cost one writer call.
- Rejected: storing episodes as digests (a digest needs three items and a date id); a fresh fetch and judge per episode in the first version.
- Limits: 2 episodes a day, a 30 minute cooldown, 15,000 characters per episode.
- Status: unverified live.

## D38: Subagents are few, narrow, enforced and capped

- Date: 2026-10-08
- Decision: Ten agents, each with one job, a model tier, `effort`, `maxTurns` and (except `general-purpose`) a tool allowlist in its frontmatter. User level (`~/.claude/agents/`): `Explore` (overrides the built-in, haiku), `general-purpose` (overrides the built-in, sonnet, core tools and web only, no MCP because the full MCP schemas cost about 289k tokens per call; 118 of 214 past calls used it on the main model; the `claude` agent covers MCP tasks), `scout` retired, `planner`, `reviewer`, `ui-critic`, `motion-reviewer`, `researcher`, `deep`. Project level (`.claude/agents/`): `dispatch-verify` (haiku; typecheck, tests, lint, build, 102 KB budget) and `dispatch-worker` (sonnet; one workstream in a worktree, never merges). Read-only agents run Bash through `~/.claude/hooks/readonly-bash.mjs`. No agent preloads a skill and no plugin is enabled for them. Subagent cache TTL is 1 hour; at most 4 concurrent agents, depth 1. Effort is chosen once at first launch (rule in the global CLAUDE.md). `/close-session` is a main-thread skill because a subagent cannot see the conversation.
- Why: delegation costs about 4x chat tokens and multi-agent about 15x, so an agent earns its place only by reading a lot and returning a little. Prose "read-only" did not stop `deep` and `motion-reviewer` inheriting every tool.
- Rejected: preloading design skills into `ui-critic` (full text on every run); enabling `motion-design` for `motion-reviewer`; agent teams; a docs-keeper agent.
- Status: active. Hook, tool allowlists, overrides and `dispatch-verify` verified in a fresh session; the rest is listed in state.md.

## D39: Five topics, Top picks always included, General and Customized audiences

- Date: 2026-10-08
- Decision: Sections are Top picks, Design, Design Engineering (`ui-craft`), AI Products (`ai`), Tech Product Launches (`tech`) and Trending. `research`, `launches` and `watch` stay known ids with their old titles so published briefings render, but receive no stories: HCI research goes to Design, developer tool launches to Design Engineering, a video to the section of its topic. Design and Trending ship with the app as topics with origin `app`: judged by the D36 fit question, switchable off, not removable, not counted toward the 12 custom topics. Design has five feeds, Trending seven (`APP_TOPIC_SOURCES` in `sources/seed.ts`). `config/source-catalog.json` offers about 44 feeds to the add-topic flow; nothing in it is fetched until added. A podcast request gains `audience`: `general` explains terms and drops shorthand, absent means `custom`. Every episode includes the window's Top picks whatever topics were chosen.
- Why: the old topic names were vague, and a casual listener needs a mode that does not assume a design engineer.
- Rejected: moving old digests to the new sections; a Firecrawl source for either new topic.
- Cost: Design adds 5 and Trending 7 feed fetches a run (12 total, no Firecrawl); up to one extra Jev request per gated item for each shipped topic. Category question hashes are unchanged.

## D40: Trending is ranked by coverage; discovery only suggests

- Date: 2026-10-08
- Decision: Trending sources are tagged `trending` and enter no other section. `clusterStories` has a second `news` profile (names and numbers weigh double, 48 hour window); the number of distinct outlets is `signals.coverage`. One outlet never qualifies (prefilter drops it; `coverageFactor` is 0). Score is weight x fit^1.5 x coverageFactor (0.7 at two outlets, 1 at four). Trending has the D35 allowance of 5 on top of the cap and is never a Top pick. Coverage is computed by code; the only model call is the existing fit question, which also rejects non-news. `dispatch sources suggest` now records up to six candidates as `suggested` and adds none; old `added` entries still parse. `dispatch config apply --op` accepts one op or an array of 1 to 8 (`ConfigOpBatch`), validated whole, applied in order, all or nothing, one commit.
- Why: coverage is the honest signal for "trending" and costs nothing; auto-adding sources was noise and risk the owner did not ask for.
- Rejected: a model call to rank stories; Google Trends as a signal.

## D41: The passphrase step is switched off, with its code kept

- Date: 2026-10-08
- Decision: `PASSPHRASE_REQUIRED` in `apps/web/src/lib/access.ts` is false. The four routes hand their handlers a check that lets a request through, Play narrates without the sheet, and Create, Generate and the Topics and Sources save show no prompt. Same-origin checks, cooldowns, daily caps and the monthly narration budget stay enforced. Setting the constant to true restores every prompt and check. Tests of the prompts are kept and skipped while it is off.
- Why: the owner asked for it ("remove passphrase for now, but we can have the code for future") after a failure that was blamed on the passphrase and was in fact the site's GitHub token lacking access to the repository.
- Cost: anyone who can open the site can start a briefing, an episode, narration or a config edit, inside the caps. The owner accepted this.
- Rejected: deleting the passphrase code; unlocking one device at a time (offered, not chosen).

## D44: An episode can be deleted, or regenerated with the listener's feedback

- Date: 2026-10-08
- Decision: `podcast.yml` still passes one JSON input to `dispatch podcast --request`; it is now a new episode (no `action`), `{"action":"delete","id"}` or `{"action":"regenerate","id","feedback"}` (`PodcastCommand` in core; feedback 1 to 500 characters, control characters become spaces). Delete removes `Podcasts/YYYY/MM/<id>.md` and commits `chore(podcast): remove <id>` through the existing `podcast` allowlist (`Podcasts/` only, unchanged). Regenerate reuses the stored request of the old file, writes a new episode with a new id, removes the old file after generation succeeds, and commits both in one `feat(podcast): replace <old> with <new>`. The feedback reaches the writer as an optional `ScriptInput.feedback`, rendered in the user message inside the untrusted-text wrapper and never overriding the rules about facts and numbers. The new file records `replaces` and `feedback` (optional, so old files parse). `--dry-run` generates or reports and removes nothing.
- Why: the owner wanted to delete an episode after it is made, and to regenerate it with extra feedback when the content is not right.
- Cost: a regeneration is a full writer run. A failed one leaves the old episode in place.
- Rejected: editing an episode in place (script, audio and checks are made together); keeping the old episode beside the new one.

## D43: General episodes are built from general-news feeds, ranked by coverage

- Date: 2026-10-08
- Decision: a request with `audience: "general"` takes `topic_ids` only from `GENERAL_TOPICS` (world, business, technology, science, culture, sports; validated in core) and is built from `config/general-feeds.json`: 3 or 4 open category feeds per topic (NPR, ABC, CBS, Sky, PBS, BBC, Al Jazeera, ScienceDaily, ESPN, The Guardian), read with the engine feed reader, kept inside the request window (feeds hold a day or two; a longer window is not an error), clustered across outlets with the `news` profile of `clusterStories`, ranked by outlets covering the story, then recency. The top stories across all chosen topics (a quarter of the length, 1 to 4) open the episode; the other slots go round-robin to the topics. Story text is the feed title and description. No briefing story, Jev, Exa or Firecrawl: the one model call is the script writer, with the D39 `general` prompt and the same number check. If every feed fails, or fewer than 3 stories are found, the run fails with a plain message and never falls back to briefing stories. `custom` and absent audiences are unchanged. Also for both kinds: the writer is asked for 90 to 100 percent of the length and a reply under 80 percent is sent back (up to 3 calls), then kept with `short_by_chars` recorded; a chosen topic with no story in the window is named in the result, and a request whose topics all have none fails instead of becoming a top-picks-only episode.
- Why: the owner wanted General mode to cover the topics of a general news podcast, with few sources so there is no noise and no Firecrawl rate limit.
- Cost: 4 to 24 feed fetches and one writer call per episode (up to 3 when the script is short); no key beyond the writer.
- Rejected: briefing stories for General; scraping or search sources for general topics; a model call to rank or summarise stories.

## D42: One Jev request per item, and a per-run Firecrawl ceiling

- Date: 2026-10-08
- Decision: An item that needs the six main questions and topic-fit questions gets one Jev request with both sets (`judge/combinedJudge.ts`); the answers are split into the same cache entries as before, so no hash changed. An item from a source tagged for a coverage topic (Trending) with no category hint is asked only its fit question and scored with a neutral main judgment that is never cached. Firecrawl is held to 30 requests a run (`fetch/firecrawlBudget.ts`): 16 for listing pages, the rest for scrapes. Listing sources over the allowance wait, oldest `last_ok` first, so the skipped set rotates, and the skip is recorded. The weekly pass reuses the regular pass's pages. The scrape fallback runs only for selected items and not when 600 characters are already in hand. A 429 backs off; three stop Firecrawl for the run. Requests per service go to `.cache/run/spend.json`, the run report and `state/last-run.json` (`spend`).
- Why: the owner asked to keep paid calls low without losing curation quality.
- Rejected: sharing one request across items (Jev takes one item's state); cutting sources.
- Cost: a Trending item loses the hype, sponsored and funding penalties; an item with 200 to 599 characters of text no longer gets a paid scrape; a Firecrawl source skipped for the ceiling waits a run.

## D45: The briefing's hour, cadence and topics are set in Settings

- Date: 2026-10-08
- Decision: the hour (Stockholm), the cadence (1, 2, 3 or 7 days) and the covered sections of the scheduled briefing live in `config/schedule.json`, written by the `schedule.set` config op from Settings, Schedule. A missing file means 07:00, every second day, every enabled topic. `run.yml` carries one schedule entry per hour, and its job runs only for the entry that equals the repository variable `RUN_CRON`, which the site sets when the hour is saved.
- Why: the owner asked to choose when the briefing is made and what it covers, from the app. The repository is private, so an hourly job that gates itself would bill up to 744 minutes a month; a job skipped by its `if` starts no runner and costs nothing.
- Cost: the hour lives in two places (the file for display, the variable for the trigger). If the variable cannot be written the page says so and the rest is still saved. GitHub can still fire a schedule hours late.
- Owner: add "Variables: Read and write" to the site's GitHub token, and merge the workflow change by hand.
- Rejected: an hourly job with a gate (minutes); Vercel Cron (once a day on the Hobby plan, static, imprecise); letting the app edit the workflow file (the token cannot change workflows).

## D46: The writer's provider and model are chosen in Settings

- Date: 2026-10-09
- Decision: the provider (Nebius, the only one) and the model of the writer live in `config/writer.json`, written by the `writer.set` config op from Settings, Model. A missing or unreadable file means "Automatic". The engine tries, in order and without repeats, the Settings model, `DISPATCH_MODEL`, then `DISPATCH_FALLBACK_MODEL`; a Settings model that fails for any reason falls through. The live list comes from `GET /api/models`, a site function that asks Nebius with a server-side key and is cached for an hour.
- Why: the owner asked to pick the model, and the provider, from the app. D24 already said model ids change and must come from the live list; this puts that list where the choice is made.
- Cost: the provider key must also be on Vercel, a second place to rotate it. Until it is, the page offers the saved model and a typed id. One failed call on the Settings model moves the rest of that run to the environment's model.
- Owner: run `npm run secrets:push` once.
- Rejected: writing the `DISPATCH_MODEL` repository variable from the site (needs the token's Variables permission and gives no fallback); a list saved by the engine at each run (stale by up to two days, and a new file for the run's write guard to allow); a native select of sixty ids (no filter).
- Supersedes: the "set the two variables" step of D24 for choosing a model. The variables remain the fallback.

## D47: A move between pages is answered from a saved copy and swapped at once

- Date: 2026-10-09
- Decision: the service worker answers a move inside the app (the client router's fetch, or a prefetch) from a copy of the page saved in the last ten minutes, and asks the network behind it; a page load still waits for the network. A changed page is reported to the page on screen, which refreshes quietly if nobody has touched it. A new `/latest.json` makes every saved page old again, except briefings. Once the page is idle, the router's view transition is replaced for a move by an immediate swap, and the incoming page fades up by itself in 100 ms (150 ms with the 8px settle into or out of a briefing). The theme change keeps its view transition.
- Why: measured on production, a move took about 400 ms to a fully drawn page with the new page ready after 70. The network was not the cause on a fast connection; the transition was, and it was not the designed one (see learnings). A view transition also spends two frames taking pictures before anything moves. After the change the same script measures 2 ms for the page, 32 ms to the new page on screen and 132 ms fully drawn.
- Cost: `document.startViewTransition` is stood in for, for one call, during a move; a move in the first moment after a page load still uses the browser's transition. A saved page can be up to ten minutes old for one view before the quiet refresh. The service worker is more than "offline reading and nothing else" now.
- Rejected: network-first with a shorter wait (still a round trip per move); stale-while-revalidate with no age limit (a two-day-old Today for a moment); keeping the view transition with shorter timings (still two frames late).
- Supersedes: the "fade through" between destinations described in the stylesheet before this date.

## D48: One shader: a light in the cover's colours behind the header, on a GPU only

- Date: 2026-10-09
- Decision: the header of Today and of an episode has a soft field of light in the cover's colours behind it. A CSS layer is the light everywhere; where WebGL draws on a GPU a small canvas (128px on its long side, scaled up, which is the blur) fades in over it and drifts through one cycle in 40 s or more, at 30 frames a second at most, only while the header is on screen and the tab is visible. Reduced motion and data saver get one still frame. A software renderer, a missing or lost context and forced colours get the CSS layer or nothing. The layer is the header's own box and fades to nothing on all four sides.
- Why: the owner asked for a clever but mild use of shaders. The cover is the one thing that differs from day to day, so its colours are the only decoration that says something.
- Cost: 325 bytes of eager JavaScript on those two page types and 2.3 KB loaded on idle. The canvas path cannot run in CI, where Chromium draws on the processor; it is checked by a script in a real window. The play chip stands on the page's surface inside a header, because its accent text fell short of 4.5:1 over the light.
- Rejected: a shader behind the whole page or the navigation (not mild); a CSS `filter: blur` (repaints, and costs more than the canvas); a library (the budget has 0.1 KB left); drawing on a software renderer (a warning per frame and a busy processor for a decoration).

## D49: One Podcast settings page: Daily, Weekly and Custom profiles, a shared writer, topics and sources clubbed

- Date: 2026-10-10
- Decision: Settings has one "Podcast" row. `/settings/podcast` holds one configuration with three profiles (Daily: hour and cadence; Weekly: day and hour; Custom: the Create panel's defaults), each with a Type (Readout or Discussion), a Length and Voices (Ada, and Leo for a Discussion), and one shared Model (a vendor select, Nebius or Anthropic, then a model combobox). Topics and sources are one tab, `/settings/podcast/topics`: each topic has a weight (a hint; the model still decides per run) and its sources with a 0 to 5 quality score, and an Add source panel previews a URL (name, icon, feed, score) before it is added. Headlines is not offered for new requests.
- Why: the owner called Settings "a mess" and asked for one podcast configuration, a clubbed topics and sources view with a rating per source, a discoverable Add source, and a voice choice for Daily, Weekly and manual episodes.
- Cost: the daily Type is saved but the audio workflow does not apply it (a workflow change); a weekly run at its own hour needs a `RUN_CRON_WEEKLY` variable in `run.yml`; `/api/source-preview`, `/api/site-icon` and `/api/voices` are open like `/api/models` (SSRF-guarded, cached); the heaviest page has 0.3 KB of budget left.
- Rejected: favicons straight from each host (needs `img-src https:`, loosening the policy; they go through `/api/site-icon`); per-profile models (the owner asked for one vendor and model in general); a quota per topic (the weight is a hint).
- Supersedes: the Schedule and Model pages (D45, D46 placement), the separate Topics and Sources pages.

## D50: The open player: a speed slider, Chapters or a Speechify-style transcript, word marks stored beside each segment

- Date: 2026-10-10
- Decision: the open player has no header (no "Now playing", no chevron); closing is a drag, the bar, Back or Escape, with a "Close the player" button that shows only on keyboard focus. The speed is a button between the skips (a pill under play on a phone, so the five transport controls keep one axis) that opens a slider from 0.5x to 2x in steps of 0.05; the store and preferences accept any step in that range. An episode with chapters shows a Chapters / Transcript switch. The transcript is plain text with a small speaker name, as in Speechify: said words in full ink, the rest muted, the spoken word on a soft fill, a tap on a word plays from it. Speechify's word marks are stored beside each segment's audio (`.marks.json`) and served by `GET /api/narrate-marks`; where a segment has none, word times are estimated from the turn's span by word length. Timeline markers are one small dot per story.
- Why: the owner asked for each of these, and for a mobile layout that is clean and optically balanced.
- Cost: a newly narrated segment costs 2 advanced Blob operations instead of 1 (about 48 newly narrated briefings a month on the Hobby quota); the owner accepted it. A screen-reader user on a phone has no visible close control, only the focus-revealed button.
- Rejected: fetching marks from the Blob host in the browser (needs `connect-src` loosened); returning marks from the narration lookup (a store read per segment on every lookup); the speed beside play on a phone (pulls the row off its axis).

## D51: Settings is two levels and saves itself; every select opens one drawn list

- Date: 2026-10-10
- Decision: The Settings index lists one row per page, each saying what it holds now: Daily, Weekly, Custom, Topics and Model under Podcast; sounds, the theme and About stay on the index. Each page has one job: `/settings/daily`, `/settings/weekly` and `/settings/custom` hold one profile each (Weekly is one switch while it is off); `/settings/model` the writer; `/settings/topics` lists the topics, each leading to its own page (`/settings/topics/<id>`, and `/settings/topics/other` for sources with no topic) with its switch, its weight and its sources. A page's title carries the way back: "Settings > Daily", the parent muted at the title's own size, so there is no back button, no tab bar and no small line above a title. Changes save themselves (`scripts/autosave.ts`): a change waits until the controls have been still for 1.2 s, then every pending edit goes in one request (up to eight ops); a 429 waits as asked and then sends whatever is pending by then; a removal waits 5 s with Undo in the toast; hiding or leaving the page sends what is waiting. The status is the app's toast: Saving, Saved, or the error with Retry. Every select (Settings, Library, Topics, the Create panel, Add source) opens the model list's drawn list through `appearance: base-select`, set in one place (`primitives.css`); browsers without it keep the native list. The model field reads as a select: the hand cursor at rest, the caret once focused, and a press opens the whole list.
- Why: the owner called the podcast settings complex with too many controls, asked for breadcrumbs instead of the back button, for autosave instead of Save, and for every dropdown to look like the Anthropic model list.
- Cost: topics are one level deeper; a removal takes 5 s to send; there is no Discard (a change is undone by changing it back, a removal by Undo); each save is still a `config.yml` run and a commit, about a minute to show.
- Rejected: saving on every change with no settle (a commit per step, and the server's 10 s cooldown); keeping Save for removals only (two ways of saving); a breadcrumb in small text above the title (the owner's type rule); the score filter and sort on Topics (sources are already split by topic and listed best first); a scripted select for every browser (weight on every page that has one, and `base-select` covers Chromium and Safari 27).
- Supersedes: D49's page layout (one Podcast page with a profile switch and two tabs). Its data model (profiles, one shared writer, topics with weights and scored sources) stands.

## D52: On a phone the Create button floats only on Today and the Library, extended until you scroll

- Date: 2026-10-10
- Decision: Below 64rem the floating Create button is rendered only on Today and the Library, the two lists where making an episode is the next thing to do (`BaseLayout.astro`, `data-fab` on the root). Today includes the latest briefing at its dated address (what Share sends), which the navigation marks as Today: it has the button, and pressing Today there goes to its top. Settings, briefings, episodes, Create itself, offline and not found have none, and keep no room for it; the side column carries Create Podcast on wide screens everywhere. Where it shows, it is extended (the plus and "Create") at the top of the page and while scrolling up, and folds to the plus while scrolling down (`scripts/fabScroll.ts`, loaded on the first scroll). Pressing the tab of the page you are on scrolls it to the top instead of loading it again. Back dismisses what is on top before it leaves the page: the Create panel, the Add source panel and the open player; section tabs replace the history entry instead of adding one.
- Why: the owner asked for Android's rule for a floating action (on the screens whose primary action it is, not on Settings) and for patterns that make the phone layout feel native. An unlabelled plus says nothing about what it makes; the extended button says it at the top and gets out of the way while reading, as Gmail's Compose does.
- Cost: a few hundred bytes of script after the first scroll; the button changes width while scrolling (reduced motion: no width animation).
- Rejected: hiding the bottom bar on scroll (Material's navigation bar stays, and playback controls dock on it); a haptic on press (Android only, and the app already has interface sounds); pull to refresh (it would restart a briefing mid-listen, see shell.css).
- Supersedes: the part of the Create placement (state.md, D31 era) that put the floating button on every page.

## D53: First-load JavaScript budget 110 KB, kept as low as the code allows

- Date: 2026-10-10
- Decision: `FIRST_LOAD_BUDGET_BYTES` is 110 KB gzipped (was 104). The budget is a ceiling, not a target: a change that adds first-load script says what it costs, and anything a first visit does not need loads on demand, as the Podcast and Topics editors, the floating button's fold and the navigation boost already do.
- Why: the owner allowed 110 KB and asked to keep it low. The branch measured 103.2 KB on /library with the design pass, 0.8 KB under the old ceiling, so every further change would have been a fight over a few hundred bytes.
- Measured split (2026-10-10, /library): React's client 63.4 KB plus react 3.2 and react-dom 1.4; the player runtime 12.4 (store 2.7, reader sync 1.5, open-player controller 1.4, runtime 1.0, media session 0.7, reader math 0.7, surface view 0.6, switchable audio 0.6); Astro's router 4.2 with prefetch 1.1; the player island 3.8; the layout script 2.5; the sheets island 1.7; icons 1.5; the rest under 1.4 each. Own code is about 27 KB; React is the floor while it loads with every page.
- What could still come off, largest first, in [first-load-js.md](engineering/first-load-js.md): React and the player and sheets islands only when there is something to show (about 76 KB off a first visit with nothing playing); the open-player machinery and media session on first play (about 4 KB); the service worker code after load (about 0.2 KB, done).
- Chosen by the owner's delegation (2026-10-10): React keeps loading on idle. On-demand would move a download that never blocks first paint (LCP is CSS, the font and the HTML) to the first press of Play or Create, the app's main actions, which would then wait a network round trip on a cold visit; the service worker serves everything from cache on later visits either way. The open-player machinery stays eager too: about 4 KB against a facade over the gesture code the bar and the page share. Reopen if first visits on mobile data become the measure that matters.
- Rejected: preact/compat (declined by the owner on 2026-10-10); dropping hover prefetch (1.1 KB) or the router (4.2 KB), which make moves between destinations immediate (D47).

## D54: Form fields carry a 3:1 outline; in the player only Play is in full ink

- Date: 2026-10-10
- Decision: Text fields and form selects (Settings, the Add source panel, the Create panel, the Library search) draw their outline in `--field-border` (grey-600: 3.49:1 on the light page, 4.37:1 on the dark) instead of the 1.3:1 hairline, and every field takes the full ink on hover. Toolbar chips, the view switch and the Library sort keep their hairline: their own words say what they are. In the open player, Previous and Next take the muted ink the skips already had, so Play is the one control in full ink.
- Why: the owner left the open decisions to the design pass. The fields have no fill, so their outline is the only thing that shows a field is there; WCAG 1.4.11 asks 3:1 for it, Material's outlined fields meet it, and the token already existed unused. The transport row read dark, light, dark, light, dark (ink mass 156, 100, play, 100, 156); with the helpers equal, the row reads as one control and its helpers.
- Cost: fields look firmer than before; a muted Previous and Next read as secondary, which they are.
- Rejected: a filled field with no outline (a second surface colour on a page that has none); full ink for all five transport controls (Play then stands out by size alone).
- Refined 2026-10-10: in the dark theme a disabled Previous or Next was only 1.67:1 from the muted skips beside it and read as enabled, so the dark disabled ink is one step dimmer (grey-650): 2.37:1 from muted, as the light theme's pair is 2.29:1.


## D55: A source's score is out of 3: health, quality and trust, combined so a weak part cannot be bought back

- Date: 2026-10-11
- Decision: Each source's score is 0 to 3, from three parts of 0 to 1 (`packages/core/src/sourceScore.ts`).
  - Health: does the feed keep working? Failed fetches in a row (60%) and how recently a fetch last worked (40%).
  - Quality: is what it sends good enough to use? Three quarters yield (the share judged that passed, against a half, and the share published, against a quarter) and one quarter volume (items published in the 30-day window, against four).
  - Trust: the share of checked items the judge flagged as hype or sponsored, against a half: none flagged is 1, half or more is 0. Funding is a subject, not a trust problem, and is not counted. Only items that were asked the flag questions count: `asked` is the judged items less those that got a neutral topic-only judgment (the judge stage lists them as `neutral_ids` in `judged.json`), and `asked` and `flagged` sit in `state/source-stats.json`, halved with the 30-day window like the other counters. Under 10 asked items trust is "not measured yet" and the score comes from health and quality alone.
  - The score is three times the geometric mean of the measured parts, to one decimal (`combineScoreParts`, which the preview uses too): a weak part pulls it down more than a strong part lifts it, and a part at 0 makes it 0. Labels: Excellent 2.7, Good 2.1, Fair 1.5, Poor below. Under 10 judged items a source is New and has no score. Worked cases: healthy and clean with nothing published is 0.0 (Poor); 1 of 40 published is 1.7 (Fair); parts of 0.8 each score 2.4 while 1, 1 and 0.4 score 2.2; a clean source that passes half its items and never makes a briefing is 2.0 (Fair), kept on purpose, since its items clear the judge and lose only on the cap.
  - A row shows three pips filled to the score, the number and the label. The edit panel shows each part as a bar with two decimals (trust in words while it is not measured) and a sentence naming the weakest part. The Add source preview scores a site on the same scale from what one visit can tell: a valid, fresh feed for health (a page with no feed gets 0.3), posting frequency and a title for quality, https and a site that names itself for trust.
- Why: the owner asked for a score out of 3 that assesses a source's health, the quality of its content, its accuracy and whatever else matters. Health and trust are hygiene; quality is the value. Added up, the parts let a clean source that never reached a briefing score 2.0 (Fair) and one with 1 of 40 items published score 2.2 (Good). The parts are complements, so they are combined as the UN's Human Development Index has combined its three since 2010, by a geometric mean. Accuracy in the strict sense (are the claims true) needs a fact check per item, which nothing in the pipeline does; the judge already flags hype and sponsorship per item, the measurable part of it, so the part is called Trust and says what it counts.
- Cost: trust is not measured for a source's first ten checked items after the deploy, nor ever for a source that only feeds a coverage topic (its items get only the fit question). Real stats began on 2026-10-09, so every source reads New until it has 10 judged items. The thresholds are a first guess.
- Reassess: once 20 or more sources have a score, compare the labels with the sources the owner would keep, and move the thresholds before the formula.
- Rejected: a sum of the parts (it trades hygiene for value); the weakest part alone (a source weak in one part would score the same as one weak in all three); a fact-check pass (a model call per item for one part of a score); stars (five of them read as a score out of 5).
- Supersedes: the 0 to 5 score of D49.

## D56: One panel adds a topic or a source and edits a source; Settings has no Custom page

- Date: 2026-10-11
- Decision: Settings' Topics row and page are "Topics & Sources". The page has one outline button, Add ("Add a topic or a source"), that opens one panel (a full-screen sheet on a phone, a side panel from 40rem) with a Topic / Source segmented control under its title.
  - Topic has two steps: the name, what should count and keywords; then up to six catalogue sources whose tags meet its words, leaving out sites already among the sources, each a row to tick. "Add topic and 2 sources" sends one request: `topic.upsert`, then a `source.add` per ticked source with the new topic's id.
  - Source takes an address, looks it up after a 400 ms pause (at once on paste or Enter) and files it under the chosen topic. A topic's own page keeps an outline Add source button that opens the panel on Source with that topic chosen.
  - A source's tile and name are one button that opens the panel to edit it: its name, its topic (one select; Other sends an empty list), a link to its address, and the parts of its score. A new name shows at once; a move says "Moves to X after the next build." Both go as `source.update` (id, name, topic_ids): a seed source keeps the change in its override, an added source is changed in place. A move takes effect in a run: when an override sets a source's topics they decide its category hint, which prefilter and dedupe read (the first built-in category among them; none when they name only custom topics or none). Removing a custom topic strips it from every override; a source left with no topic there goes back to its own topics and hint.
  - Each row has an Open in a new tab button beside its score. A site with no icon shows the first letter of its name in its tile; the site's icon covers the letter once it loads.
  - `/settings/custom` is gone and redirects to `/create`: an episode on request is set up in the Create panel, which still starts from `custom` in `config/schedule.json`.
- Why: the owner asked to add a topic and a source in the same sidebar and sheet, separated by a segmented selector; for good sources as the next step of adding a topic, picked and added at once; to edit existing sources and open their address; for an outline Add source button; for the menu to read Topics & Sources; and said the Custom settings repeat what the Create panel already covers.
- Cost: Create's starting type, length and voices can now be changed only in `config/schedule.json`. A rename or a move shows in its final place after the next build. The panel files a source under one topic, so moving a source that feeds several replaces them with the one chosen.
- Rejected: separate Add topic and Add source buttons (two ways in to one job); the inline Add topic form (no room for the suggestions step); editing the address (a different address is a different source: remove it and add the new one); "Accuracy" as the name of a score part (D55).
- Supersedes: D51's Custom page and its row; D49's Add source panel and the inline add-topic form.

## D57: A topic's page edits its details and adds the sources that suit it; topics are listed by name

- Date: 2026-10-11
- Decision: A topic's page has an Edit topic row that opens the Topics & Sources panel on the topic's details, filled in. A topic the owner made can change its name, what counts and its keywords; one that ships with the app shows its name and what counts read-only and can change its keywords, since the engine keeps a shipped topic's judge question. The second step offers the catalogue sources that suit the topic and are not among its sources yet. Save sends `topic.upsert` with the new details and the switch's current state, then a `source.add` per ticked source, as one request, and the switch's own op takes the new details so a later toggle never brings back the old ones. A renamed custom topic's own section takes the new name, unless its title was set apart. The Topics list and the panel's topic choices are always by name; Other comes last, and a topic that never publishes sorts in with the rest.
- Why: the owner asked to edit topics and their sources, and to always see the topics in alphabetical order. The add flow's two steps are reused, so there is one way of working, and an existing topic gets the same instant add of suitable sources as a new one.
- Cost: a pure rename takes Next and then Save. The new name shows in the list after the next build.
- Rejected: editing a shipped topic's name or what counts (it would change how the topic is judged, and the engine refuses it); suggestions shown on the topic page itself (weight on every load for a choice made rarely); keeping never-publishing topics last (the owner asked for alphabetical, always).

## D58: The Model page offers six top Nebius writers by name, live list or not

- Date: 2026-10-11
- Decision: With Nebius as the provider, the Model list opens with a "Top models" group of six curated writers, best first (`NEBIUS_TOP` in `lib/modelId.ts`): GLM-5.3, Kimi K3, Kimi K2.6, DeepSeek V4 Pro 0813, DeepSeek V4.1 Flash and Qwen3.5 397B. Each is a Token Factory routing key checked on 2026-10-11, ordered by EQ-Bench's longform writing score that day. When the live list (`GET /api/models`) loads, only curated ids it serves show, so a retired one drops out, and the ranked shortlist (`modelRank.ts`) stands in if none is left; "All models" follows. Without the live list all six show, and the typed id field stays for anything else. A pick saves through `writer.set` like any other.
- Why: the owner asked to pick top models from Nebius. Without a provider key on Vercel the page offered only Automatic and a typed id, so no model could be picked by name.
- Cost: a named list goes stale, as Qwen3-32B did when it left the serverless tier on 2026-08-31; refresh it when Nebius's catalogue or the writing leaderboard moves. Kimi K3 costs about four times the others per token.
- Rejected: Llama (no longer a public endpoint on Nebius); gpt-oss-120b (the lowest writing score of the candidates, 35.8).

## D59: On a phone, Play takes the floating button's place on an episode and an older briefing

- Date: 2026-10-11
- Decision: Below 64rem an episode page and a briefing page that is not Today show a floating Play button where Today and the Library show Create (D52); other pages and wide screens show none. It reads "Play · 5 min" and is named "Play this episode, 5 min" (or "briefing"). It carries `data-play-digest`, so the player plays it exactly as it plays the hero chip: narration first when no audio exists, a spinner while it is made, disabled offline. It extends and folds with scrolling as Create does, and shares its shape (`create-fab play-fab`). Once the player holds this page's audio the bar is its control, so the button steps aside (`data-fab` leaves the root, also on the incoming page before a swap) and comes back when the player holds something else or nothing.
- Why: the owner asked for Play instead of Create on an episode or a briefing on a phone. On a page about one piece of audio, hearing it is the next thing to do, and the hero chip scrolls away with the header.
- Cost: 87 bytes gzipped on every page. Until one is pressed there are two play controls, the chip and the button; the button earns its place once the chip has scrolled off.
- Rejected: a button that turns into Pause (a second pause beside the bar's); Play on Today too (Today is a list destination, where making an episode is the next thing, D52).
- Supersedes: D52's rule that briefings and episodes have no floating button.

## D60: On a phone Create floats on the Library alone; every page with audio floats Play, Today included

- Date: 2026-10-11
- Decision: Below 64rem the floating button is Create on the Library and nowhere else. Today, the latest briefing at its dated address, older briefings and episodes float Play (D59's button, named "Play this briefing, 1 min" or "episode"). A Today with no briefing yet, Settings, Create, offline and not found float nothing. From 64rem the side column carries Create on every page and no floating button shows, as before. Today passes its briefing's audio to the layout, so its button reads the same length as the hero chip.
- Why: the owner: "The only area you can have the create button is the library page, but this logic does not apply to desktop viewport because the create button is always available on the navigation bar", and Play rather than Create on a podcast's page. Today is the latest briefing, a page about one recording, so hearing it is the next thing to do there as well.
- Cost: on a phone, Create is two presses from Today (Library, then Create), and a Today with no briefing offers no way to make one but the Library's. Today has two play controls until the chip scrolls away, so the site specs scope the chip to `.hero`.
- Rejected: Create on Today (D52 called it a list destination; the owner overruled that).
- Supersedes: D52's Create on Today, and D59's rejection of Play on Today.

## D61: Vercel Cron starts the scheduled briefing in its hour; GitHub's schedule is the fallback

- Date: 2026-10-11
- Decision: `apps/web/vercel.json` holds 24 daily crons, `0 H * * *` for every UTC hour, all calling `GET /api/cron/run`. The route needs `Authorization: Bearer <CRON_SECRET>` and refuses every call while the variable is unset or shorter than 16 characters. It reads `config/schedule.json` on main; in the schedule's own hour, Stockholm time (the daily hour, or the weekly slot's hour on its day), it runs the engine's gate (`decideRun`, now exported as `@dispatch/engine/gate`) on `state/last-run.json`, and when a briefing or the weekly pass is due it dispatches `run.yml` with `mode: scheduled`. `run.yml` keeps its hourly entries and `RUN_CRON`: GitHub's late run is the fallback, and the gate ends it gated once the briefing exists.
- Why: GitHub has started scheduled runs 4 to 7 hours late, and dropped some, since 2026-08-26, for many repositories and with no fix (github.com/orgs/community/discussions/207346). Here the 07:13 Stockholm entry ran between 13:11 and 14:02 on each of 7 to 10 October, before and after the hourly entries existed. In that thread, moving the minute, recreating the workflow or using a new repository did not help; an outside trigger calling `workflow_dispatch` did. Vercel's Hobby plan allows 100 crons a project, each once a day and landing anywhere in its hour, so 24 cover every hour, and the route follows the hour chosen in Settings without a redeploy.
- Cost: the briefing starts anywhere in its hour (07:00 to 07:59), not at 07:13. A scheduled briefing is now a `workflow_dispatch` run, so it counts toward Generate's limits (six hours apart, three a day), which GitHub's schedule run never did; adding `run-name` to `run.yml` (a workflow change) would let the limits tell the two apart. One GitHub read every hour, two more in the slot. Vercel does not retry a call that fails to arrive; GitHub's late run covers that day. Owner step: put a random `CRON_SECRET` of 16 or more characters in `.env` and run `npm run secrets:push`; until then the route refuses calls and GitHub's late schedule still runs.
- Rejected: accepting more hourly entries in `run.yml` (each runner it starts costs a minute, and every entry is late); a third-party cron service (one more account holding a credential); a Claude routine as the trigger (a whole session per day for one request); waiting for GitHub to fix it (six weeks without a reply).
- Supersedes: D6's reliance on GitHub's cron for the time of day (its date gate stays), and D45's `RUN_CRON` as the trigger (it stays as the fallback).

## D62: Daily and Weekly each choose their topics; voice samples play through the site

- Date: 2026-10-11
- Decision: The Daily and Weekly settings pages each have a Topics row: one chip per section with a topic that is on and may publish, by name, all ticked by default. All ticked is stored as null (every topic, including ones added later); fewer is the list of section ids; the last ticked chip cannot be unticked; Top picks is always covered. The weekly profile gains `weekly.sections` in `config/schedule.json` (null by default), validated by `schedule.set` as the daily list is, and the weekly pass is narrowed by it in every mode (it used to cover every section). Voice samples play through `GET /api/voice-sample?voice=<id>`, which fetches only a sample in the cached Speechify list, caps it at 2 MB and answers byte ranges; `/api/voices` also names the voices Default stands for. Choosing a voice plays its sample, and a Sample chip (the app's play chip) plays it again or stops it.
- Why: the owner asked to choose topics in Daily and Weekly and to preview voices in an intuitive way. The old play button pointed at Speechify's own host, which the page's `media-src` blocks, so in production a press failed and the button hid itself.
- Cost: one function call per sample played (cached at the CDN for a week). A topic added after a narrower list was saved is not in that list until it is ticked. A section left in the file after its topic is removed is ignored, as before.
- Rejected: adding Speechify's host to `media-src` (the host is not documented and can change); a custom voice list with a play button per row (a native select cannot hold buttons, and the drawn list is shared by every select).

## D63: Daily and Weekly leave out topics, one chip per topic, stored as the topics left out

- Date: 2026-10-11
- Decision: The Topics row on Daily and Weekly has one chip per topic (every topic that is on and may publish, by name), not per section. `config/schedule.json` stores `skip_topics` at the top for the daily briefing and in `weekly` for the weekly one: the topics left out, empty by default. `sections` and `weekly.sections` are gone; an older file's `sections` (always null in use) is dropped on read. Selection drops a story whose winning topic is left out, so it reaches Top picks neither. Removing a topic takes it out of both lists. The last ticked chip cannot be unticked. Custom has no setting: the Create panel picks topics per episode.
- Why: the owner asked how to add or remove a topic from the daily and weekly podcasts, and wanted the simplest intuitive answer. D62's chips were sections, so "Design Engineering" stood for five topics and none could be left out alone. Storing what is left out, not what is in, means a topic added later is in both podcasts without anyone remembering to tick it.
- Cost: the chips can run to a dozen names. A story that fits two topics follows its winning one.
- Rejected: a scope dropdown per topic (Daily, Weekly, Custom, All): Custom is chosen per episode and "none" repeats the topic's own switch, so two booleans hidden in a menu; switches on each topic page as well (two places for one setting); keeping sections (coarser than the topics the owner names).
- Supersedes: D62's section-based Topics row and `weekly.sections`, and D45's `sections`.

## D64: Every topic can be renamed; what counts edits wherever the judge reads it

- Date: 2026-10-11
- Decision: Edit topic takes a new name on every topic. What counts (the description) edits on a custom topic and on the two that ship with the app (Design, Trending), whose fit question is built from name and description; on a built-in category it stays read-only, with a note that the app judges it by questions of its own. `topic.upsert` sets name, weight and keywords on a built-in topic and name, description, weight, keywords and the switch on an app topic; sections, depth and flags stay the code's. Rewording an app topic re-judges that topic alone on the next run (its question's hash changes); a built-in topic's name is never read by the judge.
- Why: the owner reported that Edit topic would not let them edit text. Every topic they have ships with the app (11 built-in, Design and Trending), so D57 left them only keywords. D57's reason, keeping the judge question, holds for a built-in category's description and for nothing else.
- Cost: an app topic reworded by mistake re-judges its stories once. A built-in topic's description cannot say what the owner means by it; changing that would need its fixed questions rewritten.
- Rejected: letting a built-in description edit (it would read as changing what counts and change nothing); keeping shipped topics read-only (the owner's whole list).
- Supersedes: D57's read-only name and what counts on shipped topics.

## D65: The weekly podcast takes its day; the daily cadence counts from it

- Date: 2026-10-11
- Decision: While the weekly podcast is on, its day (Stockholm date) has no scheduled briefing: the gate (`decideRun`) answers "today is the weekly podcast's day; no briefing" whatever the cadence says, and the weekly pass runs from its hour as before. The daily cadence counts from the later of the last regular run (published or nothing) and the last weekly pass that published, so the briefing after a weekly podcast keeps the cadence's spacing. A forced or on-demand run still makes a briefing on that day. The cron route starts nothing at the daily hour on the weekly day. The Daily page's next-briefing estimate follows the same rule, and its When hint names the day ("Stockholm time, none on Sundays").
- Why: the owner asked that a collision on the weekly day go to the weekly podcast, and chose the cadence counting from it over the briefing coming back the next day. The weekly pass fetches its own seven-day window, so it loses nothing without the day's briefing, and it no longer has the day's best stories claimed by a briefing published minutes earlier.
- Cost: with every second day and a Sunday weekly, the week settles into Tuesday, Thursday and Saturday briefings plus the Sunday weekly. A weekly pass that fails leaves its day with nothing, and the next briefing comes the day after. A weekly pass that found nothing does not count, so the briefing comes the next day.
- Rejected: the briefing the next day (a briefing the morning after the weekly repeats its news); a skipped briefing recorded as its own outcome in `state/last-run.json` (a state schema change for what the weekly record already says).

## D66: General news topics are topics; their feeds are sources Jev judges every run, for scores and episodes only

- Date: 2026-10-11
- Decision: World, Business, Science, Culture and Sports are topics in `config/topics.json` with origin `general`: seeded and restored like Design and Trending, named after a section no digest has (`general`), depth `coverage`; renamable, rewordable and switchable, never removed. Their 20 news feeds (from the retired `config/general-feeds.json`; ids `<outlet>-<desk>`) are ordinary sources tagged with the topic, so the app turns them on and off, adds and edits them like any other. The four Technology desks became sources under Consumer tech releases, switched off. Each run reads the general feeds of the topics that are on (never in the weekly pass), keeps their stories beside the pool (`general.json`), and has Jev judge every story in one request: the topic's fit question and the hype and sponsored flags. The stories never enter the pool, so no digest, Top pick or weekly digest can carry them; a failure judging them never stops the briefing. A safety ceiling of 600 stories a run is logged when hit. `state/source-stats.json` counts them as other sources, plus `covered` (stories another outlet also carried, by the news clustering); for a feed of general topics alone the score's quality part counts covered where others count published. General episodes read the enabled sources of the chosen topics. A stored `technology` reads as `tech`.
- Why: the owner said the general topics and sources were not configurable, wanted everything configurable, and chose to have Jev judge every general story (over a sample of three per feed or health and coverage alone) so the feeds are scored on the same parts as their other sources.
- Cost: not measured (the sandbox could not reach the feeds): an estimated 150 to 400 more Jev requests a run, against 165 for the whole of the 9 October run (about 2 cents), so a few cents more a run. Scores read New until a feed has ten judged stories. Al Jazeera's world feed is also Trending's, so it is fetched twice. ScienceDaily left the source catalogue, as it is now a source.
- Rejected: sampling three stories a feed (the owner chose all); health and coverage alone (no quality or honesty); letting general stories compete for the briefing (it would change the briefing the owner tuned).
- Supersedes: D43's fixed feed list in `config/general-feeds.json`.

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

## D69: Design, AI and Technology gather the judge topics; one alphabetical list where each topic sets its scope; every source filed under a topic

- Date: 2026-10-11
- Decision: Topics & Sources is one alphabetical list: the owner's three topics, each of the owner's own topics, and the five general topics, with Other last. Design gathers the judge topics of the `design` and `ui-craft` sections, AI those of `ai`, Technology those of `tech` (`core/topicGroups.ts`). A judge topic keeps its question and weight but has no page of its own. A group's page lists their sources and a weight slider for each judge topic (Technology, which gathers one, shows a plain Weight row), and Add source files a new source under the group's home topic.
  - Scope: each topic page has a Scope multi-select (Daily, Weekly, Custom), and Add topic sets it in the same request. Scope is a `topic.scope` op that edits the skip lists in place (`skip_topics`, `weekly.skip_topics`, new `custom.skip_topics`), so a stale page cannot bring back a topic another page left out. Create hides the chip of a topic left out of Custom. A general topic plays in custom episodes only: Custom is its on switch, and Daily and Weekly are disabled. Daily and Weekly link to Topics & Sources instead of listing chips. Trending is off, and the old category pages redirect to the topic that took them.
  - Rows: a source's name links to its site in a new tab, and the open icon is gone. The checkbox is a new primitive (`.suggest-box`).
  - Filing: every source sits under a topic except Exa discovery, whose searches carry their own.
    - Lobsters and daily.dev go with developer tool launches.
    - Brutalist Report and TechCrunch go with Technology, capped at six candidates each.
    - The three daily AI roundups move under AI, switched off.
    - The seven Trending outlets go under World. France 24 is on. The other top-stories feeds are off where the outlet has a World desk, since they would mostly repeat it.
  - New sources: 21, each feed fetched live through Firecrawl on 2026-10-11.
    - General desks from CBS, Sky, PBS, BBC and The Guardian, so each general topic has five or more outlets.
    - Techmeme for Technology.
    - Latent Space, The Decoder and Google AI for AI.
    - Bram.us, Piccalilli, Ahmad Shadeed, Brad Frost, Dave Rupert, Adactio and WebKit for Design.
    - The eleven of these that came from the catalogue left it, which now holds 32 entries.
- Why: the owner asked for the following.
  - Design, AI and Technology as their topics, "to keep things lean".
  - One list with no separation.
  - Scope set inside a topic and when one is created, as a multi-select.
  - Names as links and a better checkbox.
  - To "fill up the existing sources and new sources into the current topic cluster".
- Cost:
  - A group cannot be renamed, and what it counts cannot be edited, since each judge topic keeps its fixed question.
  - General topics cannot play in Daily or Weekly yet.
  - The new general desks add about ten feeds that Jev judges every run, within `GENERAL_JUDGE_CEILING`.
  - Import keeps an existing source's on/off flag and options, so the off flags and the removed pool caps were written into `config/sources.json` after the import.
- Rejected:
  - One weight per group: it would flatten the curated differences between its judge topics.
  - Filing Exa under one topic: ten of its twelve searches have none.
  - Re-hinting the AI roundups and leaving them on: they would bring a day's hype into the pool.

## D70: A scoring sample judges a few items a run for scores alone, so every source reaches a score, switched-off ones included

- Date: 2026-10-11
- Decision: Each run's first regular pass judges a sample of items for their sources' scores alone (`run/scoreSample.ts`). They are never in the pool, never published and never marked seen, so the briefing is the same as without them.
  - Left-overs: a switched-on source under ten judged items gets up to 4 of the items the prefilter left out of this run's pool.
  - Its own feed: such a source with a feed (RSS, Atom, GitHub releases) reads it itself at most once in 30 days. The first read looks 90 days back, so a new source has a score after its first run; later reads look 30 days back. It takes as many items as it lacks.
  - Weekly check: a switched-off source with a feed is read once a week and gives 4 items, and the read sets its health. A switched-off general news feed is read with the pass's general feeds and judged like them. A story only it carried waits behind every other under the general ceiling, and its outlet never raises a switched-on feed's coverage (`coverage_all` keeps the full count for the checked feed's own score).
  - The reads run beside the pass's own fetch, each with a hard timeout. A read counts as done when the judge answered every item it offered (an unanswered one is offered again next run); a switched-off general feed's check is done once tried. Without a Jev key the sample is not planned at all.
  - Limits: 200 items and 40 feed reads a run, the sources with the fewest judged items first; a feed failing its own fetch twice in a row is not refilled. An item already judged (in the judgment cache or seen.json) or in this run's pool is never sampled.
  - Judge: Jev alone, with no Nebius fallback, so an outage cannot spend the writer's token budget; without a Jev key the sample waits.
  - Counting: a sampled item counts as judged, passed (when it would clear the bar on its built-in categories), asked and flagged, and as `sampled`. The publish share is out of `judged` less `sampled`, since a sampled item could never be published. Quality is read on what could have been published and blended with the pass share alone by its share of the judged items: a source with no sampled items scores as before, one with nothing that could have been published (switched off, or not yet sent by the prefilter) on its pass share alone, so a weekly check can show it has earned a place, with no cliff in between. `sampled_at` records the last read of the source's own feed.
  - A source whose feed held fewer than ten posts when the sample last read it to fill it up (`feed_posts`, set by every read that worked and standing for 60 days, one missed monthly read of slack) posts too rarely to reach ten judged items: from 3 judged items it is scored on what it has, and the reason says so.
- Why: the owner asked that every source, new ones included, get a score kept current on its factors. On 2026-10-11 only 10 of 149 switched-on sources had one: the prefilter sends the judge about 80 items a run, so most sources never reached ten judged items, and a switched-off source was never fetched at all.
- Cost:
  - At most 200 more Jev requests a run, about 2.4 cents at the 9 October rate (165 requests for about 2 cents). The backlog on 2026-10-11 was 88 feed reads and up to about 800 items, so about four runs at the ceiling, then far less.
  - The six switched-off general feeds add their stories to the general judging once a week.
  - The scores refresh on every run, not weekly: each run's counts land in the rolling 30-day window, and the weekly cadence applies to switched-off sources alone.
  - A sampled item is judged on the built-in questions only, without custom topic fits.
  - A sampled item that a later weekly pass's pool holds is judged from the cache but counted again. It is rare, and a fix would need a mark on every cached judgment.
- Rejected:
  - A weekly recompute of every score: scores already move every run, so it would make them older without producing new ones.
  - The fallback judge for the sample, for the token budget's sake.
  - Lowering the ten-item bar for everyone: the sparse rule covers the sources that can never reach it.

## D71: Streamlined add topic modal, live suggested sources with TypeSafe Jev scores, schedule timezone and topic scope indicator chips

- Date: 2026-10-11
- Decision: Add topic modal drops the keywords input and intermediate source selection step; creating a topic saves it immediately and opens its detail page. Each topic detail page features a suggested sources section with 5 curated sources scored by TypeSafe Jev. Daily and Weekly settings display read-only topic scope indicator chips with a Configure button linking to Topics & Sources. The When row includes a curated timezone selector persisted in config/schedule.json.
- Why: Removes friction when creating topics, keeps topic pages lively with suggested sources, clarifies topic scope in podcast settings, and accommodates global user timezones.
- Cost: Minor increase in client-side fetch requests for suggested sources.
- Rejected: Heavy multi-step creation wizards; hardcoded UTC or local-only timezone detection without explicit user control.

## D72: The look is tonal: containers, state layers and round buttons instead of outlines and invisible hover fills

- Date: 2026-10-11
- Decision: Controls are drawn as tonal shapes, not boxes with outlines.
  - Colour: `surface-container` (the page's tonal fill: the search pill, the play chip, an unselected filter chip, the bottom bar), `accent-container` with `on-accent-container` (the selected or current state: a chosen chip or segment, the current destination, the loaded story, a tonal button, the floating button). Text on the accent container is never `accent` (4.0:1 in light). `accent-subtle` and `surface-sunken` stay for wells, skeletons and tracks; at about 1.03:1 on the light page they are never the only sign of a hover, a selection or a control. A test keeps the two containers 1.08:1 and 1.2:1 from the page in both themes, and the text on them at 4.5:1.
  - State layers: a hover lays 8% and a press 12% of the control's text colour over its own fill (`--state-hover`, `--state-press`), on every button, chip, row, option and navigation item.
  - Shape: buttons, chips and navigation items are full pills; a tappable row and a list option are 12px (`--row-radius`); the Create button and the floating button are 16px; a text field keeps `--field-radius` and its outline.
  - Navigation: a tonal bottom bar, 4rem tall, with a pill behind the current icon; in the side column the current row and the Create button take the accent container. The hairline above the bar is gone.
  - The play chip is a tonal pill with no ring or outline; it takes the accent container while it is the loaded story. The hero chip no longer needs the page's surface behind it, since its fill is opaque.
- Why: the owner called the boxed look "ai slop" and asked for a real Google app. Outlines on every control read as generated; a hover or a selected tint at 1.03:1 read as no state at all (chips looked unselectable). Material's tonal containers answer both with a fill that is visible without a line.
- Cost: a transparent 1px border stays on chips and filter chips so their size holds where forced colours draw one; the bar is 8px taller; D54's outlines remain on text fields only.
- Rejected: keeping the hairline outlines and only strengthening them (still boxes); `accent-subtle` made stronger (it is also the hover tint of text controls, where it must stay light); a per-component hover colour (twenty fills to keep in step).
- Supersedes: the outlined play chip of D31 and, for selects, segmented controls and chips, the outlines of D54.

## D73: A steadier type scale: 16px reading, 18 to 20px headlines, 14px meta, 22px regular section headings

- Date: 2026-10-11
- Decision: Story and summary text is 16px at every width (it was 15 to 17px); a story's headline is 18px rising to 20px at 1280px (it was 16 to 17px, one pixel over its summary on a phone) with leading 1.35; the meta line is 14px, level with labels; section headings are 22px regular, so weight 500 marks headlines only; the display step is at most 32px. Reading leading is 1.55.
- Why: the critique found headline and summary a pixel apart on a phone and the same size on desktop, three sizes between 15 and 17px and a medium weight on everything, so nothing was marked. A scale in which each step is visible removes the need for a bold inline label.
- Cost: the 13px meta size is gone, so facts lines grow a point and wrap sooner on a 360px phone.
- Rejected: a fluid reading size (it is the same word at two sizes); making headlines semibold (it breaks the two-weight rule).

## D74: A discussion's hosts are named after their voices; the transcript names a speaker only where the speaker changes

- Date: 2026-10-11
- Decision: The two hosts of a discussion take names that fit their voices (`hostNamesFor` in `@dispatch/core/hosts`): a voice keeps its own display name when that is one given name, otherwise a name from the female, male or neutral pool for its gender, chosen by a stable hash of the voice id, and the second host moves on when the two would match. The podcast workflow has no Speechify key, so `/api/podcast` resolves them when a discussion is requested (from the cached voice list, within two seconds) and stores `host_names` with the request; the writer is told them and the transcript shows them. A readout names nobody. A discussion made before names were stored keeps Ada and Leo. The transcript has no cards or badges: a small name over a turn where the speaker changes, and only in a discussion. Both voices are always on the Daily and Weekly pages, the second labelled as the discussion's.
- Why: the owner uses a male voice and Ada is not one; a name that disagrees with the voice breaks the illusion in the first line.
- Cost: a discussion requested while the voice list is unreachable carries no names and is written with the generic pair; a name pool is a small list, so two voices can share a name across episodes.
- Rejected: asking the owner to type the names (a second thing to keep in step with the voice); naming from the browser (a request could carry any text into the prompt).

## D75: Suggested sources are chosen from the source catalogue when the page is built, with no live lookup and no scores

- Date: 2026-10-11
- Decision: A topic's page lists up to five sources from the catalogue that fit it, in the page itself (`SuggestedSources.astro`, `suggestSources` in `sourceCatalog.ts`). A feed must share a tag with the topic; its description and name only rank it. General topics match on their name alone. Each has a plus that adds it in the row. There is no `/api/topic-suggestions`, no skeleton, no "Live curated" mark and no score: a score the catalogue cannot have measured is not shown.
- Why: the owner saw the "Live curated" pill and a long wait for the list; the list was fetched after the page loaded, failed silently into a skeleton and showed scores made up for sources the engine had never judged.
- Cost: the list changes only with the catalogue and a redeploy; a source Jev has not judged shows no score until it has one.
- Rejected: caching the live fetch (it stays an unmeasured score); a loading state with a timeout (still a wait).
- Supersedes: the live suggested sources and their scores in D71.

## D76: Create is the New episode form: three questions first, the defaults under More options

- Date: 2026-10-12
- Decision: The side column's button, the floating button, the panel and the page that start a podcast are all called New episode, and the button inside reads "Generate • N mins" (the owner's wording). Topics, Length and Format are the questions. Written for, Voice (Voices for a discussion), Look back, Tone and Title wait under More options, whose line says what they are set to; the wide /create page holds them open. Choices are tonal segments that hug their content. A discussion's voices are labelled with the hosts the episode will be written with (`hostNamesFor`); a readout names no one. The button says "Starting..." beside a spinner while the request is in flight. The sheet takes the page's own surface and pins its button to the foot, over a hairline that fades in. `/create` sits under the Library: Back leads there and Library is the current tab at every width.
- Why: the owner called the boxed form "ai slop". It asked seven questions of equal weight, and three decide the episode; the rest have defaults that were right for most requests.
- Cost: changing a voice or the tone takes one more press; a request made from the defaults shows only the line that names them.
- Rejected: a wizard (one more step than the form); hiding the defaults with no summary line (the owner could not tell what a request would use).

## D77: A reading page: the headline is the link, Play is the one filled action, one hero for any title

- Date: 2026-10-12
- Decision: On Today, a briefing and an episode, a story's headline links to its source (a new tab), and the publisher is quiet attribution outside the tab order. The hero's Play is the page's one filled action and drops to the tonal container once the page is playing. The floating Play appears only once the hero's has scrolled away (two Play buttons were on screen on a phone). One hero layout serves any title length: on a phone the cover with More at the row's end, the title full width, the facts line and Play; from 40rem a 10rem cover with Play on its foot line. Sections are separated by space alone, with regular-weight headings in sentence case; the Why line is 14px and muted; the Contents list starts level with the first heading; the shelf is called Earlier briefings. An episode's line reads "Discussion · 7 October". The ambient light is half strength in light mode and three quarters in dark.
- Why: the critique found two competing Play buttons on a phone, a rule above every group, a title that changed the hero's layout with its length, and an active-section mark 56px off while the app bar hid.
- Cost: the publisher is no longer a tab stop on a story; the link target is the whole headline, so a headline cannot be selected by dragging as easily.
- Rejected: keeping the publisher as the link (its target was a chip; the headline is what the eye reads); an outline on the hero's Play (tonal and outlined states were hard to tell apart on the light page).

## D78: The Library has one facts line per card, finds dates, keeps its search in the address and remembers what was played

- Date: 2026-10-12
- Decision: Every card follows one pattern, kind then contents then length: "Daily · 12 stories · 8 min", "Discussion · 5 min", "Briefing · 4 min" (an episode's format already says it is an episode). Search finds a date in any form ("6 oct", "2026-10-06"); a number matches a whole word only, so "6 oct" no longer matches every 2026 date. The search, the filter and the order live in the address (`q`, `show`, `sort`), so Back from a result restores them; sorting and filtering work from the cards in the page, so a deleted episode stays gone. A filter or order that is not the default looks chosen (accent container). The player writes `dispatch:played:<id>` at the end of a recording and drops it when a new position is set; the card then says Played, and a half-heard recording shows its progress as a bar under the art. An empty Library says so in one muted sentence; the floating Create is not shown there.
- Why: cards carried three differently worded lines, a search for a date matched the year, Back from an episode lost the search, and nothing said what had been heard.
- Cost: a played mark is per browser (localStorage); a card's title keeps no break between the day and the month.
- Rejected: a played mark kept on the server (a write for every listen); fuzzy date search (it made "6" match everything).

## D79: A saved setting shows before the build, and a new topic stays on its list with its suggestions at once

- Date: 2026-10-12
- Decision: A save reaches the page about a minute later, because the config workflow commits and Vercel rebuilds. For three minutes after a save the browser remembers the saved ops (`dispatch:saved-edits`) and a settings page that opens shows the saved value instead of the stale one built into it, with one line under the title: "Saved. It takes effect after the next update, about a minute." A value that already equals the saved one counts as the rebuild having landed. A new topic stays listed on the Topics list until the build (a static site has no page for it yet); its suggestions appear under its row at once from `/settings/source-catalog.json`, ranked by the same function as the build's (`lib/sourceCatalogMatch.ts`), each with a plus that adds the feed. Inside the server's ten-second gap between saves the page holds the next request quietly and sends everything changed meanwhile in one request. A topic with a name already in use is refused, a queued topic has no Cancel, and the World topic has an honest switch.
- Why: the owner saw settings revert after a save, a new topic had no suggestions for a minute, and a second edit showed "Saving" for ten seconds.
- Cost: the overlay reads only the saved value; if a save never lands (a workflow failure) the page shows the saved value for three minutes and then the old one. A save that waits longer than three minutes behind a briefing outlives the overlay. Leaving the site during the quiet wait loses that edit, as the old 429 wait did.
- Rejected: reading the saved value back from GitHub on every visit (a request on every settings page); a longer overlay (it would hide a failed save for longer).
- Supersedes: D71's "creating a topic opens its detail page".

## D80: An episode is written to 95% of what its stories can carry, and a script a little under the floor is kept

- Date: 2026-10-12
- Decision: The writer is asked for 0.95 of the reachable length (it was 0.9); the floor stays 0.8. A reply at 95% of the floor or more is kept on any attempt and logged ("Kept a script a little under the floor"); only a shorter one is requested again. A returned story id is matched when a known id sits anywhere inside it (when only one does), and each story block puts `item_id:` on its own line, so a copied boundary marker no longer sinks a rewrite. A request's timeout is 60 s plus 25 ms for every token over 1,500, capped at 240 s (a 15 minute script gets about 183 s; Anthropic never gets under 120 s); a retry starts only if two timeouts still fit; no script attempt starts after 8 minutes. The number rewrites of a script run four at a time and are applied in script order. A failover warning gives the status, error class and a kind (authentication, model not found, rate limited) and never the provider's message. A source preview fetches each address once and the favicon beside the page.
- Why: the first script came back at 79 to 87% of the reachable length against an 80% floor, so most episodes were written twice (25 to 36 s each time). The writer is almost all of the 58 to 87 s a podcast step takes.
- Cost: a script can end up to 5% under the floor; `fitToBudget` still drops whole stories from the end when a script is over, which asking for 95% leaves room for. Measured only with fakes; the saving is expected on most episodes, not yet seen on a real run.
- Rejected: asking for 100% (a script over budget loses a story); expanding only the thin stories (a larger change, left for later).

## D81: A workflow installs only what it runs; the audio job skips the Vercel pull when the Blob token is set

- Date: 2026-10-12
- Decision: `run.yml`, `podcast.yml`, `config.yml` and `audio.yml` install with `npm ci --ignore-scripts --workspace=packages/engine --include-workspace-root` (118 packages, not 445). `audio.yml` skips `vercel link` and `vercel env pull` when `BLOB_READ_WRITE_TOKEN` is set, since the engine ignores the pulled pair then. Changes under `.github/workflows` need a manual merge by the owner.
- Why: the install was 10.4 s against 4.3 s on a warm cache, paid on every episode, every settings save and every briefing; `audio.yml` has failed at `vercel link` ("User not found") while `VERCEL_TOKEN` was dead, so the latest briefings had no stored audio and their first Play synthesised (3 to 6 s).
- Cost: the audio job still pulls when no Blob token secret exists. Vercel shows a store's long-lived token once and then hides it (D26), so the usual fix is the owner replacing `VERCEL_TOKEN`; `BLOB_READ_WRITE_TOKEN` as a GitHub secret works if they still have it.
- Rejected: caching `node_modules` (a saving nobody measured, beside an install that now takes 4 seconds); one concurrency group for `config.yml` of its own (it shares `dispatch` with `run.yml` on purpose, so two commits never push at once).

## D82: Play keeps an early tap, a new episode is pre-narrated, the deploy is noticed in 2.5 s

- Date: 2026-10-12
- Decision: A Play pressed before the player has loaded is kept (an inline script in `bannersInit.js`, which also unlocks an audio element inside the tap) and pressed again once the player's listener is attached (`player/core/earlyTap.ts`). When a new episode goes live, the progress indicator pre-narrates its first two turns (`narration/prewarmEpisode.ts`, which stops at the first refusal and never shows an error). The page prewarm runs only on a page with a briefing or episode and no audio, at the next idle moment instead of 1.5 s after load. After a publish the indicator reads `/latest.json` every 2.5 s (it was 10 s). The service worker keeps `/latest.json` under its bare path whatever the query (the old keys never matched its expiry and each poll could push a page out), and its cache version is v6. A segment's word marks upload beside its audio.
- Why: the owner pointed at delays in time to play. A tap in the first two seconds of a page was lost; a new episode had no audio, so the first Play synthesised for 3 to 5 s; the progress indicator noticed the deploy up to 14 s late.
- Cost: a new episode takes one of the day's narrations when it goes live, whether it is played or not (the cap is three a day; whether pre-narration should count is the owner's call). The inline script adds about 450 bytes gzipped to every page. A marks file can stay behind when the audio upload fails for good; it is harmless.
- Rejected: moving the charge write beside the storage checks (a stored segment would be charged again on a replay, and a segment could be made before its charge is on record); splitting a long first turn at its first sentence (left for later).

## D83: Settings shows a source's score as one word, a source's name opens its editor, and the Model default is called Default

- Date: 2026-10-12
- Decision: A source's row shows its score as one word under the host ("host · Good"; Excellent, Good, Fair or Poor, and "Not scored yet" for a new source); the pips and the number are gone. The score is still out of 3 and its parts are in the edit panel (D55). A source's name, and a suggested source's, is plain text: the row opens the editor, and the panel's Address link opens the site. Segmented controls are pills with on-surface labels, and the daily podcast's "Type" is "Format". A topic's summary on the list reads "2 of 3 sources on" or "No sources yet" and carries no weight. The Model page's automatic choice is called "Default" and its row reads "Nebius, Default". A weight reads as a percentage under its label. A topic with a name already in use is refused, a queued topic has no Cancel, the World topic has a switch that is really its on state, and a failed address lookup says so under the field. Panel and sheet headers put Close before the title.
- Why: the second critic found three marks for one score (pips, number and label), a link and a row action fighting over one name, long values pushing a row past the edge of a 360px phone, and a Cancel that cancelled nothing.
- Cost: a source's site is one press further (open its row, then Address); a word hides the difference between 2.1 and 2.6, which the panel's parts show.
- Rejected: keeping the pips beside the word (the same fact twice); a name that links out with a separate edit control (a row with two targets, neither obvious).
- Amends: D55 (the pips and the number) and D69's names as links.

## D84: A failed run keeps its request and offers Try again; a finished run clears itself; one run at a time

- Date: 2026-10-12
- Decision: The run indicator keeps the request of an episode that failed and offers Try again, which sends it again and follows the new run. A refusal names its own wait (a 429) and a request that cannot go from the line (a 401, or no passphrase) reopens the form filled in. Opening the new episode, or having it on screen, clears "Episode ready" and gives back the room it held. While an episode is being made, New episode says so (to a screen reader) instead of sending a second request, and a regenerate hands the indicator its request too. The lines read "Episode queued", "Writing your episode", "Adding it to your Library", "Couldn't make the episode" and "Still being made. It will appear in your Library." A briefing keeps "Updating the site".
- Why: a failed run said "later" and left nothing to press, "Episode ready" stayed on every page until dismissed, and a second request could start while the first ran.
- Cost: the request is kept in the browser (session storage) until the run ends; New episode still opens its sheet while a run is going, and says why only to a screen reader; a regenerate's fallback reopens its panel on that episode's own page only.
- Rejected: retrying by itself (a failure that repeats would spend the day's limit); blocking the sheet while a run is going (the owner may want to read the form).

## D85: The player's chapters are timed and play their story, a discussion without stored names is named from its voices, and one length rule runs through the app

- Date: 2026-10-12
- Decision:
  - An episode's Chapters tab lists its stories timed from its turns (`turnStorySpans`); a chapter is a button that starts that story, and previous and next step between story starts ("Previous story", "Next story"), narrated or not. A chapter with no place in the audio is a plain row. The lone section heading above an episode's chapters is gone.
  - A discussion made before names were stored is named in the transcript only when its script says Ada and Leo itself. Otherwise no name shows until `/api/voices` has loaded (once per page, `player/core/hostVoices.ts`), then `hostNamesFor` names the hosts from the episode's own voice ids, or the defaults; if the list cannot be fetched the pair is the neutral Alex and Sam. A stored name always wins.
  - One length rule: the chip, the floating Play, the bar and the page caption round the time and the length the same way (to the nearest minute, so 130 s reads "2 min" and "2 min left") and use the real duration once the recording's is known. The line under the title says the format's own word (Readout, Discussion), as the Library does.
  - On a wide screen with a mouse, Play sits between the two skips under the art, and the bar has a visible open and close button (a chevron). The timeline shows the time under the pointer on hover. The cover's slot grows from 100rem.
- Why: the owner said Ada does not work with a male voice, and the one real discussion (ep-20261008-1155) still said Ada and Leo although its script never does; its chapters tab was empty; one episode showed three lengths at once (the chip said "3 min left" a second in, the bar "2 min" and the page "-2:10", because the remaining time rounded up and the total to the nearest minute, and before play the chip quoted an estimate of 5 min); the player called a readout "Episode" where the Library says "Readout"; and the way to close the player was hidden until a key was pressed.
- Cost: a legacy discussion's transcript shows no names for the moment the voice list takes; the format labels moved to `lib/formatLabels.ts` so the browser does not import `node:fs` through `episodes.ts`; the bar's close button duplicates the keyboard-only "Close the player" pill's name.
- Rejected: keeping Ada and Leo for anything made before D74 (the case the owner reported); naming from the browser's own guess (a request or a stored script could carry any text into the page).
- Amends: D74, for episodes made before names were stored.

## D86: An action has its own tone, the player bar is one tonal block with the navigation, and reading text keeps a 34rem measure

- Date: 2026-10-12
- Decision: `accent-container-high` (blue 200 in light, blue 800 in dark, with `on-accent-container-high`) is the tone of an action that is not a place: the New episode button in the side column and the floating New episode button. `accent-container` stays for what is chosen or current (a chip, a segment, the current destination), so on a phone the button, the Gallery toggle and the current tab no longer share one fill, and on desktop the button is no longer the colour of the Library row 68px below it. A test keeps its text at 4.5:1 and the tone 0.2 further from the page than the selected one. The player's mini bar and desktop dock use `surface-container`, as the navigation does, so the two read as one tonal block in both themes (the bar was the overlay surface, raised, with the navigation sunk under it and a hairline between them). The reading measure is `34rem`: the old `68ch` resolved to about 702px here, wider than the 592px column, so it capped nothing and summary lines ran to 85 characters. In the side column the brand mark, the New episode icon and the navigation icons start at 28px and their labels at 68px.
- Why: the third critic round found one blue meaning three things, a bar that was raised above the page over a navigation that was sunk, and lines too long to read.
- Cost: the New episode button is the loudest tonal shape on a page; the 34rem measure leaves 64px of the reading column empty on desktop.
- Rejected: a filled New episode button (it would compete with the page's one filled action, Play); a hairline between the bar and the navigation (D72 took it off the navigation).
- Amends: D72, for the New episode button and the player bar.

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

## D88: On a reading page the section strip is opaque, a focused headline is ringed as one block, the playing hero Play is tonal, and an older briefing offers Share only

- Date: 2026-10-12
- Decision:
  - The section strip under the hero is a non-scrolling sticky bar that carries the surface and the hairline; only the scroller inside it is masked, so text scrolling under a stuck strip no longer shows through at its edges.
  - A keyboard ring on a two-line headline is drawn round the heading, not on each line box of the inline link (the second line's gap band struck through the first).
  - While a page plays, the hero Play steps down to the tonal container, shows a pause glyph and the time left ("1 min left"), and the cover's pause disc waits for a pointer or focus; the current story's headline keeps its ink (the accent is the link hover colour). Only story chips show bars.
  - The latest briefing's menu offers "New briefing" (its sheet says since when it covers, from `sinceLabel`); an older briefing offers Share alone, because the old Regenerate opened a sheet that makes a new current briefing from any page. An episode keeps Regenerate with feedback.
  - The floating Play follows the shell in the page, so it no longer flashes in beside the hero's Play on load. The latest briefing at its dated address marks Today, so the app bar offers no Back there.
  - An episode's highlights use a briefing's summary when the story is in one; otherwise one turn about the story, without lead-ins, opening segues, the host's questions and sentences that repeat the headline, credited to the stored publisher (the host for an aggregator). A hyphenated word in a balanced headline stays whole ("mid-range"). The Why label reads "Why:", Highlights is regular weight like every section heading, and the expired-audio line is one sentence.
- Why: the third critic round measured each; on the real discussion most highlights were the other host's question.
- Cost: a readout story that is in no briefing and whose only turn restates its headline shows no highlight text; an older briefing cannot be regenerated from its own page.
- Rejected: a drawn ring on the link's own box (it breaks across lines); keeping the hero Play filled while playing (three filled controls on a desktop page).
- Amends: D77.

## D89: The time zone selector is withdrawn until the engine counts in a chosen zone; Settings summaries follow what was saved; episodes on request are Episodes

- Date: 2026-10-12
- Decision:
  - The Time zone row is gone from Daily and Weekly, and Time says "Stockholm time". The selector of D71 saved a value that nothing read: the cron route (`slotAt`), the gate (`decideRun`), the Next episode line (`nextRun.ts`), the status report and `run.yml`'s fallback entries all count in Stockholm time, so "New York" with 07:00 still ran at 07:00 in Stockholm, and its labels were wrong for half the year. `config/schedule.json` keeps its `timezone` field and the engine is unchanged. To bring the selector back the engine must count dates and hours in the chosen zone in `stockholmDate` and `stockholmHour` (core), the gate, the cron route and the workflow's schedule; that is a separate change with its own tests.
  - After a save, the index summaries ("Every second day at 09:00", "Nebius, Kimi K3"), the Topics list counts, the Daily and Weekly topic chips (a removed topic's chip is hidden) and the Sunday note follow what was saved for three minutes, as the pages do (D79). The code is lazy: `scripts/settingsSaved.ts` loads only when a saved edit or a pending model exists, and the summary functions live in `lib/settingsSummary.ts`, which the build and the browser share.
  - Episodes made on request are "Episodes" everywhere in Settings (the Library's filter calls them that); a topic that is in all three podcasts reads "All podcasts"; an off topic reads "Off"; the index counts the sources that are on ("9 topics · 9 of 11 sources on"). A general topic's switch reads "Use World".
  - Below 64rem a sub-page's title stands alone (the app bar's arrow leads up); from 64rem the full trail stays. Removing a topic goes back to the Topics list once the removal is saved.
  - Sources and suggestions are one row, 72px with the host on the second line and regular-weight names; the plus is a plain icon button. The second voice is "Discussion voice" and the hints under the voices are gone; a voice without a sample keeps its slot, and on a phone the value takes the second line.
  - The Add panel's Topic | Source switch keeps one height at every width (it grew to 349 to 497px on phones); Add source on a topic page has no Topic switch. The Model list says "No model called ..." when a filter matches nothing, and its default is called Default with no hint.
- Why: the third critic round found a setting that did nothing, summaries that contradicted the pages Back lands on after a save (the "settings revert" the owner reported, on the index), and five spellings of one noun.
- Cost: a source cannot be removed from the app (it is switched off with its checkbox, D69); a wrong feed stays as an unticked row. Left for later: a "Use x" option on the Model page, a message after removing a topic, main-switch styling for the on and off switches, and one field style inside each panel form.
- Rejected: honouring the zone only in the Next episode line (it would promise what the engine does not do); a disabled row with a note (a control that explains itself is the thing the owner called slop).
- Amends: D71 (the selector) and D79 (the overlay reaches the index and the lists).

## D90: The open player has one left edge, an even rhythm and two weights; its lists are one Tab stop each; a story is a story everywhere; Back goes back

- Date: 2026-10-12
- Decision:
  - Look: the Stories list has one left edge (the dot column is gone; the current story sits on the accent container, and is outlined in forced colours), its headlines are 16px regular like the transcript, and the transcript is regular weight too, so the said and the unsaid differ by colour and the weight is not the signal. The page's vertical rhythm is even (the handle sits 16px from the top and the art starts at 40px, which is the owner's "more margin on top"; the first list row shows above the fold of a 390x844 phone). The app uses two weights, regular and medium, and a styles test bans the third. The bar has no hairline and no hover layer over its whole width (the chevron is the visible open control). A sticky band keeps the open player clear of the status bar of a home-screen app. From 40rem to 64rem the docked bar's padding follows the page column; from 100rem the art grows (a page of 84rem, a column of 36rem) and, with a mouse, the story's source link shows under the title. On a wide touch screen the bar leaves out its transport and clock while the page is open, because the page has the same controls. The toast lifts over the floating Play only while that button shows.
  - Keyboard and screen reader: the transcript and the Stories list are one Tab stop each (arrows, Home and End move, Enter plays), and Tab follows the transport's visual order (the speed comes last). The dialog is the `.player` surface that holds the page and the bar, so a screen reader can reach the bar's controls, and there is one close control (the focus-only pill is hidden on a wide screen with a mouse). The live region is quiet whenever a visible notice or control already speaks: no speed announcements, no error or interruption while the page is open, offline and online only while it is open. The end says "Episode finished."
  - Names: a story is a "story" in the scrub bubble, the slider's value text, the announcements and the bar ("Story 6 of 12 · Design engineering", "Story 1 of 6" on an episode); the tab, "Chapters" until now, is "Stories", so it matches "Previous story" and "Next story".
  - Copy and states: a narration refusal reads "Daily narration limit reached. Try again tomorrow."; unavailable audio says so by the noun (episode or briefing); one interrupted line, "Paused by another app", with Resume; in an error the disc shows a refresh glyph, the story line and source link are hidden, and the notice's action is a text button in the notice's own tone. The offline page loses its glyph once online; the 404 says "Check the address."; on desktop the empty state is centred in the pane; New episode is disabled while the device is offline.
  - Back: the app bar's Back goes back one entry (it listens in the capture phase, because Astro's router prevents the click first), so Today, an earlier briefing, Back lands on Today, and a Library sort or search survives Back from an episode (D78). The static address is for a cold open.
- Why: the third critic round measured three left edges in one column, gaps from 10 to 59px between the player's rows, 29 Tab stops through one transcript, two buttons called "Close the player", four announcements said twice, and a Back that went to /library.
- Cost: the two-column layout from 64rem has no safe-top band; Up next's second line is not yet the Library's facts line (the player only knows `prev_id`; the page build would need to pass a `prev_facts` string); the black-translucent status bar style is unchecked on a real iPhone in the light theme.
- Rejected: a hover layer on the stretched dock link (it fired from the gaps between controls); keeping "Chapters" for a list that is also called stories in four other places.
- Amends: D85 (the Chapters name and the player's nouns).

## D91: Daily and Weekly offer only what a briefing uses, and an edit made inside the server's gap survives leaving the page

- Date: 2026-10-12
- Decision:
  - Daily and Weekly show Time (Day on Weekly), Repeat, Topics, Length and one Voice. The Format segment, the Voices head and the second voice are gone from both pages. A briefing is narrated from its digest as written, so Format was saved and not applied and the second voice was the discussion's; New episode keeps both for episodes. The stored fields (`type`, `voice_id_b`) and the engine are untouched, so nothing migrates and the rows can return when a briefing is built as a discussion.
  - A save that waits out the server's ten second gap now outlives leaving the page. The toast's popover calls threw on a toast the page swap had removed, before the request was sent, so the second of two changes made inside the gap was lost while "Saved" showed. Every toast call is guarded and none can skip the request; the toast says "Saving" as soon as a change waits; leaving the page writes the waiting edits to storage marked `pending` (shown for 90 s at most, dropped when their request fails), so the next page shows them ("Saving. Live in about a minute."); changes made on that next page while the run is still busy are sent after it.
  - Remove topic replaces the removed topic's page in history, and a removed topic's page opened before the build replaces itself with the list.
  - Look: every segmented choice marks its chosen option with a check (Length did not); controls share one width of 22rem on Settings, podcast and topic pages; link rows end at the edge and read like their neighbours (Edit topic ends in a pencil, a new glyph in `tokens/glyphs.json`); a custom topic's single Weight row has Design's shape; a suggested source is a three-line row of 88px from 40rem and says "Added" once; a switched-off general topic's counts and sources read as off (the Topics index counts a source as on only while its topic is on); the Add panel says "All podcasts" when all three are ticked.
  - Round five: a feed address never widens the Add source panel (its form, card and facts are one column that may shrink); the model field has the row's room (16rem from 40rem) and a longer name ends in an ellipsis, not in half a name; a refused suggested source says "Not added. Try again." with its plus back, and pressing it sends the same add once more (`Pending` takes `fail` and `done` hooks); a general topic switched off keeps its sources legible (names quiet, tiles faded) instead of dimming both lists to 1.6:1.
  - Round six: a refused change is marked failed and left out of what the next page shows (it was kept as pending, so a reload showed "Added" for something nothing would send); a queued topic row says "Not added yet. Press Retry."; the sender loads when the browser is idle, while online, so a change made offline reaches a request that fails with "The site could not be reached. Not saved yet." and Retry (a chunk that fails to load once stays failed in the browser, and a retry online made Vite reload the page, losing the change).
- Why: the fourth critic round found that changing two things and pressing Back lost the second edit while the page said Saved ("the settings revert" again), and that Format on Daily was a choice the product ignored, which the owner has called slop.
- Cost: Format and a second voice cannot be set on Daily or Weekly until a briefing can be a discussion (the daily Type item under Not working stands). A pending edit shows for up to 90 s even if its request never goes (a tab closed in the gap).
- Rejected: leaving the Format row with a note (a control that explains itself, D89); keeping the second voice on a Daily that never uses it.
- Amends: D74 (the second voice's place on Daily and Weekly) and D79 (the quiet wait inside the gap no longer loses an edit).

## D92: The rundown is no story, a listener's move never scrolls the page, the open page owns the transport, and a glyph says what its button does

- Date: 2026-10-12
- Decision:
  - The rundown before story 1 belongs to no story. `itemIndexAt` is -1 until the first story starts; there the bar and the page say what the recording is ("Discussion · 2 min", also for a recording of one story, which no longer reads "Story 1 of 1"), no Stories row is current and the scrub bubble shows the time alone. Next goes to story 1; Previous goes to 0:00 and is disabled there. A story is found from the exact playhead, not the floored second (a story starting at 0:18.6 was placed in the rundown at 0:18).
  - Below 64rem a move made with the controls (a story step, a scrubber key or drag) never scrolls the page: a press or key on the controls holds the transcript's follow as a wheel or a touch does, and the follow does nothing while the transcript is below the fold. From 64rem the list scrolls in its own column and keeps following.
  - One transport at a time: from 40rem the bar under the open page shows only what is playing (its transport is hidden in place; with a mouse from 64rem it keeps its clock beside the seek line), and the page shows its five controls with a mouse too, so one Pause and one filled play control are on screen.
  - The page's story line is one line with one line of room (an ellipsis for a longer headline; the full one is in the list and on the bar), kept off in an error; in the rundown the phone page keeps the room, so nothing moves when story 1 starts.
  - The run indicator's bar starts from empty when the run id changes (a Try again no longer starts at the failed run's two thirds), and its announcement is a hidden status line that holds only the line, not the card with its buttons.
  - A glyph says what its button does: refresh for "Try again" (error), replay for "Play again" (ended), play when paused or idle, pause when playing, on the page's disc and on the bar, from one rule (`transportGlyph`). A list title that stands alone ("Up next", "Stories" on a briefing) is plain text with no rule, so it no longer reads as a tab row with one tab. A story's play chip keeps one width (`min-inline-size: 7rem`) so the publisher beside it does not move as it plays. On the reading page a story is marked played only when it was heard: playing went on out of it into the next, or it was the last and the recording ended (`createHeardTracker`). A tap on Play from here, a scrub, a seek, a key step and Next or Previous mark nothing, and a replay starts afresh; the first version of this (a run that a one-story move kept) marked stories nobody heard after a scrub or a held arrow key. When playing goes on into the next story the page follows only a reader who is reading along, that is when the story that just ended is on screen; one who has scrolled elsewhere is not pulled back to the voice.
- Why: the fourth critic round measured one tap on Next scrolling a phone page by 601px, so a second tap seeked backwards; Next skipping story 1 and Previous going forward in every episode; two Pause discs under the open page at 820 and 1280; and a "Try again" button that drew a play triangle.
- Cost: the bar's Previous and Next are gone under the open page from 40rem (the page's row and the Stories list step stories). The first-load JavaScript grew by 0.8 KB (108.0 to 108.8 of 110 KB). The phone page keeps empty room under the title during the rundown.
- Rejected: taking only the fill off the bar's play disc (still two Pause controls); a story's chip with the length as its label in every state (it hides which story is playing).
- Amends: D85 (the position label and the story lookup) and D90 (the dock's duplicates were removed for 64rem with touch only).

## D93: A tab's jump puts the app bar away first, a headline word kept whole stays atomic, and offline switches off every control that starts a run

- Date: 2026-10-12
- Decision:
  - A section tab's jump down sent the app bar away after the browser had placed the heading, so the strip rode up and the heading ended 56px too low (81px under the strip, not 24). The header now hears of the jump first (`dispatch:jump`, announced in the capture phase, since Astro's router starts the jump in the bubble phase), puts the bar away for a jump down and holds the bar as it is until `scrollend` (or 600 ms); a jump that goes nowhere leaves the bar as it was.
  - The word kept whole in a headline (a hyphenated name) is an `inline-block`, not `white-space: nowrap`, which made `text-wrap: balance` count the line as unbreakable and left lopsided first lines.
  - Offline, every control that starts a run is disabled and reads as disabled (a surface-container fill with disabled ink): New episode wherever it shows, the hero menu's New briefing, an episode's Regenerate and Delete (which follow the connection themselves, so an episode reached while offline has them off too), and the Play of a briefing whose narration is made on Play. Each points at the banner's line, which now says "Audio and new episodes need a connection." The banner starts on the page's first line from 64rem, and the offline page keeps an icon (wifi) and says "Back online" in its title when the connection returns.
  - Joins between screens (round six, from a critic that walked whole journeys): the Library's root is found inside the page's main, because the run line's "Open Library" link carried the same `data-library` and after any run every Library control was dead until a reload; Today's briefing chip says what the Library's card says (the time left where it was left, or Played, from the same storage), and the cards follow the player's saves; a delete returns to the Library as it was left and counts what is there; a rewrite says "Rewritten. Live in about a minute." (it said Episode ready before the site had redeployed); a cover that cannot be fetched shows its palette, not the browser's broken glyph; every cover has one art at every density (only the player's own offers the 1024, which carries the signature).
  - A tapped section tab keeps its mark until the page is scrolled away from where the jump landed (by anything: the scrollbar, a find, the player following its story), not only by a wheel, a touch or a key.
  - Typing in a field does not switch the input mode to keyboard (the Library search drew the keyboard ring while the pointer had focus); the search pill lifts (a raised shadow, `--shadow-raised`) while focused.
- Why: the fourth critic round measured the 81px landing at 360, 390 and 768, four lopsided headlines out of seven with a hyphenated word, a 1.04:1 label on a disabled New episode while three other run starters stayed live, and a banner 40px above the page's first line.
- Cost: a jump down from the top of a page also hides the app bar, which returns on the next scroll up; the offline wifi glyph's path was composed by hand because the icon CDN was unreachable (`--fetch` replaces it with Phosphor's own).
- Rejected: U+2011 for the unbreakable hyphen (Google Sans Flex has no glyph for it).
- Amends: D88 (the strip's landing and its bar).

## D94: Up next narrates a briefing without audio, a phone's page never scrolls itself, a failure is told once, and the open page closes with a mouse

- Date: 2026-10-12
- Decision:
  - Up next narrates a briefing that has no finished audio, by the cover press's path (`playBriefingOnArrival`, `expectPage`). Before, it loaded the page, played nothing and the bar went away; most briefings are narrated on Play.
  - On one column the transcript is followed only once the listener has scrolled its top into the upper half of the screen, never from where the page opens. The page opened with the top at 773 of 844, so each turn scrolled it by itself (215, 337, 460px) and carried the cover and scrubber off screen. A hold that ends offers "Back to now" and does not jump.
  - In an episode's rundown the page's reserved story line says what the recording is ("Discussion · 4 min"). A mouse between 40 and 64rem gets the bar's chevron to close the open page; while the page is open the wide bar's transport leaves the layout, so its clock sits by the seek line. Below 64rem the run bar runs along the card's top edge, apart from the player's own line.
  - A failure is told once, with its reason: a mid-briefing narration refusal surfaces through the player's error (the playlist's `describeFailure` text) and no toast; no copy says "press play" where the disc is Try again; the bar names the recording in an error; a failed play is announced once, and a missing file not before the first press; the hero chip has an error state that draws the refresh glyph.
  - Small: Up next's text shares the rows' left edge; the page title uses `text-wrap: pretty` (a balanced, clamped title lost its ellipsis); the speed slider's ring has room above it; Try again and Dismiss on the run indicator leave focus on the page.
  - Round six, the player (a critic that drove it again): only a message the narration adapter marked as its own reaches the notice, because Chromium fills `MediaError.message` on every real failure and the first version of this decision showed and spoke "MEDIA_ELEMENT_ERROR: Format error" for a missing file; a refusal that stands (the daily cap, the budget) is its own error kind with no Try again on the notice or the disc, a bar line from the reason, and a repeated press says why again; "could not be made" no longer sits beside a Try again button. On a wide screen the cover and Play keep their place from the rundown to story 1 and in a failure (the source row's room is reserved). The bar's chevron points up at every width, and focus goes to the open button when the focused control hides. "Back to now" shows only while the current turn is out of view, and on two columns following scrolls the list and never the page. A failed recording has no current turn. Previous after the end plays the last story. A long title keeps its last dot (`padding-inline`), the speed rows have a gap under the slider's ring, and the wide bar's clock is centred.
- Why: the fifth critic round measured the page scrolling itself at every turn on a 390x844 phone, an Up next that dropped the listener, and one failure that said three different things; the sixth found the browser's debug string and a standing refusal offering Try again.
- Cost: first-load JavaScript is 109.9 of 110.0 KB (0.1 KB left; `/library` is the largest page), so the next feature has to come off something or load lazily, or `postbuild` fails the Vercel build. The floating Play button takes the chip's error state but has no style for it, so it still shows play. An episode's sign-off is still labelled as the last story, and PageUp and PageDown go opposite ways on the page's and the bar's scrubbers.
- Rejected: following the transcript on one column from where the page opens (the page then moves under the listener at each turn); a toast beside the player's own notice.
- Amends: D92.

## D95: The Library's search finds the start of words, a list row keeps its title level, and a segmented choice keeps its width

- Date: 2026-10-12
- Decision:
  - A query word matches where a word of the text starts, in the cards, the full-text index and the excerpt: "lat" finds "latency", "ai" no longer finds "detail", "Hairline" or "OpenAI" (it did, and bolded the middle of them, so the app's own topic returned every card). A number still matches as a whole token. An episode whose script matched says "Mentioned in the episode".
  - In the list view the match line has a track of its own, so a title sits 12px under its row's top with or without a match (it gained 20 to 40px), and the half-heard bar lies along the foot of its cover wherever the row's height puts the cover.
  - On the New episode page from 40rem a segmented control keeps its width as the choice moves: the check takes no room (as a filter chip's does) and the chosen words slide by half of it. The options column uses the main column's label rhythm.
- Why: the fifth critic round found the search flooding on a two-letter query, rows jumping as matches appeared, and Format growing 221 to 251px under the pointer.
- Cost: a word inside another ("ai" in "OpenAI", "tency" in "latency") is not found; it is found by its start.
- Rejected: matching anywhere for words of four letters or more (two rules for one field).
- Amends: D78 (what the search finds).

## D96: An empty screen is one simple illustration, a title, one line and one filled action

- Date: 2026-10-12
- Decision:
  - Every screen with nothing to show has the same four parts, centred: a spot illustration, a title (22px, regular), one muted line (about 36 characters wide) and one action, the filled `.btn-primary` pill, with a text `.btn` beside it for a second way on. The illustration is inline SVG (`components/EmptyArt.astro`, one 240 by 180 canvas): one flat focal object of two to four shapes, three tones from the theme's own roles (the accent container, a deeper step of it, the accent) mapped by classes in `styles/empty.css`, so both themes follow and nothing carries a colour attribute. It is `aria-hidden`, and forced colours hide it. A scene is 0.25 to 0.45 KB of markup; no script, no request.
  - The scenes: Today with no briefing (a cover with a play disc), an empty Library (a dashed square with a plus; New episode), a search or filter with no result (a card and a magnifier; the Library's script still writes the title and the button from `emptyCopy`, and the line under the title follows the search box in CSS, `:has(:placeholder-shown)`, so `libraryPage.ts` did not grow), offline and back online (the signal glyph cut by a slash, and the same with a check; both are in the page and `data-state` on the section shows the one that is true), 404 (a document and a pin), and a topic with no sources (the dashed square at 96px beside the existing Add source).
  - The title is the page's h1 on a page whose only content this is (Today, offline, 404) and an h2 under the Library's own title. A full-page state sits a little above the middle of the screen, and the art draws about 250px across from 64rem.
- Why: the owner asked for "beautiful empty state illustration with title and an action button", then, when the first scenes carried a ground, floating marks, a shelf, a waveform and a clock badge, "keep the illustrations simple". The scenes were redrawn to one object each; the byte count fell by half or more.
- Cost: an empty Library on a desktop shows New episode twice (the side column's and the empty state's); the Today and Library scenes could only be seen in an emptied copy of the site (the fixture build always has content), so axe never ran on them, and they are tested from the component source.
- Not done: "Nothing cleared the bar." (a banner above a briefing that is there, and a sheet result) and the player's Up next, transcript and the source panel's search have no scene; "No topics yet." on a podcast's page stays a quiet line, since the row under it is the action.
- Rejected: an illustration set as image files (a request each and no theming), an animation, a different palette for each state.

## D97: What the device remembers reads the same everywhere, the worker keeps what a page fetches, and a refusal reads the same on every control

- Date: 2026-10-12
- Decision (the seventh critic round, journeys and player):
  - A tap loads 0.05 s of silence so a phone lets the element start later, and its duration reached the store; a reload of the same episode with other audio then saved position 0 of 0.05 s as the end, and the Library said Played for an episode paused at one second (a refused narration made it permanent). The store ignores a file under a second, and a duration inside the finished tail is never "finished".
  - The service worker saved nothing it fetched at run time: `store()` cloned the response after an `await`, when the page was already reading it. It clones first, warms a page's scripts six levels deep (as the install does), and its cache is v7. A settings page opened offline in a later session has its editor, so a change is kept and sent when the connection returns instead of vanishing.
  - The stories heard are kept per recording beside its position (`dispatch:heard:<id>`, item ids, ignored without a position or the end), so Resume and a reload show the stories before the playhead as Played; a briefing with no stored audio (narrated on Play, most of them) builds its chip and the floating Play from what the device remembers against the page's estimate (`data-minutes`), so the chip, the floating Play, the Library's card and the Earlier shelf say the same ("Resume the briefing, N min left", "Played"); the floating Play takes the chip's words; the card's bar and Played moved out of the Library's script into the player runtime (`cardProgress.ts`) so the shelves show them too; a failed story is not current.
  - Delete clears a finished line about its episode, a finished rewrite older than ten minutes is not shown by a page that opens, the run status region is emptied when the card hides, Back after Delete lands on the Library as it was left, a refused rewrite or removal reads "You can do that again in N" (as Create does), and a queued topic that was refused says "Not added yet. It goes with your next change." instead of pointing at a Retry the toast may have lost.
  - Errors: in a standing refusal (daily cap, budget) the hero chip takes the play face with the bar's reason, and on the open page a repeated press mounts the alert again so the reason is spoken again; a 503 `unavailable` is a passing failure with Try again (it stood until a reload); the room kept under the open page for a notice is kept only from 46rem of window height, and below it the cover gives way while a notice shows (1280x600, 1280x680 and 1366x650 scrolled the page and hid the reason under the bar); when the connection comes back a network failure retries by itself; Next or Previous out of a failure plays the story it lands on; a failed file reads "Audio could not be made" on the bar as in the notice; Space plays and pauses on the bar's seek; the bar's Tab order on a phone follows the bar as drawn (`reading-flow: grid-rows`).
  - The lab-only player specs, not run in this session until now, asserted the old played marks; they assert the heard rule (Next, a chip tap and a section jump mark nothing; playing on out of a story marks it).
- Why: the journeys critic found two P1s (an item stored as Played before it was heard; a settings change lost without a word in a session that did not open the page online) and three P2s; the player critic found five P2s, among them a regression from the previous round's own fix on common laptop windows.
- Cost: the Library page is 109.9 of 110.0 KB (about 0.1 KB left), so the next feature there has to come off something; the player runtime carries the card code every page now; `reading-flow` is Chromium only (the other engines keep the DOM order); the heard set is a space-separated list in storage.
- Not done here (D98 closed the 1024 touch jump and "Playing." before a failure): a very long turn and Back to now; the Stories list does not follow the current row on two columns; the "Preparing audio" chip's name and a second tap; the bar is gone after a reload on every page (a mini player that survives a reload needs a stored snapshot of the recording).
- Rejected: catching a failed import on the settings pages and switching their controls off (the worker keeping the scripts makes it a rare case, and the pages' budget is thin); skipping the save when only the audio of the same digest changed (the position is handed from the old audio to the new on purpose); retrying a failed dynamic import (the browser keeps the failure).
- Amends: D92 (the heard rule now persists), D93 (the joins between screens), D94 (a failure is told once, now on every control).

## D98: A lost held change is told to the page that is open, a failure notice takes the story line's place, and an empty scene draws an object, not a control

- Date: 2026-10-12
- Decision (the eighth critic round):
  - A settings change that waits out the server's 10 s gap belongs to the page that was left, and when its request ends that page cannot say how. It now fires `dispatch:held` with the outcome and any lost changes; the page that is open flips its note to Saved, or adopts the lost changes (they are older than its own) and shows its toast with the reason and Retry, and an alert for a screen reader; Retry, or the next change, sends them once. A lost connection is the same: Retry offers the change again when it is back. Several left pages in a row each stay pending until their own run ends (the second used to overwrite the first). The Settings index recomputes its rows and says "Your last change was not saved." (it has no toast). Nothing now says "Saving" for a change that is going nowhere.
  - A briefing with no audio keeps `dispatch:heard:<id>` when its page opens (it has no timeline to name stories by, and an empty set was written back). A page that stands in for an address the worker could not fetch asks the site (`/api/status`; any answer will do) before it says "You are back online", because `navigator.onLine` is true on a weak signal or a captive portal.
  - The player's failure notice is drawn in the story line's room under the title at every width (a portal into `data-notice-slot`), so nothing below the title moves when a failure arrives, goes or is retried. The padding reserved under the transport and the 0.7 cover cut are gone, which three rounds of height rules had made worse in turn (a 70px jump on one column, a 30% cover cut on short wide windows, an overflow on tablet landscape). With touch from 64rem the cover is bounded by the window's height. Only a failure made while offline (its own `offline` error kind) retries by itself when the connection returns, so a 500 or a 503 cannot start sounding when a phone changes networks; offline there is no Try again, the disc says Play, the bar and chip say "You are offline", and "Playing." is announced only once sound starts. In a standing refusal a tap, step or row onto a story whose file exists plays it; focus after the notice's Try again stays on the disc; the wide bar's seek is the first Tab stop again (`reading-order: -1`); a replayed finished briefing clears its old marks and keeps the story just heard.
  - Empty scenes: Today and the Library drew a filled disc in the primary button's own colour (a play disc, a plus), which read as a control that does nothing and outshone the one action. They draw the mark (a triangle, a plus) in the scene's deeper tone on the plane. Each scene's box is cropped to its drawing, so the title sits exactly 24px under it at every width and the full-page states no longer scroll. No results hides the floating New episode, uses the small art on a short screen and wraps and clamps a long query; four lines of copy are true in more states (the schedule is not "every second day"; a general topic's sources reach episodes); the filled action keeps an edge in forced colours.
- Why: the journeys critic found one P1 (the flow D91 was written for: two quick changes, then Back, the held one refused: the next page kept the new value and "Saving") and five P2s; the player critic found four P2s, three of them regressions of the previous round's fixes.
- Cost: touch at 1024x600 draws the cover about 120px high; the empty Library on a desktop shows New episode twice (kept on purpose: the owner asked for an action button on each empty state); `reading-order` is Chromium only; the install hint loads when the browser is idle (it paid for the player's fixes: the Library page has 0.6 KB of room now, 112,056 of 112,640 bytes).
- Not done: Back after Delete flashes the deleted episode's page for about 0.2 s; the floating Play shows a play triangle beside "Played" where the chip shows a check; Generate stays live offline with the New episode form open (it fails with a message after the press); a very long turn and Back to now; the Stories list does not follow the current row on two columns; the "Preparing audio" chip's name; the bar is gone after a reload.
- Rejected: putting the old values back on the open page after a lost held change (reverting topic pages cleanly was not feasible, and adopting the change gives the listener a Retry); another height rule for the notice; probing `/latest.json` for the stand-in (the worker answers it from its cache while offline).
- Amends: D94 (a failure is told once, and no longer moves the page), D96 (the scenes' marks), D97 (the held run and the retry).

## D99: The test suite protects what fails silently, in one layer, once; the dev lab is retired; a refused model choice, a lost held change and a press in a failure are told

- Date: 2026-10-12
- Decision (the owner's test-suite audit, and the ninth critic round):
  - A test earns its place by naming the bug it prevents, and the bugs worth a test are the ones a person cannot see on a screen: state that survives navigation, reload or time, ordering, money, security, caches, platform quirks, build steps. Copy, CSS, class names, markup, geometry, constants and snapshots are not pinned; screenshots and journey critics judge them, and design rules are held by one rule table and by Biome (`noImportantStyles` is an error). One behaviour has one test in one layer. The evidence and the rules are in [the postmortem](engineering/postmortem-test-suite.md), and `AGENTS.md` carries them.
  - A browser test runs once: on the phone unless it is tagged `@desktop` (desktop only) or `@both`. The player suite runs only against the fixture site (`@desktop` and `@wide` add a 1280 mouse run; `PLAYER_WEBKIT=1` adds an iPhone `@smoke` set, unrun here); `retries` is 0. The dev lab (`src/player/dev`, `astro dev` as a second web server, its 67 lab-only tests) and the Settings sheet only it could open are deleted: the player specs drive the product page.
  - Real code, fake world: handler tests keep the real passphrase verifier and give it a cheap hash in the real format (the verifier reads N, r and p from the stored value); the server's 10.25 s edit gap runs on `page.clock`; engine tests read frozen config under `packages/engine/test/fixtures/config`, and only `committed-data.test.ts` reads the live config and state; `workflow-contract.test.ts` runs every `dispatch` call in `.github/workflows` through the CLI's parser. Briefs no longer say "add a test for every fix"; `dispatch-worker` and `/close-session` carry the rule; a worker's report states its net test count; the browser suites have a budget (unit 2 minutes, site 7, player 4, on a 4-core container).
  - Round nine: the Model page's own note is written only once its request was accepted (a refused choice no longer reads Saved after a reload or on the Settings index; a choice still waiting is read from the pending edits); a held change refused while Today or the Library is open is told in the app's toast ("Your change to Daily was not saved.", with Open); a story whose file a standing refusal cannot make fails at its start, so a press plays nothing of the story before it and says no "Playing."; offline a press repeats its reason and loads nothing; a retry is announced as what asked for it; a press on Play in a failure scrolls the notice into view when the page was scrolled past it (a failure that only arrives scrolls nothing); the Library's long query is quoted to 24 characters, New episode stays under "No episodes yet", and the empty Library no longer scrolls; the wordmark names the briefing only when there is one.
- Why: the owner called the suite ridiculous for a simple application. Four read-only audits found the unit layer mostly earned (88% of the engine's tests and 92% of the web unit tests kept) and the browser layers full of change detectors, duplicates, dead targets and one second target: 29% of the site e2e declarations and 41% of the player e2e ones to delete and a quarter more to merge, 1,935 listed runs, about 32 minutes, none in CI. The suite had also passed every P1 that critics found by walking journeys. The postmortem names the causes: briefs and records that only ever said to add tests, green as the only exit criterion, no owner for the suite, and tests aimed at what is easy to assert.
- Cost: unit tests fell only 4% (the rest is real logic), browser runs from 1,935 to 429 and their time from about 32 minutes to about 10. The cuts rest on code reading and on a check that re-breaking each fix of the branch still fails a surviving test, not on mutation testing. The browser suites are still outside CI, the site suite at 6.4 minutes is not yet as lean as the audit's 4 to 5, and the WebKit set is unverified. The model note, the held-change toast and the notice scroll add a little code to lazy chunks; the largest first load is 109.4 KB of 110.
- Rejected: one shared passphrase gate for the four POST handlers (their checks differ in what they read and in order, so it is not a pure move); a fake verifier (the real one is cheap with a cheap hash); a CI job for a phone `@smoke` set and a WebKit project (workflow changes the owner merges by hand, listed under Next); mutation testing.
- Amends: D91 (the held change, now also when it is refused away from Settings), D97 (the Model note) and D98 (the notice and the lab).

## D100: The time zone selector returns and the schedule counts in the chosen zone; Daily and Weekly offer Format and a second voice again; every voice row keeps its play button

- Date: 2026-10-12
- Decision (the owner asked for all three back):
  - `schedule.timezone` is the schedule's wall clock. The daily hour, the weekly day and hour, the date the gate decides for, the cadence arithmetic, the date part of new digest ids, the cron route's slot, the Next episode line, the Settings summaries and the status report are read in it. Fifteen zones are offered (D71's list, plain city names, no CET or CEST); `schedule.set` refuses any other, and a stored zone outside the list reads as Stockholm. The default is Europe/Stockholm and every Stockholm result is unchanged.
  - Bookkeeping that is not the schedule stays on Stockholm (`TIME_ZONE`): the narration caps and usage month, pruning, source scoring, `learn`, episode file dates and the build date. A few readers that compare a digest's date with today (`sinceLabel`, `pendingAudio`, `podcast/select`) still use Stockholm's today; in a zone far from Stockholm that moves a window edge by a day for some hours a day, and nothing else acts on it.
  - `RUN_CRON` (the fallback schedule, set from Settings) is the Stockholm hour the chosen local hour falls on now. It is exact only until one of the two zones changes its clock; the Vercel cron route asks the zone every hour and is exact. A half-hour zone (India) works with the hourly cron: the route fires when its UTC hour overlaps the slot, so a run may start up to 30 minutes early, and the gate dedupes.
  - Format and Discussion voice are rows under Episode on Daily and Weekly again (saved as `format` and `voice_id_b`). A briefing is still narrated from its digest by one voice (`scheduledVoice` in `server/narrate.ts`), so both take effect only where a discussion is made, not in a briefing's narration. The page does not say so.
  - A voice row's play button is always there: pressable when the chosen voice has a sample, dimmed and labelled "No sample for the ..." when it has none. Hiding it made the Discussion voice look as if it lacked the control.
- Why: the owner asked for the time zone ("I don't know if you have an argument against it"), for the second voice on Daily and Weekly, and for the second voice's play button. D89 withdrew the selector because nothing read `timezone`; the gate, the cron route and the screens read it now, so it is no longer a control that does nothing. D91 withdrew Format and the second voice for the opposite reason, a briefing ignores them, and that is still true; the owner chose to have them, so this records the gap instead of hiding it.
- Cost: Format and the Discussion voice are saved settings a briefing does not use, which is what D91 removed, accepted on request. Making them real is a discussion briefing: a podcast step in `audio.yml` (a workflow change the owner merges by hand), a writer call per briefing and the narration cost. The fallback entries in `run.yml` were not edited (a workflow change), so after a clock change in either zone the fallback hour can be an hour off until Settings saves the schedule again; the cron route stays exact. A half-hour zone starts a run up to 30 minutes early. The fifteen options are server-rendered; the largest first load is still 109.4 KB of 110.
- Rejected: on-demand synthesis of a sample for a voice that has none (it costs per press and needs an abuse cap); editing `run.yml` to follow the zone; every IANA zone (D71's fifteen are enough and keep the tests finite).
- Amends: D71 (the zone list), D89 (the selector returns) and D91 (Format and the second voice return).

## D101: A long list is a searchable list; the bar keeps its controls on a wide screen; every recording has a transcript; every topic is shown

- Date: 2026-10-12 (evening, the owner's list after #93 went live)
- Decision:
  - A time zone and a voice are chosen from a list with a search field (`scripts/picker.ts`, `picker.css`): a button wears the select's looks and opens a popover under a search box; every word of the query must match, in any order, with accents and case ignored (`lib/pickerFilter.ts`). The select stays in the page, hidden, and holds the value, so the editor and the Create form still read a select and hear its `change`. Zones read "Stockholm (GMT+2)", worked out for today in the browser (`gmtOffset` in core), and the list grew from 15 to about 55, whole-hour zones only (India's half hour stays the one such zone). A voice is searchable by name, gender and accent in words. A list that could not be loaded says so inside the open list.
  - The New episode form is ordered Written for (General, Somesh; no heading on screen, named for assistive technology), Topics, Length, Format, Voice or Voices, then More options (Look back, Tone, Title). Each voice has the sample button Daily and Weekly have (`scripts/voiceSamples.ts`, shared). The Dry tone is gone from the form, the engine's prompt and the validators. The panel is 32rem wide with more air between groups.
  - Daily and Weekly show every topic. The five general news topics are shown locked (dashed, a line says they are for episodes you make): they play in no scheduled podcast yet (D69).
  - On a wide screen with a mouse the bar keeps previous, play, next and the clock under the open page, and the page holds only back ten, the speed and forward ten, the speed between the skips (the split D90 had; D92 had moved all five to the page). The speed is between the skips in the document too (`useMouseWide`), so Tab follows the eye. A touch screen and a narrower window keep D92's single transport.
  - Every recording has Stories and Transcript. A briefing's transcript is what the host says of each story (the digest's spoken version, else headline and summary; `PlayerItem.text`, `player/core/storyTurns.ts`), drawn by the episode transcript's own view with the story's headline over its words.
  - The Contents list is on the window's middle line from 80rem, stuck from the first screen (a rail as tall as the room under the top chrome, its list centred in it).
  - A card's title takes the accent under a mouse, so the title (opens the page) and the art (plays) answer differently.
  - Interface sounds cover every enabled control (see state.md); a close right after an open is a new cue, not an echo.
  - The Model page: the field ends the row as Provider does, a model is shown by its name with its context size and never by its id or its vendor's prefix, and the field for typing an id is gone.
- Why: the owner's list: voices "not all shown", a time zone that needs a search and its offset, topics missing on Daily and Weekly, the speed beside the skips, tabs and Contents that "I have told you multiple times", the model's id shown, a cramped New episode panel.
- Cost: first-load JavaScript is 109.7 of 110 KB (0.3 KB left); everything new is lazy. D100 rejected "every IANA zone"; this offers about 55, which keeps the schedule's tests finite and is searchable, and no half-hour zone was added. Format and the Discussion voice remain saved settings a briefing does not use. The model id can no longer be typed: a model the live list lacks cannot be chosen. "Narration is not available" was not reproduced: on the live site the lookup, the voice list and a sample answer, and a malformed narration request is refused as invalid, so the fault is in the synthesis step (the Blob store, Speechify or the day's counters) and needs the Vercel function log.
- Rejected: moving all the controls into the bar (it does not fit the left column at 1024px); a per-voice play button inside the list (nested controls in an option); a success sound on every autosave (a change already ticks).
- Amends: D76 (the form's order), D90 and D92 (where the transport is), D100 (the zone list, the voice rows).

## D102: General topics play in Daily and Weekly; a topic is always on and has a summary card; the bar has no chevron; the gate runs in parallel

- Date: 2026-10-13 (the owner's feedback on the pages at 2038x974, and "why is development so slow")
- Decision:
  - The five general news topics can be ticked on Daily and Weekly like any other topic (D69 had them locked). Ticked, each publishes a section of its own id and name (two stories, outside the briefing's cap, never in Top picks; a story only one outlet carried never publishes). A schedule file without the new `general_scoped` marker reads as skipping them (`effectiveSkipTopics`, core), so today's briefings do not change; the first edit of a skip list writes the five ids and the marker (`withGeneralScope`). The site shows the lists the engine reads, so the chips start unticked and a tick is a real change. Weekly judges only stories the same run's daily pass did not.
  - A topic has no on and off switch: it is always on and open to every podcast. `enabled` stays parseable in `config/topics.json` and is read for no general topic. The topic page's Podcasts list is shown for general topics too, with no weight.
  - A topic's page opens with a summary card: a picture drawn from its id and name in the covers' language (`packages/cover/src/topicArt.ts`, deterministic, no request), its name, what counts as it, and a More menu (Edit; Delete for the owner's own topics). Sources has an outline Add source button level with its title; a source row shows its address, how many stories of it reached a briefing, and its score. The way up is a line over the card from 64rem.
  - The bar has no chevron. The whole bar opens and closes the page; the keyboard's Close button now exists at every width.
  - Library and Settings titles are the display size, as a briefing's title is (they were 22px from 64rem, D87, D89); every page starts 64px from the top from 40rem (was 48px); a hero's cover is 8rem, so the title, its facts and Play fill its height; the Contents list has more room inside each entry; a card with a progress bar has a shade under it; the Library's sort chevron is 16px; the check in a chosen segment is 6px from its word.
  - Copy: Custom for Episodes (Library filter and Podcasts list), AI Model, Last updated (the build's day, not a version), and the Topics row says only how many topics and sources there are. The "Next episode" line is gone from Daily and Weekly, with `nextBriefing`, `nextWeekly` and the page script that rewrote them; Weekly's off line sits under its switch.
  - The New episode panel has more air (gutter and group spacing from 40rem) and a stable scrollbar gutter: opening More options added a scrollbar that narrowed the column by its width and rewrapped every control, which was the shake.
  - Tooling: `npm run gate [-- --build]` runs typecheck, the site's type check, lint, the unit tests and the build in parallel (79 s here; the four in a row through the agent's shell took 321 s). `npm run typecheck` now includes `astro check` (the whole of `apps/web` was outside every gate; 22 errors were fixed). `scripts/worktreeLinks.mjs` links a worktree's packages and takes them off before the worktree is removed. `dispatch-worker` has 90 turns, commits early and reports by call 70; `dispatch-verify` runs the gate through PowerShell and no longer kills what listens on 4321, which is the owner's dev server.
- Why: the owner's list, whose earlier round had "tabs and Contents that I have told you multiple times". For speed: every process started from the agent's Git Bash cost 3 to 8 s while PowerShell starts one in 50 ms, so a one-file test took 37 s instead of 1.4 s; two workers each used 60 turns and reported nothing, as `learnings.md` said they would; and the type check the owner's rule calls a gate did not look at the site.
- Cost: `general_scoped` is one more field in the schedule file. A ticked general topic adds two stories per topic to a briefing and, on Weekly, up to 600 judged items (the ceiling); nothing has run live. The generated picture is abstract art with an initial, not a photograph. First-load JavaScript did not grow (the build's own check passed at 110 KB). The site check adds about 40 s to CI's typecheck step.
- Rejected: photographs for topics (an image search needs a key, a licence per picture and a network at build; the generated art needs none, and a photograph can replace it later); topics ticked by default on Daily and Weekly (tomorrow's design briefing would open with world news); removing `enabled` from the schema (an old file would fail to parse); a second close control for tablets (the bar, Escape and Back already close it).
- Amends: D69 (general topics are no longer for episodes only), D87 and D89 (title sizes), D90 (the chevron), D101 (every topic shown, the general ones locked).

## D103: Scores out of 5 as a star rating; Regenerate with feedback; a 150 KB budget

- Date: 2026-10-13 (the owner's second round of feedback that day)
- Decision:
  - A source's score is out of 5 again (SCORE_MAX 5; Excellent 4.5, Good 3.5, Fair 2.5, the same 0.9, 0.7 and 0.5 on the mean of the parts). A source row shows a star and the number ("4.5") before its checkbox, or New, and no longer shows its stories in briefings: the quality part already counts them (publish share and volume).
  - A topic page lists seven sources and a "Show N more" button. Delete in a topic's More menu opens a confirm dialog first; built-in topics (Design, AI, Technology, the general topics) still have no Delete or menu, as the engine refuses to remove them.
  - Copy: Listen in (was Podcasts), Topic weightage (was Weights, with no note under it), Configure (Daily and Weekly's link to Topics and sources), Primary voice and Secondary voice. Daily's Repeat row has no weekly note (`weeklyNote` is gone). The Topics list opens with "N topics" and a compact Add on one line; Add source is the same compact button.
  - The model field is as wide as its name at rest (`field-sizing: content`), so its hover fill hugs the words.
  - Today's New briefing is Regenerate: a dialog with one optional text area whose feedback goes through `/api/generate`, `run.yml`'s `feedback` input and `dispatch run --feedback` to the writer prompt as delimited untrusted text. It publishes a new digest that becomes the latest; it does not replace today's.
  - The first-load budget is 150 KB (was 110 KB, D53), at the owner's request.
- Why: the owner's feedback on /settings/daily, /settings/topics, /settings/topics/ai, /settings/model and Today.

## D104: A briefing can be regenerated in place or deleted

- Date: 2026-10-13
- Decision:
  - The briefing page's More menu is the episode's: Share, Regenerate, Delete, on the latest and on older Daily and Weekly pages (HeroMenu.astro, one component). Delete opens the episode confirm (EpisodeActions.astro, `noun="briefing"`). Regenerate still opens the Generate sheet, whose request now carries the page's digest id (`replace`), because the sheet already follows a briefing run; the episode rewrite panel and the run indicator stay the episode's. Library cards stay without a menu, as episode cards have none.
  - `dispatch run --replace <id>` (run.yml input `replace`): the gate plans one pass with the old digest's id, kind and date, over its window start to now, whatever the cadence says, and frees that digest's stories in `state/seen.json`. The commit stage removes the old digest and its narration timeline and writes the new digest under the same id in one `chore(digest): replace <id>` commit, only when the new one published (a replacement that finds nothing keeps the old). It records the on-demand slot (the status route reads it) and leaves the regular record and the fetch window alone. The old MP3 stays in the Blob store until the audio job uploads the new one over the same path.
  - `dispatch run --delete <id>` (run.yml input `delete`; the run is named "delete <id>"): removes the digest and its timeline in one `chore(digest): remove <id>` commit through the `run` write guard; no other step runs. `POST /api/generate` takes `{action:"delete", id}` or `{replace, feedback?}`, refuses an id the build does not list, applies the delete limits (10 s, 20 a day) to a delete and leaves delete runs out of the Regenerate cooldown. A device that deleted hides the briefing's Library card and page at once (the episode mechanism, ids from `/d/` too).
- Why: the owner asked that every kind of podcast can be shared, regenerated and deleted; D103's Regenerate made a new digest and left the old one.
- Cost: the narration MP3 of a deleted briefing stays in Blob until pruned; the latest briefing's Today page shows until the redeploy, as an episode does.
- Rejected: a second workflow for delete (run.yml already holds the write guard path and the concurrency group); a new id for the replacement (it breaks links and order).

## D105: Listen while it is written; mobile sounds; word light; sticky switch

- Date: 2026-10-13 (owner: "start playing as soon as something is playable", transcript lag, sticky tabs, no sounds on mobile)
- Decision:
  - podcast.yml made no audio already (the site narrates on Play, D82); the wait was the writer (about 60 s) and Vercel's deploy (about 33 s). The engine now allocates the episode id first, writes a short opening (`writeOpening`, 4 to 6 turns) before the full script, and copies the turns to Blob (`streams/run-<run_id>.json` and `streams/<episode-id>.json`: writing, done or failed; pruned after a day). `GET /api/stream?run=` answers the copy, or `{ status: "waiting" }` (a 200, so polling logs no console error). The run card offers Listen now once turns exist; the player narrates them through `/api/narrate` and waits at the last turn while more is coming. Expected first turn about 35 to 45 s after the request (estimate, not measured live). The page does not switch itself to the committed episode; the Open link appears as before.
  - Sounds: `unlock()` sets `navigator.audioSession.type = "playback"` (the iOS silent switch muted Web Audio) and the unlock listens to click and pointerup as well (pointerdown is no activation on iOS). The first tap may stay silent while the engine loads.
  - The spoken word's fill appears at once (it faded in over 100 ms) and the light reads 90 ms ahead of the element clock (`spokenWordIndex`). The Stories / Transcript switch sticks to the top of the open player below 64rem.
- Why: the owner's list. Pnpm and the faster-writer option were weighed; the owner chose the Blob stream.

## D106: The wide bar, bottom sheets, the played chip, dropdowns and the Model field

- Date: 2026-10-14 (the owner's list of 18 ideas; #96, #99, #101)
- Decision:
  - From 64rem with a mouse the bar shows the cover with its title and metadata on the left, the transport and the clock in the centre and the volume on the right; tab order follows. The title and the metadata are `--space-1` apart. The volume slider is hidden until the pointer is over the control or focus is inside it, stays while it is dragged, and hides 400 ms after the pointer leaves. Its room is always reserved and it sits against the button, so nothing moves and there is no gap to cross.
  - A bottom sheet (the Generate and Narrate drawers below 40rem) has no grabber and no corner radius; swipe down still closes it. The centred dialog from 40rem and the desktop side panel keep their corners.
  - A played chip reads "Play again" with the replay glyph under a mouse and on keyboard focus, at a held width. Touch keeps "Played".
  - Every dropdown has the same room between its value and its chevron (`--field-chevron-gap`, 1rem). A multi-line field has equal padding on all sides.
  - The Model field is the drawn select the Provider field uses: Default, Top models, All models. The saved model is always an option. Typing an id and filtering the list are gone.
- Why: the owner's list. On the Model field the owner chose the dropdown knowing that a typed id is lost; on the sheets the owner kept the original idea after the pushback that a grabber marks the swipe.
- Rejected: a safe triangle for the volume slider (not needed when the slider touches its button), `space-between` for the title and metadata (it ties the gap to the cover's height), a square centred dialog.

## D107: The highlight pauses during words the page does not show

- Date: 2026-10-14 (owner: "the text highlight hops on to the next section causing a mismatch"; #98)
- Decision: a story's narration segment opens with the host's unseen words (a section announcement, the link between stories). The build gives each story of a briefing the exact number of those words (`lead_words`, page data only, from `leadInWords` in the engine's `spokenSegments.ts`). The marks are shifted by that count, the estimate gives the lead-in its share of the segment's time, and a story becomes current at its first own word (`spokenPosition`): during a lead-in the story before stays put and no word is lit, and nothing is lit during the sign-off. An episode's turn is its text alone and is unchanged.
- Why: the page treated the segment's start as the story's start and applied marks that index the whole segment to the story's words from zero.
- Rejected: showing the host's words as muted lines (the owner asked for a pause), and inferring the lead-in's length from the marks (the first attempt: a guess with a cap, and no help before marks arrive).

## D108: A user profile with blocked domains and story votes

- Date: 2026-10-14 (owner: "a self-improving system tailored to a particular user", "make sure they are not sneaking into any more podcasts"; #97, #100, #103, #104)
- Decision:
  - `config/profiles/<user_id>.json` holds `user_id`, `blocked_domains` and `votes`. `ProfileStore.read(userId)` in `packages/engine/src/profile/profile.ts` is the one seam a user split has to change; the only user is `owner`. A missing file is an empty profile; a broken one fails the run.
  - Blocking: `profile.block` and `profile.unblock`. A URL is blocked when its host is a blocked domain or a subdomain of one. A registered source on a blocked domain is not fetched, and every fetched item (feeds, open search, listings, general feeds, the scoring sample, an episode's selection) is cut before dedupe, judging and extraction. The app offers it as "Stop hearing from {outlet}" on a story and as Settings, Topics and sources, Blocked outlets.
  - Votes: `profile.vote`, one stored vote per story, the newest 500 kept, the domain derived by the engine. A source's preference (ups minus downs, halving every 30 days, none under 3 votes) moves its items' ranking score by at most 15% either way; a domain's preference applies only where the source has none. When the Firecrawl listing cap forces skips, disliked sources are skipped first. The writer gets up to 5 liked and 5 disliked headlines as untrusted data, to choose what to lead with. The numbers live in `VOTE_LIMITS`. The run report has a `votes` line.
  - The app shows a vote only as the pressed state of its button, kept on the device (`dispatch:story-votes`). Votes are sent in one op when the page is hidden or left, or 10 minutes after the first unsent one, because every config save is a workflow run, a commit and a redeploy.
- Why: the owner wants briefings that learn from one listener now and from each signed-in listener later. Sources reach a briefing through open search as well as the registry, so a block has to act on items, not on the source list.
- Rejected: a separate blacklist of sources (it would repeat the source checkbox and miss open search), votes moving topic weights (too few votes to learn a weight from), votes kept in Blob (it needs a store credential or an address in the workflows; the profile's seam leaves the move open), sign-in now (digests and config are one repository built into one static site, so per-user briefings are a re-architecture).

## D109: Regenerate chooses the topics again and takes comments

- Date: 2026-10-14 (owner: "better control of either choosing the topics again, and have some comments"; #102)
- Decision: the Regenerate dialog of an episode and of a briefing has the app's topic chips, prefilled with what the original was made with (at least one stays chosen), over a Comments field. The choice applies to that regeneration only. An episode sends `topic_ids` through `podcast.yml`; a briefing sends `topics` only when it differs from the original's, as a `run.yml` input passed to `dispatch run --stage write --topics`. A briefing's choice filters at the write stage, so it can drop a topic but cannot add one the run did not fetch.
- Why: the owner's list asked for a weight slider in the dialog; asked whether it should override one run or save, the owner chose topics and comments instead.
- Rejected: weight sliders in the dialog (a one-run weight needs a run-level override; a saved one silently changes every later briefing).

## D110: Monthly covers

- Date: 2026-10-14 (#109)
- Decision:
  - A cover dated 2026-10 or later (`MONTHLY_FROM` in `packages/cover/src/season.ts`; `isMonthly` is the one place that decides) is drawn from its calendar month's colour scheme: a small set of colours taken from the existing palettes, inside one hue family or an analogous or split-complementary set. The seed picks which scheme colour takes the ground, the figure and the type, so covers vary inside a month and a past cover keeps its colours.
  - Each kind has a set layout. Daily: a flat template (no outlined numerals or ring line art), about a third on a light ground. Weekly: the matted plate with a deep ground, its ISO week number (`W42`) and its Monday to Sunday range. On demand (a briefing on request and an episode): a round plate on a matte.
  - Harmony is enforced in code, not by review: a draw is legal only when type meets 4.5:1 on its ground and the figure 3:1 (`TYPE_CONTRAST`, `FORM_CONTRAST`; a plate 1.6:1 on its matte, the derived tints apart from both), and `assertSchemes` fails a scheme that leaves a kind with no legal draw.
  - Covers dated before 2026-10 keep production's mixed palettes, so nothing already published changes.
- Why: any cover a month makes should look intended beside the others (`season.ts`): one scheme a month and a layout per kind let a shelf read by month and kind, and a contrast rule in code keeps a random draw from producing an illegible cover.
- Rejected: the redesign of 2026-10-14 (three new layered layouts, Strata, Orbits and Facets, with a theme per month, on the unmerged branch `worktree-agent-aeb65c83279c743fc`), rejected by the owner. Its contact sheets showed Orbits busy, Facets weak and on-demand titles unreadable at 48px.

## D111: The open player has no handle and a square top

- Date: 2026-10-14 (owner; #106)
- Decision: the open player page draws no drag handle, and its top corners (and the phone dock's) are square at every point of its travel, not only at rest. The whole top of the page is still the drag area, and the art keeps the room the handle and its margins took (`padding-block-start: var(--space-8)` on `.player-drag`). The desktop side panel and the centred dialog keep their corners.
- Why: D106 took the grabber and corners off the Generate and Narrate drawers and left the player page with both; the owner asked for the same sharp top on the player.
- Rejected: corners that round while the page travels and square at rest (D32's look until #106): the owner wanted one edge throughout.

## D112: First load: preload hints, idle loading, a lazy player motion, a 109 KB budget

- Date: 2026-10-14 (the owner's first-load plan; #111, #112, #113, #115)
- Decision:
  - Every page names each module it loads at start in a `<link rel="modulepreload">` at the end of its head, added after the build by `dispatch-module-preload` (`astro.config.mjs`, `withModulePreloads` in `bundleBudget.ts`). `checkBundle` fails a page that loads a module at start without one. Links only: no inline script, every page script stays a file.
  - Code a press needs is fetched at idle (`scripts/idle.ts`), never on the press itself: the Topics editor, the vote sender, the episode actions, the Create sheet, the click cues, the player's late glyphs. A page editor whose page has a pre-ready state can load at idle instead of at start (Blocked outlets).
  - The player's eager glyph registry holds what the bar draws at first paint; `Icon` draws the rest from the full registry.
  - The player surface's motion (`playerSheetMotion.ts`) loads at idle with the open page's controls. `playerSheet` is a facade: closed at rest, as the island's markup draws it, and a call made before the motion loads waits and runs in order.
  - The first-load budget is 109 KB, about 3 KB over the heaviest page (Topics, 105.7 KB).
- Why: the bar answered 2.5 to 3 s after the largest paint on a slow phone because the island's graph was fetched one round trip at a time; hints brought it 1.1 to 1.5 s forward with LCP unchanged. A first press that waits on a download breaks D47's instant moves. A ceiling 44 KB above the code (D103) let a page grow by a third before anything failed.
- Cost: about 15 to 20 KB more script fetched at idle, by the warmed chunks' sizes (not counted by the budget, not measured as a transfer). A press on the bar before idle waits for the motion chunk, as it already waited for the open page's controls. A feature that adds first-load code now has 3 KB of room.
- Rejected: no island eager at first load (about 73 KB off every page; parked by the owner for its risk to the early Play tap, D82); loading page code on first input (a press would wait on a download); moving only `detentGain` out of scrubberMath (0 KB: the module moved to another eager chunk).

## D113: Claude Sonnet 5.5 is the default writer; the Model list has no Default row

- Date: 2026-10-14 (the owner: "Glm 5.3 is set for nebius, by default I want sonnet 5.5"; #121, #124)
- Decision:
  - `DEFAULT_WRITER` (core) is Anthropic, `claude-sonnet-5-5`. The engine writes with it when `config/writer.json` is missing or broken, the page names it when nothing is chosen, and `config/writer.json` holds it.
  - Without `ANTHROPIC_API_KEY` the engine warns and writes on the Nebius models, so the default never stops a run.
  - The Model list has no Default (automatic) row: it shows the chosen model, under Top models and All models headings set in regular weight on the left. Switching the provider to Nebius starts on GLM-5.3 (`NEBIUS_DEFAULT_ID`) while the live list serves it, else the first model.
- Why: the page said one default and the engine used another (a missing file meant Nebius). A Default row named no model, so the owner could not tell what wrote an episode.
- Cost: a run without the Anthropic key writes on Nebius with a warning, not with what the page shows.
- Rejected: keeping the automatic row, which was the ambiguity.

## D114: Every episode is written for the owner; the New episode form is shorter

- Date: 2026-10-14 (the owner: "Remove, always Somesh"; "Add lookback after length"; #123)
- Decision: the General audience and the Written for control are gone; a hidden `audience` field always sends `custom`. Design, AI and Technology start ticked. The form is Title, Topics, Length, Look back; More options holds Format, Voice and Tone, and its line reads "{format} · {tone} tone".
- Why: the owner never chose General, and the preset with its Undo line was a step before every episode.
- Cost: a general-news episode is made by ticking the general topics by hand.
- Rejected: keeping General as a preset under More options.

## D115: Settings save quietly

- Date: 2026-10-14 (the owner: "I don't want the saving in progress snackbar ... I want it to feel live and natural"; #125)
- Decision:
  - A settings change shows no toast while it saves or once it is saved; the control already shows the change. The polite live region says "Saved." for a screen reader.
  - The toast comes up only when the owner can act or should know: a failure with Retry, a removal with Undo, and a save that could not change the time.
  - A page opened again before the build shows saved values without a line under its title. The line appears only when a held edit failed ("Not saved yet. It goes with your next change.").
- Why: a toast after every change made each edit feel like a transaction. The controls and the saved overlay (D79) already show the change at once.
- Cost: a sighted owner sees no confirmation that a save went through. A failure is still shown, and the rest of the site still updates after the redeploy (about a minute), which this does not change.
- Rejected: a shorter-lived Saved toast; an inline check beside the changed row (more markup for the same news).

## D116: docs grouped by purpose

- Date: 2026-10-14 (the owner: "the docs folder has a lot of loose docs, consolidate them")
- Decision:
  - The record stays at the top of `docs/`: `state.md`, `decisions.md`, `learnings.md`, `history/`, the design-engineering ledger and the runbook.
  - The first build's plan moves to `plan/` (`vision.md`, `build-plan.md`), each marked as the original plan that later decisions override.
  - Measurements and the test postmortem move to `engineering/`.
  - A point-in-time audit is not a standing doc: its tables go into that session's history note, and its open items into the ledger's gaps.
  - `docs/README.md` maps every doc. It and `history/README.md` are the only names outside D14's kebab-case.
- Why: thirteen loose files at the top mixed the live record with a superseded plan and two finished audits, and two of them still said nothing had run live.
- Cost: links into the moved files changed; a link check found no new broken links.
- Rejected: moving `design/` and `prototype/`, which build scripts and tests name by path.

## D117: live model lists, Claude ids checked on save

- Date: 2026-10-15 (the owner: "when newer models are updated on anthropic api or nebius, the list should instantly be updated"; then "Live-checked" on the save rule)
- Decision:
  - `/api/models?provider=anthropic` serves Anthropic's `GET /v1/models`, newest first; without it the picker offers the two built-in Claude models (`ANTHROPIC_MODELS`).
  - Both lists are held at the CDN for five minutes (`s-maxage=300`), not an hour, so a release shows within about five minutes.
  - Core accepts any well-formed `claude-` id, so the engine runs a model released after the built-in list. `/api/config` refuses one Anthropic does not list, after the passphrase; it answers 503 when the list cannot be read. The built-in two save without asking.
  - `ANTHROPIC_API_KEY` joins the Vercel environment (`npm run secrets:push`).
- Why: a hand-kept list of two ids went stale with every Claude release.
- Cost: saving a newer Claude model fails while Anthropic's list is down.
- Rejected: no CDN cache (every page load would call both providers); accepting any `claude-` id unchecked (the owner chose the live check).

## D118: Jev 1.14 pinned, and a taste check by Jev

- Date: 2026-10-15 (the owner: "keep a lean yet powerful mechanism for us. if you are using a llm, use a smaller model to keep costs low and accurate. using jev can also be useful with new jev upgrades (make sure we use that version)")
- Decision:
  - The judge, topic judge, general judge and grounder name `jev-1.14.0` (`DEFAULT_JEV_MODEL`). `jev-latest` still points to 1.13.0, and an alias moves without a code change. The SDK is 0.7.0.
  - A story opened at its source is stored as an open (`profile.opens`, newest 300). Opens wait on the device for a vote batch, or go alone once a day old, so they never cost a commit per visit.
  - From ten votes and opens, one Jev Noul per candidate (the top 60 by score) asks whether the owner would want it, given their newest liked, opened and disliked headlines. The probability moves the score by at most 15% either way and replaces the source-vote multiplier for that story; without an answer the source votes apply.
  - `loop/eval.ts` labels importance with the pinned Jev and once with `jev-1.13.0`, and reports how many labels moved.
- Why: votes keyed on source and domain miss what a story is about, and the judge never saw the owner's taste. Jev is the cheapest model here (USD 0.042 per million input tokens, output free) and returns calibrated probabilities, so no new LLM is needed.
- Cost: about 60 Jev requests a pass; the judgment cache is keyed by model, so every item is judged afresh once after the pin.
- Rejected: an LLM recommender or embeddings (one reader, too few interactions to tune); a discovery slot in selection (the taste check is neutral on unrated sources, and every topic already gets its best story first since #144); a store of its own for opens (every save is already a commit; riding the vote batch costs nothing new).
- Revisit if: the eval shows 1.14 moving many importance labels, or the taste check's answers sit near 0.5 for every story.

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

## D120: Science airs a one-outlet story

- Date: 2026-10-15 (the owner chose "Science only" on the decision card "Let a well-matched science story air when only one outlet carried it?")
- Decision: for the Science topic alone, a story carried by one outlet gets a coverage factor of 0.65 instead of 0 (`SINGLE_OUTLET_TOPICS` in `score/scoreTopics.ts`). A story the judge finds clearly about science (level 3) just clears the 0.4 bar; one loosely tied does not; a story two outlets carried (0.7) still ranks above it. World, Business, Culture and Sports keep the two-outlet rule.
- Why: Science never aired. Its feeds are mostly press releases that no second outlet carries (ScienceDaily sent 31 stories in a week, none twice), so every science story scored 0.
- Rejected: all general topics (World and Business are well co-covered and would gain single-source stories); wire-service science desks (big stories only); leaving it.
- Revisit if: Science airs press releases the owner does not want (raise the factor's bar or add a source rule), or another general topic stops airing for the same reason.

## D121: medium-chroma covers, three series on one paper

- Date: 2026-10-15 (the owner: "the color palette of the album arts is too saturated, keep it medium so it is not too much on the eye when multiple albums are viewed at the same time", and "make sure weekly and daily covers are easily distinguishable")
- Decision:
  - Every cover palette in `tokens/covers.json` sits at OKLCH chroma 0.12 or less, hue and lightness kept. Near-duplicates the lower chroma would have made (the October scheme's two terracottas and two sands) are pulled apart in lightness.
  - Each monthly series draws from its own twenty styles, picked by the cover's seed (`packages/cover/src/series/`): dailies, on-demand covers (briefings and episodes) and paper weeklies. The owner chose them from contact sheets of twenty per series and dropped a first weekly set of coloured covers in a cream frame ("drop the brick red option").
  - Every series prints on the month's paper, made from the scheme's palest colour, in the same inks (`series/paper.ts`), each on its own close tint (`SERIES_L`): weeklies palest at 0.88 in the light theme and 0.80 in the dark (the owner: "too bright on light mode, could be faintly less bright on dark mode"), on-demand covers a step deeper at 0.82 and 0.74, as the stock around an ink disc (the owner: "on-demand ones should also follow the same color theme"), and dailies a step deeper again at 0.76 and 0.68. A first cut separated the series by lightness, with dark dailies (0.55 or less); in a grid the dark and pale covers clashed (the owner: "why are some dark and some light? the albums should be in a harmony"), and the owner chose close steps over one identical paper. Covers before October 2026 keep their templates and the framed weekly.
  - Every cover prints its year after the month in medium weight, "October 2026" (a New Year week shows "2026–27"; the owner: "mention the year in all album arts in a small yet elegant place").
  - The weekly's range prints with a dash, "2 – 8 November", from that year's ISO week (the owner: "each year the week range changes ... the subtitle can be like 5 - 10 November").
  - The cover box takes the colour drawn at the cover's edge (`coverEdge`, `lib/covers.ts`), not the palette id's ground, so a pale matte or a pale monthly ground gets its rim on the light page.
  - Covers adapt to the theme (the owner: "I want the color palette to adapt to light and dark theme, have this modularity in design theme"). `tokens/covers.json` `mode` maps every drawn colour's lightness into a band per theme: light keeps covers as authored and dark fades them (inks lift to charcoal, the palest settle to parchment, chroma 0.9; the owner: "the faded ones are in dark mode, bright ones are in light mode"); `mode.ts` then holds each contrast floor again. Pages and the player show `/covers/<light|dark>/<id>-<size>.webp` by theme; the lock screen and social card keep the colours as authored.
- Why: October's scheme drew from chroma 0.16 to 0.22 colours, and a grid of them measured 107 to 134 on Hasler and Suesstrunk's colourfulness ("extremely colourful"). The weekly's matte was its own ground, so it showed only as a slightly smaller picture.
- Check: grids of every scheme measure 47 to 58 (moderately to quite colourful), 95th-percentile chroma 0.11; the worst date contrast is 4.8:1; a month's daily, on-demand and weekly grounds sit in that order at least 0.04 apart and within 0.15 of each other in OKLCH lightness, in both themes (`family.test.ts`).
- Rejected: a coloured badge or a "W" corner mark (the week numeral already says it, and it fails at the 40 px row size); a dark matte (it disappears into the dark page); a weekly mounted in a pale frame around a coloured plate (the owner dropped it for the paper set).

## D122: brighter covers, a header light read from the cover, a clean theme switch

- Date: 2026-10-16 (the owner, over a dark Library grid: "the album arts are too dull in both dark and light theme, they can be slightly brighter", "the shader color blur must be natural and not very elliptical, if there's an ambient movement that's even better. The shader color should match the colors of the album art every time", and "there is a glitch in the screen when I switch the app theme")
- Decision:
  - Every series' paper sits 0.04 to 0.05 lighter (`SERIES_L`: weekly 0.92 and 0.85, on-demand 0.86 and 0.79, daily 0.80 and 0.73, light and dark), with at least 0.03 chroma, and the dark theme keeps full chroma (`tokens/covers.json` `mode.dark.chroma` 1). Inks still lift to charcoal on the dark page. A card's progress scrim covers the bottom quarter, not 40%.
  - The header light's colours are read from the drawn cover for each theme (`coverSwatches`, `packages/cover/src/swatches.ts`: the cover rendered at 64 px with its fonts, flat colours counted by area). The light is the largest colour, then the two that catch the eye most (area weighted by chroma; dark colourless ink gives no light), each at the theme's lightness (`ambientTint.ts`).
  - The shader draws three round gaussian lights, sized and placed from the measured cover: the main colour behind the cover, the other two beside it toward the title, drifting on a 40 s loop and bent by slow noise. The layer's mask is only a fade at its four edges; the CSS layer draws the same three as circles.
  - A theme change fetches and decodes the new theme's covers on screen first (at most 400 ms), then crossfades with the bars in the page's picture (`data-theme-change`, `themeApply.ts`).
- Why: the paper at 0.68 to 0.88, under a 40% scrim, read grey. The light used `coverColors`' three roles, dropped every colour under 0.03 chroma and squeezed the field into one wide ellipse, so a beige and red cover lit the page in a faint pink smear. The other theme's cover images are lazy and `display: none`, so they were never fetched: a switch showed empty boxes filling in after the fade, while the bars, in their own view-transition groups, faded at 100 ms over a 200 ms page.
- Check: the contrast proof now sweeps every hue at every chroma up to each theme's cap (`ambientPalette.test.ts`); `family.test.ts` still holds the series' order and spacing; a screencast of a switch on Library shows every cover in both pictures and no bar ahead of the page.
- Then (2026-10-16, the owner: "the album arts can be slightly saturated as the colors are too dull"): the paper prints at 0.045 chroma or more, not 0.03, and the spot and tint 25% richer than the scheme's colour, still at most `MAX_CHROMA` 0.12 (`series/paper.ts`). The paper is nine tenths of every cover, so its grey was most of the dullness.
- Rejected: sampling the cover image in the browser (the CSS layer and the first paint would still need server colours); warming the other theme's images on every page load (twice the cover bytes for a switch made rarely).

## D123: one model select, system-coloured Android bars, a launch screen, a light from the playing cover

- Date: 2026-10-16 (the owner: "Just have one model drop-down available upfront in settings page (3 models (opus, sonnet, haiku, latest) + top 5 models from nebius that are very good for the podcast use case", "Flash screen design animation for pwa - dark & light", "Light animation of album art when playing", "Pwa bottom Android navigation is white, hiding the native nav buttons + has to adapt to theme")
- Decision:
  - Settings holds one "AI model" select in the Podcast section, in place of the AI Model page and its Provider select (D51's one job per page gives way to the owner's "upfront"). Claude: Opus, Sonnet and Haiku, each the newest of its family in Anthropic's list (Opus 5.5 joins the built-in models); Nebius: the first five of `NEBIUS_TOP` (EQ-Bench long-form writing, 2026-10-11) the live list still serves. The provider follows from the id; a saved model neither list offers shows as "(current)" (`writerOptions`, `lib/combobox.ts`).
  - The manifest names no `theme_color` and no `background_color` (`lib/manifest.ts`). Chrome reads them once at install into the WebAPK and paints the system navigation bar in `theme_color` (Chromium's WebAppNavigationBarThemeColor) and the status bar too, whatever the page shows later, and it dropped per-scheme manifest colours in Chrome 128. Without them Android draws its bars and splash in the system's light or dark theme. They follow the system, not an in-app Light or Dark choice, which nothing in the manifest can reach.
  - A launch screen in the installed app only (`display-mode: standalone`): the ringed dot where Android's splash left it sends out two rings, gives a beat and lifts away, about 0.9 s, in the theme's tokens, a 0.4 s fade under reduced motion (`LaunchScreen.astro`, `launch.css`). It persists across in-app moves and is hidden once played.
  - While the narration plays, the cover lights the open player page: the cover image itself, blurred, behind it, fading in on play and out on pause and breathing on a 4.2 s loop; transform and opacity only, still under reduced motion, hidden in forced colours (`PlayerCoverGlow`, `player.css`).
- Why: two selects and a separate page were three taps to a choice the owner makes often. The white bar was the light `theme_color` frozen into the installed app, under light navigation buttons in dark mode. The blurred cover is the one light source whose colours always match the art.
- Check: the manifest test keeps both colours out; the select's options are unit tested and its save, hold-away and layout journeys are browser tested; the launch screen and the glow were recorded frame by frame in both themes.
- Then, from the same day's audit of the app as a PWA (the owner: "audit all things related to making this a sound pwa app and making this fun to use"): navigation preload; an update check when the app returns to view, at most every 30 minutes; /library in the offline shell and stale hashed files pruned (sw.js v8); manifest shortcuts (Latest, Library, New episode) and `launch_handler`; an Install row on Settings for Android's install prompt; press timing back on the play disc, the bar's buttons and the view switch; votes that crossfade outline to fill and pop when pressed (never when restored); no tap flash or long-press link menu on in-app navigation; the bar title and story line fade on each story; Back to now rises in; the navigation pill grows from its centre after a move. A source can be deleted from its edit panel (no control sent `source.remove` before), and the model value on Settings takes the hint colour.
- Left for the owner: offline listening (keep the latest few recordings on the device; needs the audio host in the CSP and CORS), iOS startup images in both themes, the iOS status bar in the light theme (`black-translucent` puts white text over the light app bar; unchecked on an iPhone), and a Gallery and List morph.
- Not verified on a device: the bars and splash after reinstalling the app (an installed app keeps its old manifest colours until Chrome updates the WebAPK), and the launch hand-off from Android's splash.

## D124: named weight stops, source formats, a format mix and a perspective

- Date: 2026-10-20 (the owner: "in the sources section, I want a search bar with filters (Forums, Blogs, Videos, etc.)", "the topic weightage in each topic should rather be source type weightage and left vs right news", "the topic weight names are very generic, it needs to be meaningful", "for weights - do a slider with fixed values", "the source type can be guessed by jev and prefilled as soon as I add the url", "categorize all the existing sources too")
- Decision:
  - The eleven judge categories keep their ids and take story-kind names (Build breakdowns, User studies, Components, Motion and CSS, Tool launches, Design essays, AI interface patterns, Model releases, Device launches, Funding and gossip, AI hype lists). A weight is one of five stops: Off 0, Less 0.5, Normal 0.7, More 0.85, Most 0.95. Off replaces the hard-coded `NEVER_PUBLISH`; `dispatch learn` moves one stop.
  - Every source has a `format` (blog, news, forum, video, research, releases, podcast): the type's rule, then Jev (`classify-formats`, and on add within 3 s). Search and format and status chips filter the index and each topic page.
  - Source type is added to topic weights, not swapped for them: a page's format mix (Off to Most, x0 to x1.2) multiplies the topic score; Design, AI and Technology keep one mix on their home topic.
  - Left and right only on the five general topics: Jev rates each outlet's lean (-2 to 2), and a Perspective slider (default Even) moves a story by up to 15%, never removing one. The owner chose the slider over a Balance toggle.
  - A briefing takes at most two stories per outlet, by the story's host, outside sections of their own.
- Why: what a story is about (the weights) and where it comes from (the format) are different questions; replacing one with the other would score a hype list on a good blog like an essay. Numbers like 0.88 against 0.85 could not be heard in a briefing; five named stops can.
- Rejected: a Newsletters and an Official format (folded into News and Blog); AllSides or MBFC ratings (licence, US-only coverage); a lean filter that drops stories.
- Check: unit tests for Off, snapping, format derivation, group mix Off, perspective at Even and the outlet cap; a phone journey for search and chips, one for a format slider that holds after reload.
- Left: the general feeds rate 17 Centre-left, 10 Centre, 3 Centre-right, 0 Right, so Right has little to favour; `curate` (agent mode) ignores the mix.

## D125: headings never bold, a plainer Topics and sources, a floating Add

- Date: 2026-10-20 (the owner's Settings and Podcast redesign brief: "Never use bold for headers, this applies globally", "Add a new Intelligence section containing only the AI model picker", "Remove the status-type filters entirely", "Move the add action to a floating action button", "Convert type filters into a scrollable tab bar, with All as the first tab", "Wrap Weightage and Formats sliders inside an accordion", "Add swipe/pull-down-to-dismiss")
- Decision:
  - No heading is bold anywhere: the title and lead type roles are regular (D73 kept 500 for headlines; that ends), and the medium weight left on headings (a shelf head, a compact empty title, the contents title, a form's field headings, the scorecard) goes. Medium stays on labels, buttons, chips and tabs.
  - Settings group heads are the page's H2: the 22px heading role in the text colour, apart from the 28 to 32px title by size and space alone (they were 14px accent). Sections: Podcast, Intelligence (the model select alone, D123's "upfront" kept), Sound, Appearance, About. Daily and Weekly keep their short row labels; their pages are titled Daily Podcast and Weekly Podcast.
  - Topics and sources is a search and the list: no count, no format or status chips. Add is a floating button below 64rem (`AddFab.astro`, the New episode button's shape and folding; `fabFor` returns `add` so the page keeps room for it and a toast clears it); from 64rem, with the side column and no floating button anywhere, it is an outline button at the end of the search row, where a desktop toolbar puts a page's action.
  - A topic's page: Listen in sits in the card under a full-width line, its options Daily, Weekly and On Demand (was Custom; the panel's too). Its sources take a tab bar of their formats, All first, one at a time (`?format=`), shown when two or more formats are present; below 64rem the search and tabs stick under the app bar until the list ends. Add source is the floating Add below 64rem and stays beside the Sources heading from 64rem.
  - Topic weightage, Formats and Perspective are collapsed `details` groups with an H2 summary, on every page that has them: every topic with a weight now shows Topic weightage (Technology and the owner's own topics had a bare Weight row). Formats still needs two formats on the page, as one format has nothing to weigh against. Perspective shows on World and Business, as left and right is a question of political coverage, and on another general topic only while it holds a lean set before, so that lean can be seen and reset.
  - The source panel, full screen on a phone, closes when pulled down from its head or from the top of its body, past a quarter of its height or with a flick; a shorter pull springs back (`pullDismiss.ts`). No grabber is drawn (D106).
- Why: medium headings beside regular text read as shouting, the owner's long-standing complaint about weight; the 14px accent heads read as captions, not sections. Status filters answered a maintenance question the page does not need to ask on every visit. A floating Add is the phone's one primary action, and a desktop toolbar keeps the wide page's hierarchy without a floating shape over a column of rows.
- Rejected: tabs on the index (the owner: they do not belong there); a floating button on desktop; Perspective on every general topic; a Formats group for a single format.
- Then (2026-10-20, the owner on a phone: "the subsection headings and the accordion titles are too big", "the tabs are not scrollable", "I want it in a single line", "on-demand can be renamed to catch up everywhere", "a weird jump in the full screen modal ... with the Android phone keyboard visible"): H2s are 18 to 20px (the title size), not 22px. The filter's grid column takes `minmax(0, 1fr)`, so seven format tabs scroll in their strip instead of widening the page, which Chrome had zoomed out. Listen in is one line at the label size in the card. Custom and On Demand are "Catch up" in Listen in, the add panel and the Library filter. The add panel focuses its first field without scrolling while it slides, and on a phone ends where the keyboard begins (`keyboardFit.ts`: the VirtualKeyboard API's overlay in Chrome, the visual viewport in Safari).
- Check: the topics journey covers search, a format tab and their reload; the weight and format specs open their groups first; `fabFor` routes Add; a scripted touch pull closed the panel and a short one did not (not a test: touch gestures are not in the suites).

## D126: a play queue, an Up next peek, a collapse chevron, Space

- Date: 2026-10-21 (the owner: a chevron to close the player, Space to play and pause, "the YouTube Music pattern" for the queue)
- Decision:
  - A queue of briefing and episode ids lives in localStorage (`dispatch:queue`, `core/playQueue.ts`). The Library menu adds through the `dispatch:queue-add` event. When an item ends the first queued one starts: the listener chose it. Rows reorder by drag handle or arrow keys and can be removed.
  - A peek strip "Up next" sits at the bottom of the open player and pulls up into a queue sheet with a docked now-playing row. Once an item has ended, Stories and Transcript hide and only Up next shows: the queue, or the previous briefing when the queue is empty, which is offered and never started by itself.
  - Below 64rem a chevron at the top left closes the open player; from 64rem it still shows only on keyboard focus (D102 kept there).
  - Space plays and pauses on briefing and episode pages unless focus is in a field, menu, dialog or slider. The three-dots menu (`heroMenu.ts`) no longer takes focus back when it closes from a tap elsewhere, which had made the next Space reopen it.
- Why: a listener who does not know the page pulls down saw no way out on a phone; hearing the next thing without a tap is what a queue is for. Autoplay is limited to what the listener queued.
- Rejected: autoplaying the previous briefing; a queue page apart from the player.
- Check: unit tests for the queue and the Space rule; the first-play browser spec adds to the queue. Drag and pull gestures are not in the suites.

## D127: a Library row menu, downloads, a one-line phone toolbar

- Date: 2026-10-21 (the owner's Library backlog)
- Decision:
  - Every Library row has a three-dots menu: Download or Remove download, Add to queue, Regenerate, Share (`navigator.share`, else copy with "Link copied"), Delete where the page allows it.
  - Download keeps the audio (a briefing's file; an episode's every pre-narrated turn, its marks and the `/api/narrate` lookup) and the page, covers and scripts in Cache Storage `dispatch-audio-v1`, at most 10, the oldest evicted. The service worker (v10) answers Range requests (206, 416) and offline API lookups from it. An episode with a turn not stored says "Not ready offline yet". A downloaded row shows a filled check-circle and a hidden "Downloaded" at the start of its subtitle. `connect-src` allows `https://*.public.blob.vercel-storage.com`.
  - On a phone the Library has no sort (a sort in a link is ignored there); the Daily, Weekly and Catch up chips (16px side padding below 40rem, scrolling at 360px) and the view switch share one line.
- Why: offline listening was the owner's open call in D123; a menu per row puts the actions where the item is.
- Rejected: downloads in the browser's HTTP cache (evicted without notice); a Settings page for downloads.
- Check: service worker unit tests for ranges and the narrate fallback. Revisit if: the Blob host's CORS refuses the audio fetch on a real phone.

## D128: episodes are pre-narrated

- Date: 2026-10-21
- Decision: `dispatch publish` also narrates recent `Podcasts/` episodes that lack stored turns (`packages/engine/src/publish/publishEpisodes.ts`). Segments are named `audio/<ep-id>/seg/t<idx>.<sha256(voice\nmodel\ntext)[:12]>.mp3` with a `.marks.json` beside each; the naming is shared by `audio/segmentStore.ts` and `core/episodeScript.ts`. `podcast.yml` calls `audio.yml` after an episode commit (a workflow change, shipped in a separate PR the owner merges by hand). It counts against the monthly Speechify budget, not the site's three a day. Briefings were already pre-narrated by `audio.yml` after each run.
- Why: Download and offline Play need every turn stored; a first Play should not wait on synthesis.
- Check: engine unit tests for the naming and the skip of stored turns. Owner action: set the GitHub variable `SPEECHIFY_VOICE_ID_B` to match Vercel if Vercel sets it, or the hash differs and the page narrates again.

## D129: Settings restructured

- Date: 2026-10-21 (the owner's backlog)
- Decision:
  - Index sections: Podcast (Daily, Weekly, Sources, Preferences), Intelligence (AI model), Sound (Podcast voice, Interface sounds, each a page: `/settings/voice`, `/settings/sounds`), Appearance (Theme, a select with no value drawn until the stored one is set), About. No breadcrumbs anywhere: titles stand alone and phones keep the app bar's arrow; a topic page has no "‹ Sources" link.
  - Daily and Weekly: no Configure row, Format and Length are selects, no voice rows, and Weekly has no switch (the engine still reads `weekly.enabled`, which is true).
  - One voice pair (`voice_id`, `voice_id_b` at the top of `config/schedule.json`, `podcastVoices()`) serves Daily, Weekly and Catch up; the old per-podcast voices apply only while it is unset. New episode keeps a per-request voice that defaults to the pair.
  - "Topics and sources" is "Sources" (page title too). A topic page has a Sources or Preferences switch (`?view=preferences`; Other has none). Preferences holds Topic weightage and, on World and Business or a topic with a saved lean, Perspective. "Format" is "Type" in copy. Catch up names on-request episodes everywhere.
  - One global type mix: `format_mix` in `config/preferences.json`, op `mix.set`, edited on `/settings/preferences` (seven sliders, Off, Less, Normal, More, Most, default Normal) and applied to every story by `applyFormatMix`. `topic.mix` carries perspective only; per-topic mixes are no longer read.
  - Sources page: a fire icon for Latest; deleting a source is a confirm dialog then immediate removal, no Undo; a suggested add shimmers, then moves into Sources and the next suggestion fills its place (10 rendered, 5 shown); desktop type chips with no All and multi-select, phone tabs with All, sticky with the search below 64rem; Add source beside the search from 64rem; the Add panel lists suggestions for its chosen topic.
- Why: one mix and one voice pair replaced settings the owner never wanted to repeat per page; a type mix per topic was a control with too many places to set. Breadcrumbs repeated what the title and the app bar already said.
- Rejected: keeping per-topic mixes beside the global one; a Weekly switch (the owner never turns it off).
- Check: unit tests for `mix.set`, `applyFormatMix` and `podcastVoices`; the topics journey. Revisit if: the `?view=preferences` flash of Sources on load bothers the owner.

## D130: no Kimi, a benchmark-ranked five, a weekly check

- Date: 2026-10-21 (the owner: Kimi models are never offered)
- Decision: `EXCLUDED_MODELS` (`apps/web/src/lib/modelRank.ts`) removes the Kimi models. The Nebius top five (`NEBIUS_TOP`, `lib/modelId.ts`) follow EQ-Bench longform on 2026-10-21: GLM-5.3, GLM-5.2, DeepSeek V4 Pro 0813, DeepSeek V4.1 Flash, GLM-5.1. A scheduled check every Monday 08:52 Europe/Stockholm, in a fresh cloud session, re-ranks for the podcast use case (faithfulness first, then long-form spoken prose, instruction following and long context, then price), runs the repo's eval bakeoff when the provider key is there, and opens a PR labelled `review` when the list changes.
- Why: the list was a snapshot of a market that moves weekly; a person reading it should not have to remember to refresh it.
- Revisit if: the check's sessions cannot browse or open PRs. It was created without connectors; the owner recreates it from claude.ai with GitHub and Firecrawl connected.
- Check: the model tests cover the exclusion and the five.

## D131: an 8pt spacing system, held by design checks

- Date: 2026-10-21 (the owner: "I don't know why you keep committing spacing problems in the UI, is it a rule or design system problem? I want to use a 8 point spacing system", "Keep 4px exceptions for granular control, but mostly 8px spacing", "Add tests or a linter to have a design system compliance check")
- Decision: the space scale is 4, 8, 16, 24, 32, 48, 64 and 96px; the 12px and 2px steps are gone (about 240 values moved: 12px became 16 between separate things and 8 inside one control). 4px is allowed only in the selectors `ALLOWED_4PX` names in `apps/web/src/styles/styles.test.ts`, each with a reason (an icon beside its label, a title onto its subtitle, a chip's or button's inner gap, a hit-area or focus offset, an optical nudge). A list row carries its own padding, so it is spaced the same in a page, a panel or a sheet. Headings are never medium or bold. `npm run design-check` runs the static rules (the 8pt grid, regular headings, no inline style that bypasses the tokens) with the token tests in seconds; `e2e/designSystem.spec.ts` reads the computed spacing of every element on every page and in the open player, the Add source panel and a Library menu, and fails off the 4px grid without pinning any value. AGENTS.md makes both a step of any UI change.
- Why: the old scale offered 2, 4 and 12px beside the 8pt steps, so each new surface picked whatever looked right in its own context, and spacing applied by a parent selector vanished when a row moved into a panel (the cramped suggested sources). No test read spacing at all.
- Rejected: dropping 4px entirely (small controls read loose); pinning measured gaps in browser tests (AGENTS.md forbids pinned geometry; the grid invariant catches the class of bug without it).
- Check: each static rule was shown red on a probe; the sweep passes on every page, both widths.

## D132: two segmented controls, and Close at the end of every sheet

- Date: 2026-10-21 (the owner: "I need two types of segmented selector component, one for selection duty with a check, another for navigation, used like tabs. Make them visually distinct. The topic page should use the latter", "In full screen modals with the X, have it on the right side. Change it in the parent component")
- Decision: `.segmented-choice` (a radiogroup: one outlined pill split by hairlines, the chosen segment in the accent container with a check) is for picking a value: the New episode form's Length, Look back, Format and Tone. `.segmented-nav` (a tablist: a tonal track with a raised pill that slides under the active label, no check, arrow keys) is for switching what shows below: a topic page's Sources and Preferences, and the add panel's Topic and Source. A style rule keeps radiogroup markup on the first and tablist markup on the second. `SheetHeader.astro` gives New episode, Add or Edit source and Regenerate one header: the title at the start and Close at the end, as the bottom sheets already were; focus order follows.
- Why: one look for two jobs made a view switch read as a setting, and three copies of a sheet header had drifted from the bottom sheets' layout.
- Check: the style rule was shown red first; the topics, create and episode actions specs cover both controls and the headers.

## D133: the second owner round of 2026-10-21

- Date: 2026-10-21 (the owner: "the up next logic is a bit shady and flaky", "club stories and transcript to one", "the tab line is full bleed only on mobile, on desktop a segmented selector"; "different sections of the settings can be put in different cards"; "this style should be consistent everywhere, make sure there is an established linter"; "we have a flat design concept, so no shadow"; "each topic can have an icon or an emoji, use Jev to decide"; "drop daily type setting if nothing uses it"; "on mobile I should get a bottom sheet"; "simple outline ones and not have inner details")
- Decision: the full player has two views, Stories (each story a chapter row; the playing one shows its transcript under it) and Up next (the queue, or the previous briefing), as full-bleed tabs below 64rem and `.segmented-nav` above; the peek strip and pull-up sheet of D126 are gone, and an item's end opens Up next. Settings groups its rows in tonal `.card-group` cards; /settings/about holds the author, the purpose and a change log (`lib/changelog.ts`). Sources and topic pages use the Library's `.search-field` and `.filter-chip`; `styles.test.ts` fails a second search or chip style and any shadow that lifts a control. `.segmented-nav` is flat: the active pill is the accent container. Shipped topics have fixed emoji; an added topic asks Jev (`/api/topic-emoji`) with a fallback. Other is hidden from lists and pickers (its one source, Exa discovery, keeps running: the owner chose to hide, not delete). The Daily has no type; a stored top-level `format` is ignored. The Library row menu is a bottom sheet on a phone, with an icon per item. Icons are plain outlines; icon buttons never move on press.
- Why: the pull-up was hard to hit and fought the page's scroll; settings read as one long list; three search and chip styles had drifted apart with nothing to stop the next one.
- Check: the queue journey in `firstPlay.spec.ts`, the stillness test in `libraryMenu.spec.ts`, the offline Play journey, and the new style rules were each shown red first.

## D134: no scheduled model check

- Date: 2026-10-21 (the owner: "I don't know what is this Monday model check. It shouldn't be connected to my Claude.ai account. If it is useful to this project, if not, then it can be removed")
- Decision: the claude.ai scheduled task of D130 is deleted and not replaced. The Settings model select still lists Nebius's live models; `NEBIUS_TOP` is refreshed by hand when a writer change is wanted.
- Why: a weekly cloud session on the owner's account to re-rank five entries costs more than a list that rarely changes, and it lived outside the repo.
- Revisit if: a better writer goes unnoticed for a month.

## D135: no batch API for the scheduled runs

- Date: 2026-10-21 (the owner: "using batched requests on the Anthropic API if it'll be useful, but you need to time it well")
- Decision: not built. The scheduled writer is Anthropic Sonnet (`config/writer.json`), but only the first writing pass is independent; grounding, rewrites and the script wait on it, all inside one job that must be listenable at 07:00. Batching would split the run into submit, wait and resume with a deadline fallback, for about $12 a month at today's volume (estimated, no token logs yet).
- Revisit if: volume grows about tenfold, the owner accepts an earlier start, or the cost ledger shows the writer as the main spend.

## D136: one model orchestrator, four model families

- Date: 2026-10-21 (the owner: "remove nebius, and just use Gemini and Claude models in good orchestration and not have model selector"; "Use jev, flash models from Gemini, and haiku and sonnet only. Never opus. Also upgrade the relevant models whenever there's a new model available of the same kind. Use jev and backup of Gemini flash or haiku"; "Temperature can be removed")
- Decision: `config/models.json` names, per step, an ordered chain of families: judge, taste fit, source format and topic emoji: Jev, Haiku, Flash-Lite; grounding: Jev, Flash, Haiku (a checker of another family than the writer); story writer, rewrites and the podcast script: Sonnet, Flash; transcription: Flash-Lite, Flash. A schema rule refuses any other family. At run start the provider model lists resolve each family to its newest generally available model (no preview, no Opus), falling back to a pinned id. `callModel(step, input)` moves on after an error, a timeout, a refusal or invalid output and logs every fallback. No request carries a temperature. Nebius, its keys, the Settings model select and `/api/models` are removed.
- Why: one provider fewer, a fallback that is never silent (a deprecated temperature once dropped the writer onto Nebius unnoticed), and models that improve without a release.
- Revisit if: an automatic upgrade changes tone or selection for the worse (pin the family in the routing file), or a family's price jumps.

## D137: a cost ledger, shared and per-user

- Date: 2026-10-21 (the owner: "a cost tracking engine to track costs in different time periods ... operating expenses per user when I expand my app to general public in different timezones"; "Cost analytics goes into a separate page /analytics")
- Decision: every paid call is a record (run, kind, the edition's timezone, user, provider, product, units, USD from `config/prices.json`, estimated or measured) in `state/costs-YYYY-MM.json`; a scheduled edition is shared by everyone in its timezone, an on-demand episode or a Play narration belongs to its user. `dispatch costs` totals by period and group; /analytics shows the same, linked from Settings.
- Why: per-user cost needs the split from the start; the marginal cost of a user is mostly what they ask for, not the shared briefing.
- Revisit if: the prices in `config/prices.json` (all unconfirmed on 2026-10-21) are corrected, or a second user arrives.

## D138: Alexandria enriches, never replaces

- Date: 2026-10-21 (the owner: "enrich the content with firecrawl Alexandria when needed"; "Alexandria just gives enriched information about certain things")
- Decision: when a finalist's text is under 600 characters after the feed, the free read and the regular scrape, the engine asks Firecrawl Alexandria for facts on its subject and appends them, labelled with their provider, to the material the writer and the grounding check read. Caps: 30 credits a run, 10 a story, 20 s a story. A story with no readable text is still dropped.
- Why: facts from a third party can fill out a thin story; standing in for an unread article would describe it from someone else's data.

## D139: faults are found and healed, once

- Date: 2026-10-21 (the owner: "hardening the webapp in every aspect ... systems to spot faults in reliability, performance, quality, security ... and self-heal")
- Decision: `dispatch health` checks runs, narration, digest and state integrity, cost against a ceiling, fallbacks, the Speechify budget and the live site; `.github/workflows/health.yml` runs it daily, opens or closes one `health` issue and starts one retry run. Every engine push retries a lost ref-lock race. The service worker rebuilds a broken cache; held saves older than a week are dropped; client errors and CSP violations reach `/api/report`. HSTS is set; the paid emoji route is rate-limited. The audit and what is not built: `docs/engineering/hardening.md`.
- Why: the faults found (a push race, a cache read that broke pages online, a paid route with no limit) failed silently.

## D140: the design system, enforced

- Date: 2026-10-21 (the owner: "everything ui related ... must respect design system. implement either a hook/linter/audit pass"; "why drift to other icons when we have an icon library")
- Decision: `npm run design-check` holds tokens-only colour, type and easing, no raw SVG outside the Icon components, shared classes for every control (a reasoned allowlist that only shrinks), the 8pt grid, flat surfaces and regular headings. A PostToolUse hook runs it after any edit under `apps/web/src` or `tokens`. The `design-audit` agent screenshots a UI change before its PR. Icons come from `@phosphor-icons/core` through `npm run glyphs`, and a test fails on any path that differs from the package.
- Why: icons had been redrawn by hand because nothing tied the glyph file to the library, and every check before ran only when someone remembered.

## D141: a 130 KB first-load budget

- Date: 2026-10-21 (the owner: "Increase bundle size to 130kb")
- Decision: `FIRST_LOAD_BUDGET_BYTES` is 130 KB of gzipped JavaScript per page (from 109 KB, D112). `checkBundle` still fails any page above it; the heaviest page is 109.0 KB.
- Why: at 109 KB every feature that adds first-load code needed a cut first; the fault reporter and the player's tabs had used the last bytes.
- Cost: about 21 KB of headroom is roughly a fifth more script to fetch and parse on a slow phone before the page answers, if it is all used.
- Revisit if: the heaviest page passes 120 KB, or INP or LCP on a real phone gets worse.

## D142: creating and deleting feel instant

- Date: 2026-10-21 (the owner on a phone: "emoji selection & topic creation should be made instantly", "suggested sources shown outside - not good and natural", "Why's there a delay in creation or deletion actions in the app?")
- Decision: A new topic is listed at once as a row like the others (emoji, name, "No sources yet", chevron) in its place by name, with core `topicEmoji`'s guess, replaced in place by Jev's pick. The add sends one `topic.upsert`: the request waits for Jev (up to 4.5 s, `pickEmoji`) through a `ready` promise on the pending edit, so the edits made meanwhile ride with it, and carries the guess when Jev has no answer. Before the build the row opens `/settings/topics/new?id=<id>`: one page `[id].astro` builds with stand-in id, name and description, which `fillShell` (`savedView.ts`) swaps for the saved or pending topic; it suggests sources with `suggestSources` in the browser. A topic the build already has, or one not saved here, goes to its own page; a removed one to the list. Suggested sources no longer show on the Sources list, and "Its page opens in about a minute" is gone. A source's removal now leaves at once with Undo in the toast, as a topic's does; a topic's page shows it removed at once rather than when the request lands. The server keeps its 10 s gap (`CONFIG_COOLDOWN_MS`, the flood guard): the client already holds the next request quietly and sends what changed meanwhile in one (D79, D91), so no screen waits on it.
- Why: the add waited up to 2.5 s for Jev before showing anything, then sat in a separate block with a note about the build, and its suggestions sat outside any topic. A deleted source vanished but could not be undone, and a deleted topic stayed on screen for the Undo window.
- Cost: the page before the build shows the generic art of its stand-in, not the topic's own, until the build. A topic opened from another device before the build is not on that device's list (the overlay is per browser, as D79's is).
- Rejected: an on-demand server route for the topic page (a function call on every visit to it, and the site is otherwise static); lowering the server gap (it is the flood guard, and the queue already hides it); a follow-up upsert for Jev's emoji (two commits and a ten-second wait).
- Amends: D79 (a new topic is a row and has a page before the build; its suggestions are on that page).

## D143: a code review before every merge

- Date: 2026-10-21 (the owner: "Code review before every merge is mandatory", after #185 and #186 merged with no review)
- Decision: every PR is opened with the `review` label. `claude-code-review.yml` reviews it and `automerge.yml` skips it, so it merges by hand once the review has landed and its blocking findings are fixed. A large change also gets the `/code-review` skill on the branch before the PR.
- Why: two large PRs auto-merged on green CI with no review, and the review run afterwards on the merged diff found real bugs (a broken import, cost records that overwrote each other, a paid call on empty text).
- Cost: no PR merges itself any more; each waits for a review run and a hand merge.
- Amends: amended by D192 (CodeRabbit replaces claude-code-review.yml).

## D144: phone sheets close by gesture and show no Close

- Date: 2026-10-21 (the owner: "All bottom sheets must be swipable down without x, and should be dismissed when clicked outside the bottom sheet")
- Decision: below 40rem every sheet built from `SheetHeader` or `.sheet-head` (the ⋮ menu sheets, the Library card sheet, the Create sheet, Add source and topic panels, the rewrite panel, the passphrase sheet) shares `scripts/pullDismiss.ts`: a pull from the header, or from the content once scrolled to its top, moves the sheet; a release past a quarter of its height or a flick closes it, a shorter pull springs back; a dialog closes on a tap on its scrim, a popover by light dismiss. Reduced motion skips the follow, not the close. The Close button is visually hidden on a phone (sr-only styles, still focusable); Escape works as before. From 40rem the close controls are as D132 left them. The React sheets (Base UI Drawer) already swiped and closed on the scrim, so they only lose the visible Close. The grabber stays removed (D106).
- Why: a visible X on a phone is a reach and a second way to do what a swipe does.
- Amends: D132 (one header with Close at the end, now visible from 40rem only).

## D145: a deploy reaches the screen on the next page load or return to the app

- Date: 2026-10-21 (the owner's phone kept the old Stories layout after #185 was live)
- Decision: the service worker (v13) answers every page load, briefings included, from the network first with the 3 s fallback to the saved copy; briefings are no longer stale-while-revalidate. Each page carries `<meta name="dispatch-build">` and `/build.json` (no-store) names the build (the commit on Vercel). An app that comes back to the front asks `/build.json` at most once a minute and reloads once per build when the two differ and nothing plays. `dispatch health` faults `site_update` when `/sw.js` is cacheable or `/build.json` does not name a build.
- Why: a briefing's words never change, but its page does with each deploy, and a saved copy names the old stylesheets the shell cache still holds; an installed app resumed for days never navigates at all.
- Amends: D47 (saved copies answer moves inside the app, not page loads).

## D146: a deploy is offered, not forced; Web Vitals wait for their own change

- Date: 2026-10-22 (three review rounds on PR #187 kept finding edge cases in both)
- Decision: a page behind `/build.json` shows the app's toast, "New version available" with Reload, on load and on each return to the front (at most once a minute) while `/build.json` names a newer build; a dismissed toast comes back only at the next such check. Reload reloads at once; it never reloads by itself. Without the Popover API there is no toast, and the next navigation picks up the deploy. The automatic reload and its guards (open dialogs and popovers, typing, edited fields) are gone. The real-user Web Vitals pipeline (page script, `/api/report` kind, Blob day files, `perf_regression`) leaves the PR, and `/api/report` answers an old bundle's unknown kind with 204 before it spends a limiter slot. `run_died` (a failed or timed-out briefing run with no record after it) only alerts: health.yml no longer heals it; a `cancelled` one is the warning `run_cancelled`, since GitHub reports a timeout and the owner's cancel alike. Both stand down only for a newer briefing run under way.
- Why: each round found another thing a reload could throw away; a prompt cannot lose work. A paid run started on a guess (a cancel, a timeout) is worse than an alert; a missed briefing still heals as `run_overdue`. The vitals store needs a per-hour cap and serialised writes, which is its own change.
- Amends: D145 (the reload on return).

## D147: performance is watched by a weekly lab probe, not real-user Web Vitals

- Date: 2026-10-22
- Decision: real-user Web Vitals sampling is not shipped. `health.yml` runs `scripts/perfProbe.ts` on Mondays (D148; daily until then) against news.someshks.work: the home page, the latest briefing and the Library, each loaded cold three times (a fresh context, the service worker blocked) on a Pixel 7 viewport with 4x CPU and Fast 4G throttling through CDP, read as LCP, CLS (web.dev session windows) and TBT, the median kept. `dispatch health --perf` warns `perf_budget` on a page over LCP 2.5 s, CLS 0.1 or TBT 300 ms, and `perf_unmeasured` when the probe wrote nothing. Both are warnings: nothing heals and the job never fails on them.
- Why: two field designs kept producing biased samples on a one-reader site (one phone, a few sessions a day, page hide lost on an installed app), and the store needed its own per-hour cap and serialised writes. A throttled lab load is the same every day, so a change between days is the site's.
- Amends: D146 (the Web Vitals that were to wait for their own change).
- Revisit if: the site gains readers enough to sample, or the lab reading and the owner's phone disagree.

## D148: CI fits the free Actions minutes

- Date: 2026-10-22 (every workflow stopped: the private repository had spent its monthly Actions minutes, and the owner will not pay for more)
- Decision: `ci.yml` runs on pull requests only, not again on each push to `main`, as one `check` job (each job bills whole minutes). Its `browser` job (both suites) runs for a change to `tokens/` or `player.css`, `primitives.css` or `buttons.css`, for a Dependabot pull request, and for one labelled `browser`; every other change runs both suites locally before its pull request. `episode-eval.yml` runs only for the writer, the judges, the voice and `loop/`. `automerge.yml` starts only for Dependabot. Push to a pull request once the local gate passes, not per fix.
- Why: in the week to 2026-10-22 CI took about 880 minutes and the episode eval 290, the briefing runs 22. A full CI run billed 25 minutes, 19 of them the browser job. That used the cap that the briefings, audio and health runs need. A push to `main` re-checked code its pull request had checked and ran for every digest commit. The shared stylesheets and tokens hold most of the load-bearing design fixes the 2026-10-18 rule guards.

## D149: owner config lives in Neon Postgres; the files are the fallback and the snapshot

- Date: 2026-10-22 (the owner connected Neon to the Vercel project; an edit took minutes and a rebuild to show, and D142 hid that for new topics only)
- Path today: the app sends 1 to 8 `ConfigOp`s to `POST /api/config` (`server/configEdit.ts`: same origin, passphrase, a 10 s cooldown counted from config.yml runs), which dispatches `config.yml`; that runs `dispatch config apply` (`engine/src/config/applyOp.ts`, pure but for the feed lookup of `source.add`) and `dispatch config commit` (guard list `config`), and Vercel rebuilds. Pages read `config/` at build time; the engine reads the files from the checkout in each command.
- Switch: the store is on only where `DISPATCH_CONFIG_STORE=postgres` is set beside `DATABASE_URL`, for the engine and the site alike (`engine/src/store/configPaths.ts`, `configStoreUrl`). The URL alone is not enough: Vercel holds it already and `vercel env pull` writes it to a local `.env`. With the store off nothing differs from before: the guard lists, the 405 on `GET /api/config`, and no module loads the Neon driver (`store/neon.ts` is imported only behind the switch: lazily in the engine, by the site's store module, which the route loads with a dynamic import).
- Schema: one table, one row per file holding its exact text: `config_documents(path text primary key, content text not null, version integer not null default 1, updated_at timestamptz not null default now())`. Rows are `CONFIG_DOCUMENT_PATHS`: the `config/` files of the `config` guard list and `state/source-candidates.json` (topic.remove drops a removed topic's suggestions, so they live beside the topics). Text, not jsonb or typed tables: the loaders, the zod schemas and `applyConfigOp` already work on these files, so nothing is remodelled and the snapshot is byte for byte what the engine would write.
- Engine: with the store on, `run` (a whole run, or its `gate` stage, so the later stages of one run read the same config) and `podcast` copy each stored document over its file before they start (`store/configDocs.ts`). A path outside the list or a row that is not JSON is skipped and logged; a file with no row is kept; an unreachable database is a warning and the files are used. `dispatch learn` starts from the stored preferences (an unreachable store stops it) and writes them, on the version it read, only after its commit is pushed.
- History and backup: with the store on, the `run` and `podcast` commits may also carry those paths, so each briefing commits the config it was made with, at no extra Actions minutes (D148). Recovery is the seed from any commit.
- Seed: `dispatch config seed` creates the table and inserts each file that has no row (`on conflict do nothing`), never replacing an edit made in the app; `--dry-run` lists what it would insert. `--replace` also rewrites the rows that differ from the committed files, for a store seeded before switch-on (production was, on 2026-10-22); it is refused while the switch or the gate note says the store is on, unless `--force`. Nothing runs it on its own.
- Write path: with the store on, `/api/config` keeps its parsing, origin check, passphrase and cooldown (counted from the newest `updated_at`), applies the ops with `applyConfigOp` to the stored documents (`engine/src/config/applyDocuments.ts`, in a scratch directory beside the seed `config/sources.json`, bundled as text) and writes the changed ones in one statement that locks the rows, checks every version and divides by zero unless all were written, so a write lands whole or not at all (an edit that got there first: the ops are applied once more on top, then 409). A `source.add` lookup that fails on the site's side (no answer, a timeout, a 5xx) or an edit over 12 s answers 503, which the page keeps pending; a 4xx or an unknown host stays a 400. A new topic's source suggestions wait: `config.yml` edits the committed files, which with the store on are a run old, so it is not started; suggestions come back when a suggest step reads the stored topics.
- Read path (stage 1b, 2026-10-22): a build with `DISPATCH_CONFIG_STORE=postgres` writes `<meta name="dispatch-config-store">`, and then the Settings index, Daily and Weekly, Topics, each topic's page and Blocked outlets ask `GET /api/config` (2.5 s at most) before the editor reads its starting point. The route selects only the five public files and answers the ops that turn the files the function bundles (the pages' own commit) into the stored ones (`server/configView.ts`, which runs the build's own `buildManage`, `topicLayout` and `scheduleViewOf`), plus the sources a topic page must draw (added, or moved to it), `written_at`, and `built`, a digest of the bundled files that the page's tag also carries (`lib/configHash.ts`): a page from another build lays nothing over itself; Vercel's edge keeps it a second (`s-maxage=1`). The pages lay those ops over the built page exactly as they lay a just-saved edit (`savedView.ts`), a source filed elsewhere goes, one filed here is drawn (`storedSourceRow`), and this device's saved edits older than `written_at` give way (`withStore`), compared on the database's clock: a write answers its own `written_at`, which the page keeps with its copy. A changed scope list goes whole, so a chip of several topics reads it. Off, down, slow or unreadable: the built page, as before. Votes, opens, the learning history, the writer, the queries and the suggestions are never selected.
- Blockers closed with it: the cron reads the hour from the store (main when it cannot); each `source.add` op answers for its own lookups, a refusal the address gives (ENOTFOUND at any depth, a duplicate) is never retryable, and no lookup may wait past what is left of the edit's 12 s deadline (discovery keeps its own timeouts and retry, so a slow page keeps its feed); `learn` stops when the store cannot be read or the branch holds an unpushed commit, and writes it only after its commit is pushed, applying the patch once more over an app edit made meanwhile; the gate notes in `.cache/config-store.json` that it copied (a note it cannot write skips the copy; `--record-failed` leaves it), and the commit guard reads that, not the switch; the cron gives the store 5 s; a rebase that stops only on copied config files takes the branch's copy; a version conflict is applied once more on the server before a 409.
- Left before switching on: `run.yml` (its Gate step) and `podcast.yml` must pass `DATABASE_URL` and `DISPATCH_CONFIG_STORE` to the engine, or a run builds from git while the pages show the store (runbook section 11). A topic page draws a stored source with New for its score until the next build rates it; the Topics list's flat search does not list it.

## D150: the paid routes' caps are counted in Neon, with the instance's own count as the floor

- Date: 2026-10-22
- Decision: the per-minute caps of the open routes that spend (D41) are counted in one Neon table, `rate_limit_counters` (one row per bucket: the window number and its count; one atomic upsert per request; `engine/src/store/rateCounter.ts`, created by `dispatch config seed`). Buckets: `topic-emoji` (20 a minute; a request that would ask Jev or Gemini), `source-preview:jev` (20, checked before Jev's 3 s), `costs` (30), and a burst cap on the routes that start workflows, `generate` (8, deletes too), `podcast` (10, deletes too) and `config` (12), which answer 429 `cooldown` to the end of the minute past it; their handlers take the slot only after the origin, body and passphrase checks pass, so another site's requests cannot fill it. `server/rateLimit.ts` takes the instance's own slot first, so the shared count only tightens; with no `DATABASE_URL`, an error or no answer in 1 s the instance's slot stands alone and the counter is left alone for 30 s (5 s after a timeout). The counter needs only `DATABASE_URL`, not `DISPATCH_CONFIG_STORE`, so with a URL set the site loads the Neon driver for it (amends D149's "no module loads the driver").
- Why: a cold start reset every per-instance cap; the Generate, Podcast and config caps count GitHub's run list, which lags a dispatch by seconds, so a burst could pass them together.
- Cost: one query (about 20 to 50 ms) per limited request when the counter is up; nothing changes until the owner reruns `dispatch config seed`. A workflow route's slot is taken only after its passphrase passes, so with the passphrase on (D41 has it off) wrong guesses are not capped per minute, as before this change; with it off anyone can fill the minute, as anyone can spend the GitHub-counted daily caps. The `source-preview` check can add up to 1 s before Jev's 3 s. Narration takes the same burst cap from 2026-10-22 (bucket `narrate`, `NARRATIONS_PER_MINUTE` in `pages/api/narrate.ts`), its slot taken the same way and before the store is opened, so a flood past it reads no Blob; but each segment request, about one per turn played, waits for the query (up to 1 s while Neon wakes, counted in the function's time), a listen keeps Neon awake, and with the passphrase off anyone who fills the minute makes the player fail the next turn, even one already narrated, until the minute ends (it shows a failed file with Try again: the player has no words for `cooldown`).
- Rejected: Upstash or Vercel KV (a second store and key); a sliding log (a row per request).
- Revisit if: the narration route needs a request cap (its spend is held by the daily digest cap and the monthly budget, both counted in Blob). Met 2026-10-22: narration takes the burst cap (see Cost); revisit its size if a listener meets `cooldown`.

## D151: CI fails on a high advisory in what ships; path-to-regexp is held at 6.3.0

- Date: 2026-10-22
- Decision: the CI audit step runs `npm audit --omit=dev --audit-level=high` (was `critical`). The one high advisory, GHSA-9wv6-86v2-598j in `path-to-regexp` 6.1.0 (an exact pin of `@vercel/routing-utils` under `@astrojs/vercel`), is answered by a root `overrides` entry that holds it at 6.3.0, the patched release of the same major.
- Why: hardening.md recommended it; Dependabot cannot fix an exact pin, and the upstream fix was a major of the adapter.
- Cost: routing-utils builds route regexes with 6.1.0 on purpose and compiles each with 6.3.0 only to log `[vc] PATH TO REGEXP PATH DIFF`; with both at 6.3.0 that warning can never fire, and a pattern with two parameters in one segment (`/:a-:b`) compiles differently. Today's output is identical (`.vercel/output/config.json` and every `.vc-config.json`, 39 routes) and the unoverridden build logged no diff. After a change to `vercel.json`'s sources or the adapter, diff `config.json` against `main`. A new high advisory with no fix in range turns every PR red until it is answered.
- 2026-10-24: two more high advisories. `undici` (GHSA-xjj6-f33q-929c) moved inside its declared ranges to 6.29.1 under `@vercel/blob` and 8.12.3 under `unifont`, no override; `zod` 4.1.11, an exact pin in `@vercel/cli-config` under `@vercel/blob`, is held at 4.6.7 (the version the rest of the tree uses) by a second override.
- Revisit if: `@vercel/routing-utils` pins a patched `path-to-regexp` (drop the override), or a high advisory has no fix to take (decide then: an override, or accept it here by name).

## D152: a full-screen phone sheet shows its Close

- Date: 2026-10-22 (the owner, on the visual audit's item 8: full-screen sheets show the X on the right, as on desktop; partial bottom sheets keep none)
- Decision: below 40rem a sheet that fills the screen (`dialog.create-sheet`: New episode, the topic and source panel, Regenerate) shows its Close at the end of its header row, as from 40rem. The partial sheets (the menu sheets, the emoji picker, the React drawers, the passphrase sheet) keep D144: no visible Close, a pull or a tap outside closes them. Pull to dismiss stays on every sheet. One selector in `create-sheet.css` under `SheetHeader.astro`.
- Why: a full-screen sheet leaves no page showing to tap away to, so the only visible way out was a gesture with no affordance.
- Amends: D144.

## D153: engagement is counted by D154's Simple Analytics, and an episode is shared as a public listen link

- Date: 2026-10-22 (the owner: a "User engagement" item under Settings, Analytics, "open to a lightweight analytics tool", and growth loops "starting with sharing episodes with anyone")
- Status: approved by the owner on 2026-10-22 ("I like all your recommendations, just skip passphrase for now"); aligned with D154 on 2026-10-24 (the owner: "align the D153 engagement plan with it, so the two do not overlap"); built stage by stage, link previews first. The plan and the stages with test points: [engagement-and-share-plan.md](engineering/engagement-and-share-plan.md).
- Decision:
  - Simple Analytics (D154) is the one counter. The listen page sends D154's `listen_*` and `share` with `surface`, `generation` and `item` metadata, and one new event, `react`; the token never reaches it. No first-party event table, beacon route or device-only view.
  - User engagement under Settings, Analytics opens the Simple Analytics dashboard (the owner, 2026-10-24: "keep stage 1 as a link to the Simple Analytics dashboard; decide on in-app numbers later"). Numbers inside the app need public stats (the Stats API answers without a key) or a plan with API access.
  - No passphrase: the stage that would have locked actions is dropped (D160). The owner will gate actions with OAuth later and hide them from logged-out users.
  - Link previews come first, on the pages Share sends today, because Share can only send a page's address until the listen page exists (owner: "link preview is very good idea").
  - One expiring, revocable link per item whose audio is fully stored, made by anyone until OAuth, then by the owner alone. `/s/<token>` (an HMAC-checked token, rendered on the server, CDN-cached five minutes) shows the cover, Play, the stories with their sources, the transcript, Send it to someone and a reaction; it plays stored audio only and never narrates; it has no app shell, service worker or search indexing, and an Open Graph card. Neon keeps only the links and their play counts: shared plays stop at 4 GB of Blob transfer a month and 100 a link.
- Why: D154 already counts the loops on production; a second counter would split the numbers and cost a route, a table and Neon compute. What a vendor cannot do, refuse a play past the Blob budget, stays first-party. Today's Share sends the app's own address, which opens the whole app.
- Cost: counts are a floor (ad blockers, offline listens, D154); no numbers inside the app until the owner picks how to read them; until OAuth, a listener who leaves the listen page for the app can do what anyone can (D160); public links publish narrated summaries of others' reporting beyond D9's one reader; Blob's Hobby lockout is the ceiling the budget guards.
- Rejected: first-party events in Neon beside Simple Analytics (this decision's first draft: two counts of one thing); a device-only engagement view (one browser's listening); Plausible Business, Umami Pro or Vercel Pro (a monthly fee for one reader); PostHog (storage by default, the heaviest script); per-recipient links (they track people one by one); a waitlist now (consent, a privacy notice and a plan above Hobby first); the full player on the listen page (its narration fallback spends).
- Amends: D154's Context (its events stay; this adds the listen page's and `item` metadata).
- Revisit if: ad blockers hide most listens, Simple Analytics' API or plans change, shared plays pass half the monthly budget, or the owner opens sign-ups.

## D154: cookieless visit counts with Simple Analytics, a few named events, and a Privacy page

- Date: 2026-10-22
- Decision: the site is for anyone with the link (the owner's call, 2026-10-22), so it counts visits with Simple Analytics, loaded by `lib/analytics.ts` on `news.someshks.work` alone and never for a browser that sends Do Not Track or Global Privacy Control. Nine events, each with a kind, topic or outcome and nothing about the reader: `share`, `listen_start`, `listen_half`, `listen_complete`, `story_open`, `vote`, `download`, `install`, `create_episode`. A shared link carries `?ref=share`. The page policy allows the script host and the queue host by name; no `'unsafe-inline'`, so no automated events and no `noscript` pixel. `/settings/privacy` says what is counted, kept and sent, from an inventory of the code. The loops and their numbers are in [specs/analytics.md](specs/analytics.md).
- Why: the owner wants to see which loops (share, habit, taste, create) turn visitors into listeners and sharers. Simple Analytics counts in aggregate without cookies, storage or IP, so the site needs no consent banner and keeps its privacy. Sentry was considered and is an error monitor; the site's own `/api/report` covers errors.
- Cost: about 7.5 KB of third-party script per session, outside the first-load budget (it loads async from another host); two hosts in the policy; counts are a floor (ad blockers) and unique visits run high (`no-referrer` makes a reload look new).
- Rejected: the `noscript` pixel (mostly robots, by Simple Analytics' advice); automated events (need `'unsafe-inline'`); a per-device id for retention (identifies a reader; installs and `installed` page views stand in); PostHog or Sentry replay (record individuals).
- Context: D153 (proposed the same day on another branch) first counted events first-party in Neon. Approved, then aligned with this decision on 2026-10-24: these events stay, and D153 adds the listen page's, with `surface`, `generation` and `item` metadata and a `react` event.
- Revisit if: retention per reader becomes the question (that needs accounts or an identifier, and a new privacy page), or ad blockers hide most visits (Simple Analytics' custom-domain proxy).

## D155: Software Engineering is the owner's fourth topic, with its own section and an engineering-depth judge category

- Date: 2026-10-22
- Decision: a built-in group `software` (name Software Engineering, emoji 💻, home `software_engineering_depth`) with its own briefing section `software`, ordered right after `ui-craft` in `SECTIONS` (and in `config/topics.json`). It competes like Design and AI: no allowance of its own, no special cap. A twelfth category `software_engineering_depth` ("Engineering deep dives", craft depth, weight 0.85) is appended to `CATEGORIES`; `developer_tool_launches` homes to `software` too. The page `/settings/topics/software` has generated topic art; the two categories' old page URLs redirect to it.
- Release news unchanged: a story judged `developer_tool_launches` is still release news (6 percent cap, never a Top pick, Launches, read last), as the owner asked on 2026-10-15 and 2026-10-18. The branch first lifted the cap as a judgment call; review put it back, and moved the group's home to `software_engineering_depth` so an added source can lead. The prefilter lets a source hinted or tagged `software_engineering_depth` through as it does a Design-tagged one, unless that category is Off. A briefing dated 2026-10-22 or earlier keeps tool launches in `ui-craft` (`FORMER_HOMES`, validate). A preferences file without the new weight reads it at 0.85 (`ADDED_CATEGORIES`); any other missing weight still fails. A Create episode never matches release news (Launches), as before.
- Sources: `react-status` and `this-week-in-react` moved to `developer_tool_launches`; `cloudflare-blog`, `stripe-engineering`, `github-engineering`, `dan-abramov`, `kent-c-dodds` and `lee-robinson` to `software_engineering_depth`. Component libraries stay in Design, AI engineering writers in AI.
- Cost: the category choice gains an option, so the questions hash changes and the judge cache is asked again once. There is no extra call per item. The median weight is now the mean of the middle two of twelve.
- The Create panel has a Software Engineering chip, ticked by default like the other three.
- Revisit if: the Software section stays empty for a week (too few depth stories), or the owner wants tool launches to lead.

## D156: field Web Vitals from real visits, kept in Neon and judged daily by `dispatch health`

- Date: 2026-10-22 (the owner asked for real-user Web Vitals, so a regression on real phones raises a health finding, not only the weekly lab probe)
- Decision: each page load on news.someshks.work, with D154's opt-outs (no Do Not Track or Global Privacy Control, the production host alone), sends one beacon to `/api/report` with LCP, INP and CLS, its route template (`/d/[id]`, never an address), the device class (a coarse pointer is `mobile`) and the connection type, and nothing else. The collector (`scripts/vitals.ts`) reads PerformanceObserver itself, loads at idle or at the first visibility change (`app.ts`), and sends at the first hide, with pagehide as the fallback: an installed app going to the background fires the one, rarely the other. One report per page load, as CrUX counts (a tab opened in the background reports only once it has been shown): the landing page's LCP (none after a first hide), and CLS (web.dev's session windows, shared with the lab probe) and INP (web.dev's 98th percentile) over its life to that hide, moves inside the app included. `/api/report` takes vitals at 30 a minute per instance apart from the faults' 30, applies the template and bounds again, and inserts one row per metric into Neon's `web_vitals` (`engine/src/store/vitalsStore.ts`): each insert and each health read deletes what is older than 7 days, and an insert is refused while the last hour holds 600 rows; the first one creates the table. The write waits up to 5 s for a waking database, never fails the beacon, and backs off on an error (`server/database.ts`, now shared with D150's counter). `dispatch health` reads each metric's 7-day p75 per device class daily (one query; `health.yml` passes the `DATABASE_URL` secret): `field_vitals` warns past "needs improvement" (LCP 2.5 s, INP 200 ms, CLS 0.1) and faults past "poor" (4 s, 500 ms, 0.25), which opens the `health` issue; `field_unmeasured` warns when phones gave a metric under 20 samples in the week, or the store cannot be read. Desktops are judged once they have 20.
- Why: the lab probe is one throttled Chromium on Mondays; a page that turned slow on real phones (a slow network, an older device, an installed app) said nothing. Neon over Blob: an insert is atomic, so there is no day file to serialise or cap per hour (D147's blocker), Blob's 2,000 advanced operations a month would not last, and health cannot read Vercel's logs. Daily, not weekly: the read is one query and a 7-day p75 moves slowly, so a daily look costs nothing and says it within a day.
- Context changed: D154 opened the site to anyone with the link, so it can gather samples; the losses D147 met (a page hide never fired by an installed app, one sample an hour) are answered by the first hide and a cap only a flood reaches; Neon (D149, D150) gives atomic writes.
- Cost: 60 bytes gzipped on every page's first load (the heaviest page 111.1 to 111.2 of 130 KB); a 1.1 KB chunk at idle on production; one function call and one Neon query per page load, which keeps Neon awake longer; at most about 100,000 rows. The endpoint is open (D41): a forged flood can fill an hour's 600 rows and move a p75 into a false alarm, never a heal or a spend. Presses in a resumed installed app after its first hide are not counted, and a reader who leaves before the chunk arrives sends nothing. A press too quick to be observed (under 16 ms, or under 104 ms before the chunk loaded) reads as 0 in INP, which never changes a rating. A p75 of 20 phone samples is rough.
- Rejected: rows in D153's proposed `engagement_events` (not built; it keeps 13 months with a per-load session id and a country, in whole seconds, where vitals keep 7 days, no identifier and a fractional CLS, and would grow it a row per metric per page load); the web-vitals package (its README puts it at about 2 KB brotli, twice this collector, for the same three numbers); Vercel Speed Insights (a dashboard health cannot read); a report per move inside the app (D146's split, which browsers measure without an LCP); sampling a share of loads (too few readers to spare any).
- Amends: D147 (field Vitals are judged beside the lab probe).
- Revisit if: phones give LCP under 20 samples in most weeks (read 28 days), or forged reports appear (a per-page token, or drop the store).

## D157: health watches the store and the deploy, and its warnings reach the owner

- Date: 2026-10-22 (a dedicated Opus audit of what shipped after the 2026-10-21 hardening map: the Neon rate counter, the config store, field Vitals, branch cleanup)
- Decision: `dispatch health` adds `store_degraded` (warning: with `DATABASE_URL` set, health's own Neon connection or the rate counter's check fails), `config_store_drift` (fault: a stored config document that is not JSON or fails its core schema; warning: one that differs from git though written before the last committed run), `config_store_unread` (fault: the documents do not read, so runs keep the committed files while the app edits the store), `site_behind` (warning: `/build.json` lacks the newest non-bot commit on `origin/main` touching a path Vercel's `ignoreCommand` watches, 45 minutes on) and `site_usage_unread` (warning). `speech_budget` adds the site's own month of narration. `takeSharedSlot` creates `rate_limit_counters` on its first request, as the vitals store does. `health.yml` opens or updates one `health-warnings` issue on Mondays listing the standing warnings (closed when none remain, untouched when health crashed or the issue list fails), and an open `health` issue's daily comment leads with faults new since the bot's last comment. One newest-first order (`compareNewestFirst`, core) serves the site, `dispatch status` and `dispatch health`, so a regenerated older briefing no longer reads as the newest (it raised a false `site_stale`).
- Why: warnings went nowhere (only a fault's comment or the run log carried them); a Neon outage turned the shared caps per instance and dropped Vitals without a word; the seeded store drifts from git when code changes a config shape (D155 showed it). A fault is kept for what the owner can act on and what holds for a day; everything weaker is a warning, read weekly.
- Rejected: a late-briefing warning (built and removed: Vercel Cron starts the on-time run as a `workflow_dispatch`, D61, and run.yml makes skipped hourly `schedule` runs, so nothing tells late from on time or from a regenerate; it needs the trigger in the run record); site narration in the 24-hour ceiling (its records are per day); `store_degraded` and `site_behind` as faults (a waking Neon and Dependabot merges Hobby never deploys would open the issue). Also rejected after it shipped: diffing the skip check from `VERCEL_GIT_PREVIOUS_SHA` (#220). The command came to 341 characters; Vercel refuses an `ignoreCommand` over 256, so every deploy failed validation until it was reverted. A multi-commit push can still skip a deploy; `site_behind` reports it.
- Amends: D146 (warnings now reach the owner, weekly).
- Revisit if: the `health-warnings` issue stays open for a month with the same codes (tune or drop them), or a run record gains its trigger and copy time (then `run_late` and a drift fault come back).

## D158: client faults kept a week in Neon, judged as warnings

- Date: 2026-10-22 (the Opus audit's second gap: a page error or a CSP violation on a phone reached only a log line, and Vercel Hobby keeps runtime logs for one hour)
- Decision: `/api/report` keeps each client fault in Neon (`client_faults`, created on first write, 7 days, 120 rows an hour at most, never failing the beacon): the kind, the route template (never an address), the message's start only (cut before any quote, newline, digit, `@`, `/` or `www`, at most 60 characters, control characters removed), the CSP directive, the blocked and source origins or schemes, and the build the page loaded with (read once when `app.ts` starts). A report raised by a browser extension is dropped. `dispatch health` reads the last 24 hours across builds and only warns: 3 or more blocked scripts, or 20 or more errors on one route (an opaque cross-origin "Script error." does not count); route, message and build reach GitHub as inline code. A failed read is a warning; a missing table is no finding. A 5xx any `/api` route answers, thrown or returned (through `answerWithRef`, or `recordingFaults` for routes that answer for themselves), is kept as kind `server`: the route label, the step code its body names (`synthesis_failed`) or a throw's redacted start, and the build; written under `waitUntil`, never holding the answer, one a minute per route per instance, and only a 500 for the two routes that fetch a host the caller picks. 3 or more on one route in 24 hours warn. A function Vercel kills (a timeout, a crash) answers the page with its own 5xx and an `x-vercel-error` code; the page reports it once per route a load (`lib/platformFaults.ts` watches `fetch`, since 13 page scripts call `/api` with no shared helper; without the header it reads the code, a line or tag of its own, from the first 16 KB of Vercel's text or HTML error page, never a JSON answer), stored as kind `platform` (route label, the code), and 3 or more on one route in 24 hours warn.
- Why: a script the CSP blocks after a deploy, or a page that throws on phones, was invisible after an hour. Warnings, not faults: the endpoint is open (D41), so anyone can forge a report, and extensions trip the CSP on their own.
- Privacy: no IP, user agent or identifier; fault reports are sent without D154's DNT and GPC opt-out, as before, and the Privacy page says so.
- Rejected: storing the full message with quoted text removed by pairing quotes (review showed a reader's text survived: an email inside a JSON parse error, apostrophes, « » quotes); judging only the current build (content commits redeploy several times a day and wiped the history); a fault on one blocked script.
- Revisit if: a warning turns out to be forged or extension noise (raise the threshold or add a per-page token), or the owner wants faults counted per reader.

## D159: a missing deploy is a fault a day on, and a failed smoke check opens an issue

- Date: 2026-10-22 (#220's `vercel.json` failed Vercel's schema and every production deploy for hours; nothing told the owner)
- Decision: `site_behind` stays a warning at first and becomes a fault (the `health` issue) once the oldest watched commit the live build lacks is a day old, counted from that commit, not the newest, since digests land daily. `smoke.yml` opens or comments on one issue labelled `smoke` when the live site fails its check, and the next passing run closes it; Vercel's other events (pending, previews) no longer cancel a failing check.
- Why: D157 kept `site_behind` a warning because the next push may clear it, and warnings reach the owner on Mondays; a deploy that stays missing a day will not clear. A smoke run Vercel starts belongs to `vercel[bot]`, so its failure email reached no one.
- Rejected: failing `smoke.yml` on Vercel's failed production deploy events. How Vercel reports a build the `ignoreCommand` skipped, or one a newer push superseded, is undocumented, so it would raise false issues; running the commit's own `ignoreCommand` to tell them apart misreads the very case where `vercel.json` is what broke. Counting from the newest commit (review: a daily digest kept a days-old outage a warning).
- Revisit if: Vercel documents its deployment states for skipped and superseded builds, or a deploy fails for a day without a fault.

## D160: the passphrase is removed completely

- Date: 2026-10-22 (the owner: "remove passphrase completely", after approving D153's stage 0, which would have turned it back on; that stage was dropped before it merged)
- Decision: there is no passphrase anywhere. The four routes that spend or edit (`/api/generate`, `/api/podcast`, `/api/config`, and `/api/narrate` POST) check the origin, the body and their caps, and never answer 401. Request bodies carry no `passphrase`; one that a page built before this still sends is ignored. The prompts are gone: the narration sheet ("Make the audio"), the Create dialog, the Regenerate, Delete and settings-save fields, and the device memory `dispatch:narrate-passphrase`, which nothing reads or writes now. `GENERATE_PASSPHRASE_HASH`, `npm run passphrase`, `@dispatch/core/passphrase` and the scrypt verifier are deleted. A failed run's Try again always resends its request, so the path that reopened the form after a refused passphrase is gone too.
- Cost: anyone who opens the site, a shared link included, can start a briefing, an episode, narration, a regeneration or a delete, and edit topics, sources and the schedule, bounded only by the daily caps, the monthly narration budget and the per-minute caps (D150). This is D41's risk with no switch left to turn back.
- Rejected: keeping the code behind a switch (D41); asking once per device (D153's stage 0).
- Supersedes: D41. Amends: D153 (stage 0 dropped).
- Revisit if: someone other than the owner spends or edits. The answer then is accounts or a per-device token, not a shared passphrase.

## D161: a story's publisher sits above its headline

- Date: 2026-10-23
- Decision: in a briefing's story and an episode's highlight, the publisher's quiet link (muted, label size, its open-in-new glyph) is a line of its own above the headline, shortened only when wider than the column. The row under the text holds the Play chip and the story controls, on one line at every width.
- Why: in one row with the chip (112px, sized for "Play again") and three 44px controls, the publisher kept about six letters at 360px and one at 320 for every name in the fixture (measured 2026-10-23). The owner chose the order a news list uses over a cut name or controls wrapping to an orphan line.
- Rejected: the name cut with an ellipsis in the row (the owner's first call, 2026-10-22, before the measurement); dropping its glyph on a phone (about three letters more); a row that wraps (the orphan controls the owner had asked to remove).
- Amends: D31's type rule that a quiet line goes under its title, never above it, for the publisher alone.
- Revisit if: the chip and the controls narrow enough to hold a whole name beside them.

## D165: YouTube captions come through Firecrawl when YouTube refuses the runner

- Date: 2026-10-24 (the owner: "yt-dlp is a very reliable option, use this"; then "look into possible workarounds to make the youtube transcription extraction reliable")
- Decision: when youtube.com's player API refuses the run (it has refused GitHub's runners since about 2026-10-14), the extractor asks Firecrawl's Alexandria provider `youtube-com/videos/video_transcript` for the same captions. One scrape request a video from the run's Firecrawl budget (`FirecrawlGuard.relay`, so a video relayed once in a run is not paid twice), about 5 credits a video, metered in the cost ledger under firecrawl/alexandria. Order stays: cache, youtube.com (free), Firecrawl, Gemini (3 a run), the description. The method recorded is `captions`, as they are.
- Why: the block is on the address, not the tool. Measured from a datacenter address on 2026-10-24: the watch page answers 429 and every yt-dlp player client (default, tv, mweb, web_embedded) ends in "Sign in to confirm you're not a bot"; yt-dlp's maintainers say a PO-token provider does not lift that wall (yt-dlp #15865) and point to cookies. Firecrawl already holds a key, a budget and a ledger row here (D138), and its provider makes the InnerTube call our own code makes, from an address YouTube serves. Measured live the same day: a full transcript in one call.
- Rejected: yt-dlp with a Google account's cookies in a secret (works, but YouTube may flag the account for automated use, the cookies expire, and the workflow gains Python and a secret to rotate); a PO-token sidecar (does not answer the sign-in wall); a paid residential proxy (a monthly bill for one feature); a hosted transcript API (a new vendor and key for what Firecrawl already sells).
- Revisit if: Firecrawl's provider goes away or its price rises above a scrape's worth (then yt-dlp with a throwaway account's cookies is the next step, behind the same `relay` budget), or YouTube serves the runners again (then the free path answers first and Firecrawl is never asked).

## D166: Firecrawl gets 100 requests a week, at most 50 a run

- Date: 2026-10-24 (the owner: "change firecrawl budget to 100 per week")
- Decision: each stage reads the cost ledger for the Firecrawl requests (listing pages and scrapes) other runs made in the 7 days before this one, and holds the run to what is left, at most 50 (was 30, D42); listings keep 55% of a run's room. A failed run's spend goes to the ledger with its failure record. A listing source left out for the week says so in its note. A ledger that does not read, or a run with no start time, warns and leaves the run its own 50.
- Why: the YouTube relay (#235) and the article scrapes press on 30 a run. A weekly cap lets one run use more while the week stays at the owner's number; 50 is half the week, so one run can never spend it all.
- Not counted: Alexandria credits (their own cap of 30 a run, D138); dry runs, failed replacements and on-demand runs, which commit nothing; a cancelled or timed-out run, which skips its failure record. A ledger that does not read fails open (a warning, the run's own 50): a briefing without Firecrawl loses its YouTube feeds and scrapes.
- Revisit if: the owner's Firecrawl plan changes, or a week's ledger passes 100.

## D167: one control has one shape wherever it stands, and every list is a bottom sheet on a phone

- Date: 2026-10-23 (the owner: "different types of drop-down and chips with different radius, that shouldn't be possible in a design system unless requested"; "some dropdowns have a blue flash on click on phones and not others"; "most of the drop downs on phone should be using a bottom sheet"; "the chevron optically aligns with the search bar")
- Decision: A chip, a select chip, a select's value, a segmented control and the search field are pills everywhere, in a card as on the page. The three concentric overrides of 2026-10-22 go: `.card-group` chips and select values (`primitives.css`), the Costs card's chips (`costs.css`, which also kept a chevron 8px from the end; it now shares the Library chip's 16px), and the topic panel's switch, field, Add and chips (`topics.css`), with the Listen in value. A row's tile and a button keep the concentric radius (`.card-group .btn`, `.row-action::after`), and a form's text fields keep `--field-radius`: the Add source panel's selects stand beside text inputs and follow them. Under 40rem every list that opens from a field is a bottom sheet with the sheet's corners, surface and scrim: a select's drawn list (`::picker(select)`, CSS alone), the searchable picker (`picker.ts` sets `data-sheet` and lets CSS place it) and the multi-select (fixed in place; the card around it rises to `--z-sheet`). A select and an input lose the tap highlight (`foundations.css`): the flash showed on native selects and not on the buttons beside them. A Sources row and a source row take the search field's 16px inline padding, so the emoji and the chevron sit where the field's glyph and clear button do; the chevron is no longer pulled out to the edge.
- Why: the concentric rule gave one chip three radii (pill on the Library, 8px in a card, 8px in the topic panel) and one select chip two, which read as different components; the owner saw it on the phone a day after choosing it. A phone's anchored popover under a value is small and far from the thumb; the More menu is already a sheet there.
- Cost: a popover's backdrop lets a tap through, so a tap on the scrim can also press what is under it (as the More menu's can); the multi-select is not a popover, so its sheet is drawn inside the card's layer and the card is lifted over the navigation bar while it is open. `lightningcss` rejects `::picker(select)::backdrop` and fails the build, so the select sheet's scrim is a spread of its shadow (`0 0 0 100vmax`).
- Rejected: making the multi-select a popover with anchor positioning (desktop placement would need anchors in every engine, or JS); pills for the panel's text fields (a textarea pill); a scrim-less sheet.
- Amends: the card rule of 2026-10-22 (D72's tonal language, [ledger](design-engineering-ledger.md) section 1) for chips, select values and segmented controls.
- Revisit if: Firefox and Safari draw the select list natively on phones (they keep the system picker, which is a sheet of its own), or a tap on the scrim reaches a control under it in use.

## D168: the primary action is Catch up, Latest is a bolt, and a toast swipes away

- Date: 2026-10-23 (the owner: "rename new episode to catch-up, change fire emoji for latest to zap emoji"; "I need to be able to swipe away snack bars or toasts on mobile")
- Decision: The action that makes an episode on request is called Catch up on the floating button, the side column, the sheet's title, the Create page and the Library's empty state, and in the manifest's shortcut: the name of the kind those episodes are filed under (the Library chip, Listen in), so the button names what it makes. Spelled "Catch up", the app's existing noun, not the owner's "catch-up". Latest's glyph is Phosphor's lightning, regular and fill; the flame is gone from the glyph set. A toast slides sideways under a finger and leaves past 35% of its width or at 0.6 px/ms (`Toaster.tsx`); a shorter drag springs it back. A swipe dismisses, it never undoes: a removal's wait still ends in the removal. A mouse does not drag it, and a press on its buttons is theirs.
- Why: "New episode" named the mechanism; the Library already called the result Catch up. A phone's snackbar is swiped away everywhere else, and the toast's close button shows only while an action is offered.
- Cost: four browser tests and four specs renamed; a reader who learnt "New episode" finds Catch up in its place.
- Amends: D52 (the floating button's word).

## D169: queue rows move by drag and menu, and the phone's controls hold still

- Date: 2026-10-23 (the owner: "the up next & stories tabs must be segmented selectors"; "the up next list items must be draggable on long press on mobile, by click on desktop... replaced with a swipe left gesture for removing a track from queue... have 3 dots icon buttons"; "it is annoying when I scroll up to see the glitch when the top navigation bar also shows up with sticky sources bar"; "the tabs on podcast details page are placed too close"; "drop-down consistency must also happen on all pages"; "two icon segmented selector items to switch between chart and table"; "the status text must be on the right side")
- Decision:
  - The player's Stories and Up next switch keeps the segmented look at every width; on a phone it sits in a sticky bar on the page's colour (`.player-tabs-bar`) instead of becoming a tab line.
  - A queue row has no handle and no cross. It moves by the browser's own drag and drop (`draggable`: a long press lifts it under a finger, a press and pull with a mouse; the list keeps scrolling), the row it is over shows an accent line on the edge it would join, and a sideways swipe to the left takes it off (past 35% of its width or 0.6 px/ms; a short one springs back). The dots at its end open the header's More menu (`hero-menu-list menu-sheet`: a popover under the dots, a bottom sheet on a phone) with Move up, Move down and Remove from queue, which is also the keyboard's way, announced as before.
  - A page with a block that sticks under the app bar (a topic's search and chips) pins the bar: `data-pins-bar` on the block, read by the header's scroll script. The bar had slid away and back as the reader scrolled, moving the block by its height each time.
  - Section tabs sit 16px each side (32px apart), the indicator under the words; the strip takes the extra back at the gutter.
  - Every select is a pill, in a form too: the Create sheet's selects and pickers, the Add source panel's, the multi-select trigger. Text fields keep `--field-radius`.
  - The Costs card switches between its chart and its table with two glyph tabs (chart, table) at the end of the filter row, the segmented navigation made compact; the "Show as a table" disclosure under the card is gone.
  - A weight row's stop name sits at the end of its first line, across from the name.
- Why: the handle and cross made the row read as a form; a phone's lists move by long press and swipe. Native drag and drop is the one way a long press can lift a row while the list still scrolls (a pointer-events drag needs `touch-action: none`, which kills scrolling; that is why the handle existed). The bar pin was the owner's own first suggestion and costs 56px; making the block follow the bar as the briefing's tabs do (`--tabs-follow`) would take a measuring script per page.
- Cost: the drag ghost is the browser's; the drop line is the only drawn feedback. A swipe on a mouse works too (owner's ask) and so a sideways mouse drag never starts a reorder; vertical does. Four sheet mechanisms now exist for one look (ledger gap 11).
- Rejected: a pointer-events long-press drag (no scrolling); anchor-positioned React popovers with their own anchors (the header menu's `--hero-more` name resolves to the nearest dots, so the shared rules serve).
- Amends: D126 (the queue's handle and cross).

## D170: a modular podcast structure, accepted

- Date: 2026-10-23 (the owner: "there must be a segmented selector, one for source types, another for podcast structure (making it modular, able to add and delete new sections)... The scope is set for all kinds of podcasts. Evolve this idea to address all gaps before building it")
- Status: accepted, not built. [The design](design/podcast-structure.md) answers the ask: one structure per kind (daily, weekly, catch up) as an ordered list of blocks (hello, rundown, sections with depth and count, top picks, trending, release news, close, sign-off) in `config/structure.json`, one `structure.set` op, read by curate (section order and allowances) and by the episode planner and prompt; a Preferences view with the queue's reorder gestures and a sheet to add or edit a block; defaults that reproduce today's shapes exactly, so nothing changes until edited. The owner answered its five questions on 2026-10-24 (both shapes follow it, a `custom` block with a title and a brief, one list per kind, no separate Catch up editor, its own file); the design holds the answers.
- Why: a briefing's reading order and an episode's script shape live in two files nobody can edit; the owner wants to compose them.
- Revisit if: phase 1 of the design shows the planner cannot reproduce today's shapes from the default blocks.

## D171: covers take a step of colour: chroma to 0.16, the light stock deeper and tinted

- Date: 2026-10-23 (the owner: "the album arts of the podcasts are very dull, they need to be refreshing in all themes but still be optimized for dark and light theme")
- Decision: `MAX_CHROMA` rises from 0.12 to 0.16 and every palette's ground and accent in `tokens/covers.json` carries 1.4 times its chroma, capped there (text roles unchanged). The monthly paper (`series/paper.ts`) reads as a coloured stock: its least chroma 0.045 to 0.09, its inks 1.4 times the scheme's colour (was 1.25), and the light theme's stocks a step deeper (weekly 0.92 to 0.88, on-demand 0.86 to 0.81, daily 0.80 to 0.74 in OKLCH lightness); the dark theme's stocks stay, since the dark page already carried full chroma. Every contrast floor is still held by the code and the family tests; the site's cover cache key hashes the renderer and the palettes, so the next build redraws every cover.
- Why: D121 answered "too saturated" on 2026-10-15 with a 0.12 cap and pale papers; eight days of the October paper read as dull on the phone. The paper is nine tenths of each cover, so its tint and depth move the grid more than any ink.
- Cost: a grid of a month is more colourful than D121 measured for (its colourfulness check is not rerun here); the owner's "too bright on light mode" weeklies are a step deeper, not brighter. One hue family a month is still the scheme's rule, so variety across a month comes from the forms, not the hues.
- Rejected: more hues per month (D121's harmony); a different paper per series (the owner chose close steps).
- Amends: D121 (the cap and the stocks' lightness).
- Revisit if: the owner judges the October grid on the phone in both themes; the contact sheet (`npm run covers:sheet`) is the review aid.

## D172: a settings page keeps the store's last answer on the device

- Date: 2026-10-24 (the owner: "make sure our app is professional industry grade", after asking how Spotify's settings feel instant)
- Decision: `configStoreRead.ts` keeps the last answer `GET /api/config` gave in `localStorage` (`dispatch:store-read`, one build's edits). A page asks the store as before; when the store has not answered within 300 ms the page lays the device's copy over itself and the read goes on, so a late answer serves the next read and replaces the copy. A failed read leaves the copy standing. A copy from another build is ignored, as a read from another build is.
- Why: with the store on, the built copy of the settings is a run old by design, so a store that is slow (Neon's free tier sleeps) or unreachable (a phone offline) showed old settings as if current, for up to 2.5 s or for good. The big apps keep the user's data on the device and refresh it from the network; the page then shows what this device last knew, at once, and the store corrects it. Nothing changes for the engine or the write path.
- Rejected: reading the store on the server and rendering settings at request time (slower pages, Neon's cold start on every load, and the site stops being static); Vercel Edge Config as a cache (another store to write on every save); showing the copy first on every load and re-laying the store's answer later (a control can change under a hand that is already on it).
- Revisit if: the copy is seen to hide a cross-device edit for a whole visit (the store answered late and the page was never re-read); then re-lay the late answer when no edit is pending.

## D173: content is data read through one repository; builds ship code only

- Date: 2026-10-24 (the owner: "does moving to neon database stop deployments on every settings change and podcast generation?"; then "I want the app to access everything from the database as content repository always, the builds only happen for app improvements and feature builds. the same with settings, sources, etc."; "keep it smooth, the app is light so far - no need for too much of optimization. but keep the deployments lower, content is fetched from database, this needs to be scaled for the future when we have many more users.")
- Decision: briefings, episodes and the run state live in Vercel Blob (the content store), mirrored from git by `dispatch content sync`; settings and sources stay in Neon (D149). Every content read goes through one repository module; pages that show content render on request through it with a short shared cache. Git is the backup; once the pages read the store, data commits stop deploying. [The plan](design/data-off-the-deploy-path.md) orders it in five steps.
- Why: every data commit was a build and a deploy: minutes before new content shows, and since D146 a "New version available" on every open screen. Blob is served from the CDN with no cold start; Neon's free tier sleeps, so it does not hold what every page reads. Rendering on request keeps the Astro components and the content in the HTML, where client-side shells would rewrite every page as a script. The repository seam lets content move to Postgres, one row per user, when there are many users, without touching a page.
- Rejected: Neon for content today (cold starts on page loads; it is the many-users store); ISR with on-demand refresh (more moving parts than one user needs, and it cannot cache a personal page); client-side shells that fetch content (a rewrite of every page, and a loading flash); a monthly git copy of episodes (git stays the per-commit backup instead).
- Revisit if: a second user's content arrives (the repository moves to Postgres), or the step 2 proof shows cold starts the shared cache does not hide.

## D175: `main` is protected by a ruleset, with the Actions app as the only bypass

- Date: 2026-10-24 (the owner: "Rulesets for main branch to have industry grade checks and quality checks to make sure main branch is always stable")
- Decision: a GitHub ruleset on the default branch, kept in `.github/rulesets/main.json` (runbook 12): no deletion, no force push, linear history, every change through a pull request with its threads resolved and squash as the only merge method, the `check` and `browser` jobs required and the branch up to date with `main` at merge time. The GitHub Actions app bypasses it always, so the engine's own commits (digests, narration, episodes, config) keep landing; no person does.
- Why: on 2026-10-24 two PRs that each passed CI alone put `main` over the learnings budget, so `docsCheck` failed on `main` itself; and nothing stopped a direct push or a force push. Strict required checks test the merged state; the ruleset turns D143's "review before every merge" and D148's "CI on pull requests" from habit into a rule the host enforces.
- Cost: each merge first updates its branch and waits for CI again (about 4 minutes, 15 with the browser suites); with several PRs open they merge one at a time. Rulesets on a private repository need GitHub Pro.
- Rejected: requiring the `review` check (Dependabot's PRs merge without the label, and the review runs only when the label is added); required approvals (one owner cannot approve their own PR); signed commits (the engine's are unsigned); a person as a bypass actor (then the rule is a habit again).
- Revisit if: a workflow starts pushing with a token that is not the Actions app's (it would need its own bypass), or merges queue up behind the strict check for longer than they save.

## D176: the podcast structure, phase 1: the defaults are today's, counts are optional

- Date: 2026-10-24 (the owner: "kick off multiple agents to get them all implemented")
- Decision: `config/structure.json` (D170) is read by curate, the digest and the Catch up planner. A kind the file leaves out runs the code path it ran before, so nothing changes until the owner saves a kind. Daily and weekly start with no rundown and no close, since their narration never had either; Catch up starts with both. A block's count is optional, and absent means the engine's own allowance (three Top picks, five for a section with its own allowance), so the defaults copy no constant into the file. A structure holds 32 blocks, not twelve: each custom and general topic brings a section. A stored kind leaves out a section it does not list; a topic made later is added to every stored kind (`topic.upsert`), and `topic.scope` putting a topic in adds its block, while `skip_topics` still takes one out. A digest whose built-in sections read out of their fixed order keeps a `section_titles` snapshot, so the page and the narration read the owner's order. In Catch up a section the form picks still airs when the structure does not name it, after the named ones; Top picks, Trending and release news air only with their block.
- Daily and weekly (the owner chose, 2026-10-24: "Rundown in code, rest Catch up only"): a rundown block makes the narration name the first stories by their chapters after the opening ("Coming up: ..."), its count kept in the digest's `rundown` so a later edit never changes old audio. A close or a custom block is refused for those kinds; Catch up takes both.
- Why: the design assumed every episode is written by the script writer; only Catch up is. Daily and weekly narration is code around stories written one by one, so a close and a custom brief have no writer there.
- Revisit if: the owner wants custom blocks in daily or weekly, which needs a model call per briefing.

## D177: on a phone the Costs chart or table switch sits beside the figure

- Date: 2026-10-24
- Decision: from 40rem the switch stays at the end of the filter row (D169); below it, it sits at the end of the answer's first line, level with "Estimated spend", and the chips keep their row. It follows the answer in the reading order, just before the panels it switches.
- Why: at 390px the two pill chips and the switch do not fit one row, so the switch wrapped to a row of its own, 72px of nothing above the figure (screenshot, 2026-10-24). The owner chose the figure's line over the empty row.
- Rejected: the empty row it had; narrower chips (the pills are D167's one shape).
- Amends: D169's Costs bullet, on a phone only.
- Revisit if: the chips and the switch fit one row on a phone.

## D178: no island loads with the page; the islands wake when needed

- Date: 2026-10-24 (the owner asked for every accepted idea to be built, cut 1 of [first-load-js.md](engineering/first-load-js.md) among them, parked since 2026-10-14)
- Decision: the player and sheets islands are `client:wake` (`lib/wakeDirective.ts`): they hydrate on `dispatch:wake`, which `scripts/islandWake.ts` sends when something starts playing (the bar shows), a sheet's control is pressed (the press is kept and opens the sheet), a toast is sent, a Generate run is remembered from before a reload, or the browser is idle after the first pointer, key or wheel input. The player runtime (the store, the reader's Play controls, Media Session, sounds) starts from the layout's script at load, without React. On wake, `islandWake.ts` imports the renderer and both islands itself, so Vite preloads each graph at once, on the pages rendered on request (D173) too; `checkBundle` counts them apart ("more on wake"), not as first load.
- Why: React and the two islands were 73 KB of every page's 110, and nothing on screen needs them until a track starts: the bar is hidden before then, and the Play controls are answered by the runtime.
- Cost: a Play that is the first input of a cold visit shows the bar about 0.6 s after the press on a throttled phone (65 ms before), most of it React compiling and hydrating; the audio starts at once as before. A sheet's control pressed before the wake opens its sheet after that round trip. The browser tests wake the islands before they wait for hydration (`hydrated` in `e2e/fixtures.ts`, `PlayerPage.open`).
- Rejected: the islands as Astro markup and a vanilla toaster (the doc's first sketch; the directive keeps the islands, `transition:persist` and SSR as they were); hydrating at idle without an input (the bytes and the 100 ms hydration task come back on every visit).
- Amends: D112 (the first load is about 38 KB on every page, so the 130 KB budget of D141 is far off).
- Revisit if: the bar is seen late after a first Play on a phone, or a press is seen lost before the wake.

## D180: the episode eval runs only when asked, and on a pull request judges only the branch's rewrites

- Date: 2026-10-24 (the owner: "generating a podcast script shouldnt be this expensive as today", "especially anthropic api costs")
- Decision: `episode-eval.yml` runs when a pull request gets the `eval` label (re-add it to run again) or by hand, never on a push. On a pull request it judges only the four rewritten episodes (main's prompt and the branch's, daily and weekly); a manual run judges the fixtures and every replay as before.
- Why: it ran on every push to a writer, judge or `loop/` change, 12 times on 2026-10-24 (the rename and structure PRs), and each run made about 40 Sonnet calls on the API key: four replay rewrites and two scores of about 20 episodes, 16 of them fixtures and replays a pull request never changes. Estimated at $4 to $6 a run, in no cost ledger, against about $1.10 for a briefing run.
- Amends: D148's "`episode-eval.yml` runs only for the writer, the judges, the voice and `loop/`".
- Revisit if: a writer or voice change merges without an eval and an episode gets worse, or the eval's spend is recorded and found small.

## D179: Every name says Singularity; saved state moves once

- Date: 2026-10-24 (the owner: "I'd like to move everything that's named dispatch to singularity", then chose the full rename with migration)
- Decision: this replaces D30. The packages are `@singularity/*`, the CLI is `npm run singularity`, and the agents, reports, User-Agent, element ids, page events, storage keys (`singularity:*`), service worker caches, token extensions, workflow groups, `SINGULARITY_*` variables and docs say Singularity. Saved state moves once: a head script (`storageRename.js`) renames every `dispatch:*` key before anything reads it, and downloaded episodes are copied from `dispatch-audio-v1` by the page and moved by the new worker. Old variable names are still read: `adoptOldNames` in the engine and `secrets:push`, `vars.SINGULARITY_X || vars.DISPATCH_X` in workflows, and the config store switch on the site. The site's token is `GITHUB_SINGULARITY_TOKEN` (the owner renamed it first; `GITHUB_DISPATCH_TOKEN` is still read). `workflow_dispatch` and the verb stay. Past decisions and `docs/history/` keep the old name.
- Why: D30 kept the old names to protect saved preferences, positions and downloads; a one-time move protects them as well, and reading both variable names means no run fails before the owner renames a setting.
- Rejected: keeping D30 (the owner wants one name); a rename without the move (wipes what a phone saved).
- Revisit when: the owner has renamed the GitHub and Vercel variables and every device has opened the site once; then the old-name readers, `storageRename.js` and the audio move can go.

## D181: Claude writes the scripts; Jev judges, Gemini backs it up

- Date: 2026-10-24 (the owner: "use jev mostly and use gemini models as backup. use anthropic models mostly for script generation")
- Decision: in `config/models.json` Claude Haiku leaves every chain: judge, taste fit and source format are Jev then Gemini Flash Lite, grounding Jev then Gemini Flash, fact extraction Gemini Flash Lite then Flash. Sonnet keeps the story writer, its rewrites and the podcast script. The story writer sends no effort (the model's default) and its rewrites medium, in place of #187's medium and low.
- Why: since #187 (2026-10-22) a daily run made 43 to 49 Claude calls, against 19 to 22 before, about 27 of them voice rewrites of one field each, every one resending the article (about 5k tokens). Weaker first drafts were the likely cause; a rewrite costs more than the thinking the lower effort saved.
- Later the same day: a voice rewrite sends the first 4,000 characters of its source, not up to 10,000 (`rewriteOnce.ts`); grounding repairs still send the whole text.
- Revisit if: the next runs' `lost_reasons` still show more than about 8 voice rewrites, when the per-field rewrites become one call per story.

## D182: each block's prompt is the owner's to replace, per kind

- Date: 2026-10-24 (the owner: "the block level model instructions must be open for editing"; on the cards, "The full prompt per block" and "Separate per kind")
- Decision: `config/structure.json` keeps `prompts` by kind and block key (`section:<id>` or the block type), apart from the blocks, set one at a time by `structure.prompt` (null puts back the built-in). The built-in prompts live in `packages/core/src/blockPrompts.ts`, the strings the engine sends, so the page shows exactly what the writer is told. Daily and weekly: a story block's prompt replaces the fields and fact rules for the stories of that section (they are batched apart); the voice from `config/voice.md`, the source handling and the reply's JSON shape stay in code, and the linter, numbers and grounding checks still run. The hello, rundown and sign-off are spoken by code there, so they take no prompt. Catch up: every block but an owner block (whose brief is its prompt) takes one, delimited in the message as the owner's text; a prompt set while the kind is on its defaults runs the defaults as a structure.
- Why: one request per prompt keeps a reorder small and a 6000-character prompt inside the settings request limit; a prompt kept apart survives a block's removal and Undo.
- Revisit if: login (Google, in progress) lands, since until then anyone with the URL can edit a prompt (D160); or a prompt edit is wanted for the voice itself.

## D183: The Costs page counts what Anthropic billed, not only what the app recorded

- Date: 2026-10-24 (the owner: "show all costs in the cost page including evals and others to get accurate cost")
- Decision: with `ANTHROPIC_ADMIN_KEY` set on Vercel, `/api/costs` reads Anthropic's cost report (Admin API, by UTC day, cached 10 minutes) and adds, per day, the billed total less the ledger's Anthropic records as one "Outside the app" record (kind `outside_app`, no run). Without the key the page says spend outside the app is not counted. Other providers stay metered.
- Why: the ledger sees only the app's own calls. The episode eval (estimated at $4 to $6 a run, 12 runs on 24 Oct) and local scripts reach the bill but never the page, so the page read far below the bill. The bill is the only source that catches spend nobody thought to meter.
- Revisit if: another project shares the Anthropic organization (the report covers the whole organization, so its spend would land in "Outside the app"), or Gemini spend grows enough to need its billing export.

## D184: Each podcast looks back as far as its settings page says

- Date: 2026-10-25 (the owner, on the Structure view's per-block "Newer than": "this should be gone if we are handling globally for daily and weekly setting")
- Decision: Daily and Weekly each have a Look back row in Episode: since the last episode (the default, no field written) or 12 hours, 1, 2, 3 or 7 days, stored as `lookback_hours` at the top of `config/schedule.json` and in `weekly`. Selection drops a story dated (or, undated, fetched) before the lookback as `too_old`. Catch up and briefings run by hand ignore it.
- Why: the fetch window (since the last fetch, at most 7 days) decides what is read; the lookback only narrows what airs, so it cannot reach stories the engine never fetched, and an unset field keeps every run as it was.
- Revisit if: a lookback longer than the fetch window is wanted, which needs the fetch to read further back.

## D185: a config edit made in the repo reaches the store; one made in both stops the run

- Date: 2026-10-25 (the 06:52 UTC weekly: #263 changed `config/queries.json` after the store was seeded, the gate copied the store's older row over it, the commit stage refused the copy and the failure record committed the old queries to `main`)
- Decision: a run or podcast commit whose gate finished copying the store ends with the trailer `Config-Store: snapshot` (`SNAPSHOT_TRAILER`). When a stored row differs from its file, `hydrateConfig` compares both with the file at the newest such commit (`git/configBase.ts`; before the first, the newest run commit that changed a config file). Changed in the repo only: the file goes to the store on the version read and stays. Changed in both: the gate stops before any spend (`ConfigConflict`), naming the file. Changed in the store only, or no base found: the row is copied, as before. The commit stage's early check allows what the guard allows (`commandAllowlist`).
- Why: a pull request, `config.yml` or a hand edit can change the committed files while the app edits the store, and the old rule (the store always wins) undid the repo edit without a word. A base tells the two apart without a new column or file; stopping on both edits costs a run, never an edit.
- Revisit if: a conflict stop happens often enough to want a merge of the two JSON documents.

## D186: every control is a pill, text fields and a card's buttons too

- Date: 2026-10-24 (the owner, on the edit source panel: "all the ui elements as much as possible should have fully rounded corners to be consistent")
- Decision: `--field-radius` is the pill, so every one-line text field and every form select that follows it (the Add and edit source panels, Blocked sources, the sheets) is round like the buttons, chips and selects beside it. A multi-line field takes `--field-radius-multiline`, 24px, half a field's height, so its corners draw the one-line field's arc. A button in a card is a pill (the concentric `.card-group .btn` override goes), the floating button is a pill (a circle folded) (owner, 2026-10-24: "only to the components that make sense"). Page row tiles are #295's (`--row-tile-radius`).
- Why: D167 left text fields at 8px and a card's buttons concentric, so an 8px Name field stood over pill selects in one panel; the owner read it as two languages.
- Rejected: a pill textarea (it clips the first and last lines' corners); rounding containers (cards, sheets, menus, toasts, banners, covers), which are surfaces, not controls.
- Kept for the owner's call: the Create Title (a filled field with round top corners over its D54 bottom line), menu and list option tiles inside a popup or sheet, checkbox squares (round reads as a radio), the mini player's open target, the emoji grid's cells (a wide cell would hover as a pill).
- Amends: D167's text-field and card-button rules.
- Revisit if: a pill field's text or placeholder reads cramped at its start.

## D187: a glyph that ends a row lands its ink on the row's end, not its box

- Date: 2026-10-25 (the owner, on Blocked sources: "so many ui elements that are not aligned optically on both sides of the screen - fix them all and check if other screens also have this to fix it at the source of design system")
- Decision: words and bare glyphs align by their ink; a filled or outlined control (a field, a select chip, a segmented track, the sample disc) aligns by its edge. Each Phosphor glyph's ink margin is measured once (`getBBox` on its path) and set as `--ink-end` on the glyph and on what holds it (`buttons.css`; `Icon.astro` writes `data-icon`). A row's chevron, a value select's chevron, a settings multi-select's chevron, Create's More options chevron, and `.icon-btn-end` (the Blocked row's cross, a topic card's More) pull out by it; the voice sample's disc meets the row's end. Measured at 390 and 1280px on Settings, Daily, Weekly, Voice, Blocked sources and a topic page: every row-end glyph's ink 24px in from the card's edge, where the words end (before: 24 to 39.5px, the select chevrons 3px and the cross 6.5px short).
- Why: the chevron's 0.28 pull fitted one glyph only; a chevron down, a cross and the More dots sit further inside their boxes, so each ended a few pixels short of the line the words make.
- Rejected: pulling the More dots on Today's story rows and hero, and the Library's view buttons, to the 16px page edge (their 44px targets would leave the screen); moving the topic page's source list, which lines up with its search field's glyph (owner, 2026-10-23).
- Revisit if: a glyph outside the table ends a row (add its measured margin).

## D188: a list a script redraws takes its sheet header and icons from the same source as the pages

- Date: 2026-10-25 (the design-system audit; the owner: "I see too many deviations - especially in the structure tab").
- Decision: `apps/web/src/lib/sheetHead.ts` holds the markup of a sheet's header row and of an icon; `SheetHeader.astro` renders it, and any list a script rebuilds (`structureView.ts`) calls it. A menu a script builds is `MenuSheet.astro`'s menu: the header, and each item with its glyph at the start. Every glyph carries `data-icon`, so D187's ink margins reach it. A row that cannot act says `data-quiet` (settings.css) rather than a page recolouring `.settings-label`; tabs in a card are `.tabs-in-card`; a multi-line field's ceiling is `--field-max-height-multiline`.
- Why: the Structure view copied the menu sheet by hand, lost the item icons and the D187 alignment, and placed its glyphs with negative margins; each copy is a place the system drifts.
- Rejected: server-rendering the menus once per row (the list is rebuilt after every edit, so the client needs the markup too).
- Revisit if: a second script-drawn list appears (then `MenuSheet.astro` should also render through `sheetHead.ts`).

## D189: the design catalogue is a route of the site, not a tool

- Date: 2026-10-25 (the owner: "I need a simple storybook kinda tool/page to visualize all the tokens, typography, colors, ui components"; and "shouldn't we have a different ui repo?").
- Decision: `/design` (`apps/web/src/pages/design/[...slug].astro`) lists the tokens from `tokens.json`, the type roles, the colour roles as live swatches, every glyph, and each shared component drawn by its own class, with the usage comment over that class read from its stylesheet at build time (`lib/designCatalogue.ts`). It is built in dev and in the fixture build only (no static path otherwise), sits in the browser suites' page list, and no separate UI repository or package is made.
- Why: one consumer and one person; a catalogue rendered by the CSS the app ships cannot drift from it, while zeroheight, Supernova or a Storybook (the community Astro framework is the only one that renders `.astro`) are a second source of truth kept by hand. A separate repository buys versioning and publishing work for no second consumer.
- Rejected: Storybook with `@storybook-astro/framework` (a second build and dev server, a story per component); zeroheight and Supernova (Figma sync and team governance this project does not have); Backlight (shut down 2025-06-01).
- Revisit if: a second app consumes the styles (then lift them into a workspace package under `packages/`), or the catalogue needs knobs and isolation per state (then try Storybook on a branch first).


## D190: votes tune topic weights and source scores through a bounded, decaying adjustment

- Amends: D108, D118.
- Amended by D194: the topic part (weight adjustment, the "Adjusted" mark) is removed; source score adjustment stays.

- Date: 2026-10-25 (the owner: "make sure topics evolve as models generate new podcasts. This should be refined and intelligently managed").
- Decision: a story vote moves an `auto_adjust` on its topic and its source in the owner's profile (`packages/core/src/autoAdjust.ts`, applied in `profile/autoAdjust.ts` by the same `profile.vote` op that stores the vote): 0.02 a vote, within plus or minus 0.2, halving over 30 days without votes, sources at a quarter of the step. Scoring reads the owner's weight plus the decayed adjustment (Off stays Off); the weight itself is never written. A weight row with a live adjustment says "Adjusted" (`lib/topicAdjust.ts`, WeightRow).
- Why: D108 kept votes out of weights so a bad week could not rewrite the owner's choices; a separate, bounded, decaying term keeps that guarantee and still lets the mix follow what the owner likes. The constants are first guesses, named in one place for tuning against real data.
- Rejected: writing the adjustment into the weight (the owner's setting would drift under them); a separate learn step (the vote op already runs on every batch and commits through the config store, D185).
- Revisit if: two weeks of votes show the step or the cap moving a topic further than the owner meant, or Jev's taste answer (D118) and this term pull apart.

## D191: one podcast structure, chosen by listener profile, sized to the episode's length

- Date: 2026-10-25 (the owner: "have one global structure of the podcast instead of daily, weekly, catch up"; "the current podcast structure is very focused on design engineers. If you can add a profile selector in preferences settings page").
- Decision: `config/structure.json` holds one block list for every podcast type, `{version: 1, profile, blocks, prompts}`; a Profile select on `/settings/preferences` (Artist, Designer, Founder, General, Journalist, Product Manager, Researcher, Software Engineer, Student, then Custom) loads a preset list, and any edit turns the profile Custom and keeps the list. The engine applies the one structure and scales each block's count by the episode's length over ten minutes (`score/sectionPlan.ts`). Daily and Weekly show the profile as a disabled select with "Set once for every podcast in Preferences" linking there. The old per-kind shape reads as Custom (the daily list, else the first present) and the next save rewrites it.
- Why: three lists said the same thing three times and read as a design-engineering product; a profile names the listener, and the length already says how much a block holds.
- Rejected: a profile per podcast type (the owner asked for one global structure); hiding the Catch up frame rows (the owner keeps Hello and Sign-off listed for their prompts, D170).
- Revisit if: a type needs a block the others must not have (then a per-type override on top of the profile, not a second list).

## D192: CodeRabbit is the default PR review agent

- Date: 2026-10-25 (the owner: "I have installed code rabbit on github, where do I change to use it as default review agent?").
- Decision: CodeRabbit replaces `claude-code-review.yml` as the automated review agent on GitHub. `.coderabbit.yaml` defines repository conventions (no em dashes, 8pt grid, shared design tokens, TypeScript 6.x, snake_case data keys, and excludes `Digests/`, `Podcasts/`, and `state/`). Reviews run automatically on pull requests without requiring label triggers or Actions runner minutes; a human merges once findings are resolved. Local `/code-review` remains available for pre-PR checks.
- Why: CodeRabbit reviews incrementally on each commit, supports threaded conversation, and avoids the single-run and re-label limits of the Claude action (learning 2026-10-11).
- Rejected: keeping `claude-code-review.yml` in parallel (duplicate comments and Anthropic token spend); relying on manual review only.
- Amends: D143.

## D193: a desktop dock chevron beside volume; a chosen speed lasts one episode

- Date: 2026-10-25 (the owner asked for a way to open the player from the desktop bar, and for speed to stop sticking).
- Decision: from 64rem the dock holds a chevron `.icon-btn` right of volume that expands and collapses the player. D102 stands for the rest: no chevron on the bar below 64rem (the phone bar opens by press and drag), and the keyboard-focus chevron on the open desktop player is unchanged. A speed chosen in the player applies to that episode only; the next starts at Preferences, Default playback speed. The same speed left in three episodes, or an episode ending off the default, offers it once per speed as the new default (`core/speedDefault.ts`); an episode counts at the speed it was left at, not the slider steps passed.
- Why: the desktop bar had no visible way to the full player, and a remembered speed carried into episodes where it did not fit.
- Rejected: a chevron on the phone bar (D102, the bar is the target); remembering the last speed (the old behaviour); counting every slider step.
- Amends: D102, D126.

## D195: settings subpages show a Settings breadcrumb

- Supersedes: the no-breadcrumbs clause of D129 (the rest of D129 stands).
- Context changed: D129 dropped breadcrumbs as repeating the title and app bar; the owner found a subpage gave no quick way up to the Settings index.
- Date: 2026-10-25 (the owner's ask).
- Decision: each settings subpage has a small "Settings /" line above its title (`.settings-crumb`), a `.text-link` with a 44px target.
- Why: one tap up beats the app bar's back, which can leave settings.

## D194: topic weight is removed

- Date: 2026-10-26 (implementation plan v2, section 5, D-f).
- Context changed: topic weights were removed in implementation plan v2, so D190's per-topic vote adjustments no longer have an owner-set weight to adjust.
- Decision: a topic has no weight. Scoring uses `NORMAL_TASTE` (0.7) for categories and custom topics, 1 for general and Trending topics, and 0.85 for Design; the weight sliders, `weights.set`, the learn patch `weight_deltas`, the vote-driven topic adjustment and the "Adjusted" mark are gone. Old configs that carry `weights`, `topic.weight` or `auto_adjust.topics` parse and the fields are stripped. Vote-driven source scores stay.
- Why: fixed taste values remove per-topic tuning while preserving the shipped app and general topics' scoring strengths.
- Supersedes: D190 for topics.

## D196: a save refreshes the device's copy of the store and confirms

- Date: 2026-10-26 (plan 20, criterion 7).
- Decision: a save that went through asks the store again at once (`afterOwnSave`, with its own query past the edge's second) and the device's copy takes the answer, so the device's next page, and another tab's, shows the edit. A store answer whose `written_at` is this device's own newest write (`noteOwnWrite`, #329) is never offered as "changed on another device". The copy is never overwritten by an older answer (a read that began before the save and resolves after it). The save says "Settings saved".
- Why: D172's copy left a saved edit a write behind on the device, so another tab showed the old setting until a reload.
- Amends: D172.

## D197: a scheduled briefing is generated ahead and published at its hour

- Date: 2026-10-26 (#318, #349).
- Decision: the run for a scheduled briefing starts up to two hours before its hour, generates, and commits at `publish_at`, three minutes (`DEPLOY_LEAD_MS`) before the hour in Stockholm, so the deploy lands at 07:00. The cron's early slot keeps its own local date, and the store's timeout no longer counts the module load.
- Why: a run that starts at the hour published a quarter of an hour late, and a slow cold start could start it at the wrong hour.
- Revisit if: a run's work outgrows the lead.
- Amends: D61.

## D198: narration ships as Opus in MP4 with the MP3 kept as fallback

- Date: 2026-10-26 (#339, #357, #361, #381).
- Decision: a briefing's narration and an episode's turns also publish one Opus-in-MP4 file (`m4a_url`, mono 32 kbps); the player picks it per browser and falls back to the MP3 on an error or a stall. WebM is not published. A failed transcode skips the Opus copy and the MP3 plays alone. The audio, podcast and ci workflows install ffmpeg (the runner image has no libopus). An episode's turn offsets are measured by decoding, not by ffprobe's duration, which counts MP3 padding on ffmpeg 6.
- Why: about a third of the bytes for speech at the same quality.
- Revisit if: an iPhone fails to play the Opus file; the backfilled MP3s stay until the owner plays one there.

## D199: content changes show without a deploy; deletes are tombstones

- Date: 2026-10-26 (#332, #346, #359; plan section 20).
- Decision: pages rendered on request read the content store, which a sync fills from git on every push to main that changes `Digests/` or `Podcasts/`. A delete writes a tombstone the store's readers honour before the manifest catches up. Audio and cover addresses carry a version (a hash, `?v=<generated_at>`), so a regenerated item never serves the old file, and the service worker drops a removed episode's saved page and audio.
- Why: a create, delete or regenerate must show on the site without a redeploy.
- Amends: D173.

## D200: a source opts in to the Alexandria read through the config store

- Date: 2026-10-27 (#352, #360).
- Decision: `source.update` takes `fetch_via` (`alexandria:anthropic-com`, for a Firecrawl source on anthropic.com only, or null to clear), so the owner switches a source's read without a commit. `anthropic-blog` reads through `alexandria:anthropic-com` from 2026-10-27, as a pilot.
- Why: a provider gives dated posts where a scrape gives a page.
- Revisit if: the pilot's run log shows no dated posts; revert with `fetch_via: null`.

## D201: the write routes stay open until OAuth

- Date: 2026-10-27 (#370 closed by the owner).
- Decision: no interim auth on the write routes. The URL is shared with friends only; any same-origin request can change config, and friends share the owner's one config. OAuth replaces this, and Analytics and Costs become admin-only then.
- Why: an interim secret would be thrown away by OAuth and adds a login step for friends.
- Revisit if: the URL reaches anyone beyond friends, or a config change is made that the owner did not make.
- Amends: D160.

## D202: a deploy loads itself; the Reload toast is gone

- Date: 2026-10-27 (the owner: "there's never a reason to refresh or give the snack bar to reload")
- Decision: a page behind `/build.json` reloads itself at the first moment a reload costs nothing. The page asks `/build.json` on load, on each return to the front, and every 10 minutes while in front (at most once a minute), against the build its bundle loaded with. That name is read once in `app.ts` and passed in: the head meta is swapped by every move inside the app, so the old check read the new page's name and never saw a bundle left behind. When the site is newer the page reloads if no audio plays or buffers, no dialog, sheet or toast (an Undo) is open, and no text field has focus or holds what the reader typed (a field the page filled in does not count); else it tries again every 5 s, on each move inside the app, and when the page is hidden. One build is loaded for at most twice per tab (`singularity:applied-build` in sessionStorage), so a reload that still shows the old build cannot loop. The "New version available" toast is removed.
- Why: a prompt asks the reader to do what the app can do itself, and a dismissed or unseen one leaves the old bundle running. D146 dropped the automatic reload because each round found one more thing it could throw away; those are now the guard list above, as one tested function (`canReloadNow`), with the wait as the fallback instead of a prompt.
- Amends: D146 (the offer becomes an automatic reload).
- Revisit if: a reload ever loses a reader's work (add its guard to `canReloadNow` with a test), or a page keeps a state the guards cannot see.

## D203: the lane is free while a briefing waits for its publish time

- Date: 2026-10-28 (the owner chose plan A after "Waiting for a slot"; Anthropic batch for the scheduled writer, an hour early with a fallback 15 minutes before publish; a story store by topic, for generation only).
- Status: planned, nothing built.
- Decision: `run.yml` holds the one `singularity` lane for the whole wait of a briefing generated ahead (up to 135 minutes, `MAX_HOLD_MS`), so a Regenerate or Catch up in that window queues (2026-10-27: run 461 behind run 459, 97 minutes). The plan, in order, one PR each: (1) the commit stage fetches and fast-forwards to `origin/main` after the hold, before it reads `seen`, `last-run` and the judgments, so it builds on what a push meanwhile committed (it read the checkout from job start; a config push is the same class as #303); (2) `run.yml` splits into a generate job (Gate to Validate, group `singularity`) that hands `.cache/run/` over as an artifact, a hold job with no group that only waits, and a publish job (Commit, group `singularity-publish`, seconds long), so an on-demand run takes the lane at once and publishes at once; (3) the scheduled writer sends its first pass to Anthropic's batch API inside the hold: submit about 60 minutes ahead, collect what finished by 15 minutes before publish and write the rest synchronously; Regenerate and Catch up stay synchronous; (4) cost is held at the run level, not per story: one generous reply ceiling per writer request instead of 800 tokens a story, the run's token budget and a spend line in USD as the backstop; (5) a 30-day store of stories by topic, filled by an ingest job, read by generation only.
- Why: the wait is the hold, not the work (an on-demand daily with no hold took 3 m 20 s, queued 2 s). The hold is already idle time, so a batch fits in it without D135's submit-and-resume split.
- Rejected: an own group for on-demand runs (two commits would both rewrite `seen`, `last-run` and `costs-*.json`, and `commit.ts` aborts on a rebase conflict, never forces); a 30-minute job timeout (ends the hold, D197).
- Open before step 4: the reply ceiling is not what costs money. `THINKING_HEADROOM` (8,000) already sits on top of it, a tight ceiling once cut the writer's JSON off mid-object, and `TokenBudget.check` counts the ceiling in its estimate, so raising it alone trips the 400,000-token run budget sooner (the 2026-10-25 weekly wrote 403,000). `story_writer` sets no `effort`, so its thinking is billed as output. Measure stories written against stories aired, and the writer at lower effort on `loop/`'s replay, before the batch.
- Amends: D197 (the hold stays; it no longer holds the lane). Builds on: D135's revisit condition (an earlier start is accepted).
- Revisit if: a held publish job is replaced while pending (GitHub keeps one pending run per group), or a batch misses 15 minutes before publish on more than one run in ten.
