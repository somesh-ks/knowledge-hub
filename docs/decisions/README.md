# Decisions

Each entry records what was decided, why, and what was rejected. Add a new entry at the end of the file that fits it, with the next number, and a row to the Index. Do not rewrite an old entry: if a decision changes, add a new entry that supersedes it and set the old status to "Superseded by Dn".

From D124 on, an entry that supersedes another adds `- Context changed:` (one sentence: what made the old decision wrong), and an entry whose reason can expire (a provider, a price, a budget, an unmeasured guess) adds `- Revisit if:` (the evidence that would reopen it). Current behaviour lives in [specs/](../specs/README.md).

## Files

Entries live in one file per area, in number order. Find one with `grep -l "^## D123:" docs/decisions/*.md`. Find a row with `grep -rn "keyword" docs/decisions/`, which also searches the archive.

- [foundations.md](foundations.md): Stack, repository, hosting, delivery, CI, pull requests, the docs and the tests.
- [engine.md](engine.md): The pipeline that writes a briefing: sources, judge, writer, models, scheduling, costs, run guards.
- [narration.md](narration.md): Audio: voices, hosts, transcripts and word marks, pre-narration, Opus and the audio job.
- [episodes.md](episodes.md): What an episode or briefing is: kinds and structure, length, regenerate, Catch up, runs and the run card.
- [design-system.md](design-system.md): How the reader looks and feels: tokens, type, controls, covers, sounds, motion, first-load budget.
- [player-and-library.md](player-and-library.md): The player, queue, transcript, Library, reading pages, gestures, offline pages.
- [settings-and-create.md](settings-and-create.md): Settings (topics, sources, models, schedule, saving) and the Create form.
- [store-and-ops.md](store-and-ops.md): Where data lives (Postgres, Blob, git), config, health, analytics, deploys, access and privacy.
- [index-archive.md](index-archive.md): The Index rows for D1 to D150. When the Index below passes 30,000 bytes, move its lowest-numbered rows there (the cap is 40,000; `node scripts/docsCheck.mjs` counts only the live Index toward it and reads both files for the consistency checks).

## Index

Status words: `active` (holds), `amends Dn` or `supersedes Dn` (holds, and changes or retires Dn), `superseded by Dn` and `partly superseded by Dn` (retired, in whole or in part). Anything after a semicolon is a note.

| ID | Decision | Status |
| :--- | :--- | :--- |
| D151 | CI fails on a high advisory | active |
| D152 | Full-screen phone sheets show Close | amends D144 |
| D153 | Engagement and sharing | active |
| D154 | Simple Analytics and a Privacy page | active |
| D155 | Software Engineering topic | amends D69 |
| D156 | Field Vitals in Neon | amends D147 |
| D157 | Health: store, drift, warnings | amends D146 |
| D158 | Client faults | amends D157 |
| D159 | Deploy alerts | amends D157 |
| D160 | No passphrase | active |
| D161 | Publisher above the headline | amends D31 |
| D165 | Captions via Firecrawl | amends D138 |
| D166 | Firecrawl 100 a week | amends D42; limits superseded by D222 |
| D167 | One shape per control | amends D72 |
| D168 | Catch up, bolt, swipe toasts | amends D52 |
| D169 | Queue gestures | amends D126 |
| D170 | Podcast structure | built (D176, D182, D191); phase 3 closed by D241 |
| D171 | Richer covers | amends D121 |
| D172 | Store reads keep a copy | amends D149 |
| D173 | Content is data in one repository; builds ship code only | active |
| D175 | Ruleset on `main` | amends D143 |
| D176 | Structure phase 1 | amends D170 |
| D177 | Phone Costs switch | amends D169 |
| D178 | No island at first load | amends D112 |
| D179 | Every name says Singularity; saved state moves once | active |
| D180 | Eval on label only | amends D148 |
| D181 | Claude writes only | active |
| D182 | Block prompts | active |
| D183 | Costs read the bill | active |
| D184 | Podcast lookback | superseded by D215 |
| D185 | Repo config to store | superseded by D296 |
| D186 | Every control is a pill | amends D167 |
| D187 | Glyphs align by ink | active |
| D188 | Script-drawn markup | active |
| D189 | Catalogue route | superseded by D224 |
| D190 | Votes tune weights | partly superseded by D194 for topics |
| D191 | Structure by profile | amends D170, D176 |
| D192 | CodeRabbit review agent | amends D143 |
| D193 | Dock chevron; one-episode speed | amends D102 |
| D194 | Topic weight removed | supersedes D190 |
| D195 | Breadcrumb | amends D129 |
| D196 | Save refreshes copy | amends D172 |
| D197 | Strict publish time | amends D61 |
| D198 | Opus narration, MP3 fallback | active |
| D199 | Live content and tombstones | amends D173 |
| D200 | `fetch_via` through the store | active |
| D201 | No write-route auth until OAuth | amends D160 |
| D202 | A deploy loads itself | amends D146 |
| D203 | Live Health page | active |
| D204 | Guards for a short or lost run, health metrics, one run card | active |
| D205 | Settings paint the kept copy at once | amends D172 |
| D206 | Stay on npm; pnpm spiked | active |
| D207 | A Regenerate asks for its own length | amends D204 |
| D208 | A list of generations, with Cancel | partly superseded by D231 (the list); amends D204 |
| D209 | Lane free in the hold | supersedes D135; amends D197; step 1 built (#399), steps 2 to 5 not built |
| D210 | Typed HTML builders | active |
| D211 | Copy says podcast, not briefing; code names keep briefing | active |
| D212 | Three regenerations per podcast, no daily limit | active |
| D213 | Two Catch ups a day that came out; failures do not count | active |
| D214 | A page's More menu offers Download and Add to queue like its Library row | active |
| D215 | Daily and Weekly have no Look back and no Format | supersedes D184 |
| D216 | Ticked general topics get a length-sized section | amends D170, D191 |
| D217 | `run.yml` names every run for what it is | amends D61, D213 |
| D218 | A block's count is a proportion; the length is the limit | amends D170 |
| D219 | A day's Catch ups are one album, chosen by a select before Play | active |
| D220 | Over-limit summaries and headlines are cut | active |
| D221 | Runs are logged to Neon with stage times and costs | active |
| D222 | Firecrawl: 300 a week, 60 a run | amends D166 |
| D223 | Firecrawl warns at 150 | superseded by D227 |
| D224 | Admin and style guide: own apps | supersedes D189 |
| D225 | A Haiku call shortens an over-limit headline | active |
| D226 | The guide lists only imported components | amends D224 |
| D227 | Firecrawl warns at 210 | supersedes D223 |
| D228 | A failed dry run records its spend | amends D223, D227 |
| D229 | Column centred; 12px label gap | active |
| D230 | Six spring tokens | active |
| D231 | The podcast queue; its runs stay for the day | supersedes D208's list |
| D232 | One cleaner turns scraped Markdown into prose | active |
| D233 | Ingest in shadow: free sources, Blob text | active |
| D234 | Vetted publishers pass the bar; topic rubric | active |
| D236 | Agent design lookup | active |
| D237 | Controls are components; design-system PRs apart | amends D189 |
| D238 | Ten-step OKLCH ramps | active |
| D239 | A travelling device is offered the new zone | amends D100 |
| D240 | Community votes outrank publisher status | amends D234 |
| D241 | No Weekly-only blocks | amends D170 |
| D242 | Starter-only Cancel | amends D201, D208 |
| D243 | One of each | active |
| D244 | YouTube views vs median = votes | active |
| D245 | system.json omits the file-use count | amends D236 |
| D246 | Catch up label; counts yield to slots | amends D218 |
| D247 | Deploy-count warning | active |
| D248 | Favorite creators trusted | active |
| D249 | Neon switches beat config files | active |
| D250 | Publishers renamed; no Reddit | amends D234, D240 |
| D251 | Ingest: one Blob object a run | amends D233 |
| D252 | Warning is orange | amends D238 |
| D253 | UI fixes start at the component | amends D237 |
| D254 | One PR per task; one rolling DS PR | amends D237 |
| D255 | Videos judged on transcripts | amends D248 |
| D256 | Covers drawn on request; failed-run stages in one Blob object | amends D173, D251 |
| D257 | Report routes need sign-in | amends D201, D224 |
| D258 | Cover version in its path | amends D256 |
| D259 | Saves kept before sending | amends D79, D91, D115, D249 |
| D262 | Sheet and Drawer split | amends D243 |
| D263 | Cover version in URL | superseded by D293 |
| D264 | Card long press | active |
| D265 | A select's phone list is the sheet | amends D167 |
| D266 | Icon, Badge, type | amends D243 |
| D267 | Card, Row | amends D243 |
| D268 | Styles: token overrides | amends D125 |
| D269 | Hour wheel | amends D265 |
| D270 | Experiments settle on a read | amends D249, D259 |
| D271 | Pill, cover travel | superseded by D280 |
| D272 | No persisted floating button | active |
| D273 | Haptic tokens | amends D52 |
| D274 | Icon weight token | amends D268 |
| D275 | Concentric picker | amends D167 |
| D276 | Voice list | amends D101 |
| D277 | Queue keeps played items; a tap plays in place | amends D126 |
| D278 | Softer light covers | amends D121 |
| D280 | Travel 300 ms | amends D271 |
| D281 | Downloads page, no cap | amends D127, D264 |
| D282 | A page falls back to the content its build holds when the store cannot answer | amends D173, D251 |
| D283 | Read-first is AGENTS.md and state.md (20 KB), the Index is grep-only, the ledger is split by surface; "replaces" retires the old row | active |
| D284 | Push pings | amends D11 |
| D285 | Switch can be mixed | active |
| D286 | Press ripple | |
| D287 | Column and list centred together | amends D229 |
| D288 | Library list: month labels, two columns | active |
| D289 | Every press is felt | amends D273 |
| D290 | Haptics are subtle and follow the sounds | amends D273, D289 |
| D291 | Phone Menu sheet: media-style head, visible Close, fill focus | amends D144, D275 |
| D293 | On-demand covers are served at /covers | supersedes D263; amends D256, D258 |
| D294 | Scheduled writer uses Message Batches | amends D209 (step 3 built, step 2 open); D135 ended |
| D295 | Playback audio session only while Sounds is on | amends D105 |
| D296 | Config store is the only home of owner config; examples in the repo | amends D149; supersedes D185 |
| D297 | A section may stand over its allowance only as far as the floor needs | amends D35 |
| D298 | Repository public, owner data moved out of git, history rewritten last | supersedes D9 |
| D299 | Offline settings edits stay on the device and send when back online | amends D79, D91, D259 |
| D302 | Pipeline plan Steps 3 to 7 and the Firecrawl monitor pilot are parked | active |
| D309 | Player ⋮ menu: actions, speed screen, Save; Settings > Saved | amends D105, D127 |

---
