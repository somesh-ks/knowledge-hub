# Postmortem: the test suite

Written 2026-10-12, after the owner said "It is ridiculous to have so many tests for a simple application" and four read-only audits (one per layer) agreed. Read this before you add, change, merge or delete a test. The rules are under [Rules for tests](#rules-for-tests); the rest is the evidence for them. Facts here are measured unless marked "inferred".

## In short

- Before the cuts the repository held about 4,800 unit tests, 434 site end-to-end tests that ran as 988 executions, and 155 player end-to-end tests that ran as 947 listed runs over ten projects. Test code was 0.83 lines per line of source. The browser suites took about 12 and 10 minutes, the dev lab another 10, and none of the three ran in CI.
- Count was not the defect. The unit layer was mostly sound pure logic (the audits kept 88% of the engine's tests and 92% of the web unit tests). The waste was in the browser layers: of 434 site e2e tests 128 were change detectors, duplicates or dead and 109 more were merge candidates; of 155 player e2e tests, 63 and 41.
- The suite was large and still missed the bugs that mattered. Every P1 that a critic found by walking a journey passed it (table below). The bugs lived where tests were not written: state that survives navigation, reload or time; a failure after the user has moved on; a platform quirk; two features sharing one element.
- Cause, in one line: the loop rewarded "tests added" and "green", nobody was charged for maintenance, and tests were written for what is easy to assert on a screenshot-and-DOM workflow (copy, CSS, geometry), not for where bugs hide.

## What it cost (measured)

- Wall time of a full gate: unit 95 s (the only layer in CI), site e2e about 12 minutes, player e2e on the site projects 9.9 minutes, the player lab about 10 minutes. About 30 minutes per full gate on a 4-core container, so "run everything" was done rarely and subsets were run instead.
- Churn: in the 282 commits of the polish branch, 199 touched a test file (71%). Tests were added 7.9 lines for every line deleted (unit 4,997 added, 521 deleted; site e2e 4,101 and 677; player e2e 1,173 and 101); source was 2.3 to 1. Tests were 37% of all line churn. Nobody deleted a test in the normal course of work: when behaviour changed the assertion was edited to match.
- Growth on the branch, by the same `it(`/`test(` count: unit cases 3,757 to 4,049 (+8%), site e2e declarations 307 to 434 (+41%), player e2e 110 to 144 (+31%). The suite was already large before the branch (0.80 test lines per source line); the branch accelerated it, mostly in the browser layers.
- Trust: a red run did not mean a bug. "Offers every choice" failed because a heading went from "Voice" to "Voices"; a stale dev server failed 13 specs; five lab specs asserted played marks the product no longer made; the flick tests failed about half the time; the section-tabs test about one run in four; `audio-speechify` under load. Agents learned to rerun, and to edit the assertion. 78 site executions skip on every run and were still counted as tests.
- Agent time: every worker spent part of a 60-turn budget running and repairing browser specs for copy and layout it had just changed, and workers hit the limit and were resumed repeatedly.

## What the suite missed

Every row was found by a critic walking a journey on a build, not by a test. The last column says why no test saw it.

| Bug (fix) | Why the suite passed |
| :--- | :--- |
| A run's line carried the Library's hook, so after any Generate or Delete the Library's search, filters and view were dead (92b48f8) | Search was tested on a fresh page and the run line on its own; nobody tested one after the other. |
| The service worker never kept anything fetched at run time, so a settings page first opened offline had no editor (b1339af) | No test had the page reading a response while the worker stored it, so a late `clone()` looked fine; the e2e tests checked the install-time copy. Offline after a normal visit was not walked. |
| A 0.05 s unlock sound was stored as a recording, so a started item read Played before it was heard (45196aa) | No test or fixture modelled the 0.05 s file the first tap loads, a platform workaround. |
| A refused settings change read as saved on the next page, and a change made offline vanished (60e38d1) | Tests checked a failing request on the page where it was made, not the page after. |
| A change held through the server's 10 s gap and then refused after the page was left kept reading "Saving" (a751050) | The tests for leaving a page with a change held (D91) did not follow the held request to its failure. |
| Stories heard lost their marks on a briefing page with no audio (8e0f18a) | No test opened a briefing page without audio after the stories were heard; the page wrote an empty set back. |
| The offline page said "back online" behind a captive portal (8e0f18a) | `navigator.onLine` was trusted by the page and by every test; no test made the network lie. |
| The live Play control never turned to Pause (`docs/learnings.md`, 2026-10-10) | Every player test ran on the dev lab, whose markup had the right hooks; the product page did not. |
| A refused model choice read "Saved" after a reload (round nine; fixed in D99) | The pending note was written before the request; tests covered Daily and Topics, not Model. |

The common thread is the unit of test. The suite tests a page in a state. The bugs are in a person over ten minutes: leave, come back, reload, go offline, fail after leaving, use two features in turn.

## Why it happened

1. **The briefs paid for test count.** The lead's worker brief said "update the tests that assert it, and add a test for every logic bug you fix", and workers followed it literally: one more test per fix, the assertion edited to the new copy, never a merge or a delete. Nothing in any brief, in `AGENTS.md`, `docs/learnings.md` or `docs/decisions/` ever told an agent to remove, merge or slim a test; of 186 learnings lines 63 mention a test, spec or suite and none says that. The record was one-directional.
2. **Green was the only exit criterion.** A worker finished when the suite passed. "Small", "fast" and "protects something" were not asked, so editing an assertion to match new output was the cheapest way to finish, and a changed assertion looked like diligence.
3. **Nobody owned the suite as a system.** Each worker owned a slice and added its tests to the central spec files; the lead reviewed diffs and gate results, and the critics reviewed the product. The first time anyone read the tests as a whole was the audit the owner triggered. (Inferred from the briefs and the history; the transcripts were not re-read.)
4. **Tests followed what is easy to assert.** The workflow was screenshots plus DOM, so the cheap proof of a design decision was an assertion on its copy, class, computed style or pixel gap. Journeys across pages, reloads and time are harder to write, so they were mostly not written. The bugs are all in the second group.
5. **Layers and projects multiplied the same test.** Site e2e ran every test on phone and desktop (331 executions per run repeated a test with nothing viewport-dependent); the player specs ran on a dev lab and the site at five sizes each (88 tests times ten projects); 18 of 35 orchestrator-gate tests replay unit tests through the file system. Nobody asked "does this depend on the viewport?" or "which layer already owns this?".
6. **A second target grew its own suite.** The dev lab (a page that mounts the player, with its own layout, mocks and `astro dev` server) carried 67 lab-only tests. It rotted when nobody ran it (five stale assertions), hid a real bug (its markup was right where the product's was wrong), kept a dead component alive and cost 490 lines and 441 KB.
7. **Tests were coupled to things that change or cost.** 1,070 engine tests read the live `config/preferences.json`, `voice.md` and `sources.json` (so a weight saved in Settings fails them); real scrypt ran on every handler call in six server files (48.5 of 53 s of web unit time); autosave tests waited out the real 10.25 s server gap; copy, version strings and constants were pinned to their own literals (`"singularity-shell-v7"`, "165 sources", "ships with a weight of 0.8").
8. **The browser suites were outside CI and slow.** Only unit tests, lint and the build run in CI, so the e2e gate was whatever an agent chose to run, and a lab spec could be wrong for most of a day. An unrun test is worse than none: it adds to the count and protects nothing.
9. **Fixtures were kinder than the product.** Three-second fixture stories, mocked APIs that never refuse, a lab with perfect hooks, storage seeded away from the page that overwrites it. Each hid a P1.
10. **The lessons that were written down pushed the same way.** The retrospective of 2026-10-08 produced rules such as "run the whole suite" and "a test that names the mechanism". They were right one at a time and, with no counterweight, added up to a suite nobody could run whole (inferred).

## What the good tests had in common

The tests that earned their place caught failures that are silent: an undefined custom property that drops a declaration (`styles.test.ts`), a minifier that folds a timeline into a shorthand Chrome rejects, a build that reorders stylesheet chunks so `[hidden]` loses (`hidden.spec.ts`), a console warning a unit test missed (the console-error gate), a budget counter, a redaction, an SSRF guard, a write guard, a migration. A person cannot see these by looking at the screen. The tests that did not earn it checked what a person sees at once (copy, spacing, colour, a glyph), which a critic or a screenshot judges better and which polish is meant to change.

## What we changed (2026-10-12)

Four workers cut one layer each from the audits' lists, and the lead merged them and checked that the smaller suite still fails for the bugs the branch fixed (D99).

| Layer | Before | After |
| :--- | :--- | :--- |
| Engine, core, cover, sound, scripts (vitest) | 2,424 test blocks (3,226 cases) in 130 files | 2,237 blocks (3,040 cases) in 133 files |
| Web unit (vitest) | 1,712 tests in 120 files; 53 s of test time, 48.5 s of it scrypt | 1,686 tests in 117 files; 19 s of test time |
| All unit tests | 4,813 tests in 240 files; about 95 s | 4,601 tests in 240 files; 64 s |
| Site e2e (Playwright) | 434 declarations, 988 runs of which 78 skipped every time; about 12 minutes | 312 declarations, 361 runs, none skipped; 6.4 minutes |
| Player e2e (Playwright) | 155 tests, 947 listed runs on 10 projects, 308 of them skipped at run time; about 19 minutes with the lab | 60 tests, 68 runs on 2 projects; 3.2 minutes |
| Dev lab | `src/player/dev` (490 lines, 441 KB), `astro dev` as a second web server, 67 lab-only tests, a Settings sheet only it could open | gone |

Browser runs fell from 1,935 listed to 429 and their wall time from about 32 minutes to about 10 (3 workers for the site suite, 2 for the player suite, on a 4-core container). The unit count fell 4% because most of it was earned; the unit time fell because 91% of the web unit suite's test time was real scrypt.

- **Cut** (net about 440 fewer declarations once the additions are counted: engine 187, web unit 35, site e2e 124, player e2e 96): change detectors (copy, CSS, source text, constants, prompts, snapshots, pixel geometry), duplicates (unit against e2e, phone against desktop, lab against site, integration replays of unit tests), tests of dead code and of dev-only tools (the lab, the eval harness, the prototype page), and trivia. The dead code went with them: 23 unused exports and options in the engine, core and cover packages, the Settings sheet, the install hint component and the lab pages.
- **Merged**: facets of one pipeline run into one test, refusals and `toSpeech` cases into tables, 41 player tests into others, axe scans into one test per state that scans both colour schemes, 12 routes of `hidden.spec` into one test.
- **One project per test**: untagged browser tests run on the phone; `@desktop` runs only on the desktop; `@both` runs on both (overflow and 44 px sweeps, `hidden.spec`, the a11y route sweep). The player suite is site-only (`@desktop` and `@wide` add a 1280 mouse run; `PLAYER_WEBKIT=1` adds an iPhone `@smoke` set that has not been run here). `retries` is 0.
- **Real code, fake world**: the 10.25 s edit gap runs on `page.clock`; engine tests read frozen copies of `config/preferences.json` and `voice.md` under `packages/engine/test/fixtures/config`, and only `committed-data.test.ts` reads the live config and state; `createWriterLlm` takes a retry option so tests do not wait out a real backoff; git tests copy a prebuilt repository pair.
- **Added**: `workflow-contract.test.ts` (every `dispatch` call in `.github/workflows` goes through the CLI's own parser, so a renamed flag fails CI and not the scheduled run), `committed-data.test.ts`, `scripts/houseRules.test.ts` (the repo-wide no-dash rule), Biome's `noImportantStyles` as an error, a cross-page listening journey and an offline-player test for the player, and the regression tests of the round-nine fixes.
- **Not done**: one shared gate for the four POST handlers (they differ in what they read and in the order of their checks, so it is not a pure move); a fetch seam for the Speechify client; some tables (`gate-decideRun` DST cases, `voice-lint`, the `heldSave` and `readerContract` tables, the Library filter table); a CI job for a phone `@smoke` set and a WebKit project (both need a workflow change the owner merges by hand).
- **Re-break check** (D99): on the merged head the lead reverted the source of each fix below, one at a time, in a scratch worktree and ran the tests that should catch it. A surviving test failed every time. Two things the old suite did not guard either: the service worker's warm depth on its own (the run-time cache and the depth have to go together) and the unlock primer in a browser (its fix only ever had unit tests).

| Fix reverted | Surviving test that fails |
| :--- | :--- |
| The unlock primer's silence is not a recording (45196aa) | `playerStore` "does not take the unlock primer's silence for the recording, so nothing is stored as played"; `resume` "played never reads the unlock primer's silence as the end of a recording" |
| The worker saves what a page fetches at run time (b1339af) | `serviceWorker.spec` "saves a file the page fetches at run time" and "keeps every script a settings page loads" |
| A run's line no longer takes the Library's hook (92b48f8) | `library.spec` "search, filters and the view still work after a run" |
| A refused change is not shown as saved (60e38d1) | 8 `managePageSave` tests |
| The page open learns how a left page's held save ended (a751050) | 9 `managePageSave` tests |
| A briefing without audio keeps the stories heard, and the stand-in asks the site (8e0f18a) | `memory.spec` "a briefing without audio keeps the stories heard when its page opens" (both guards reverted together); `empty.spec` "a page standing in for an address that cannot be fetched does not say back online" |
| The `[hidden]` rule outweighs later `display` rules | `hidden.spec`, in both projects |
| A 503 is a passing failure (b33291c) | `narrationApi` "treats the server's 503 as passing"; player `errors.spec` "a 503 mid-recording passes" |
| The engine's write guard | 22 tests in `git-commit`, `git-guard`, `config-apply`, the pipeline edge suite and the publish commands |

## Rules for tests

1. **Test what fails silently.** If a screenshot or a walk would show the failure, do not write a test for it; a critic will. Write one when the failure is quiet: state, persistence, ordering, money, security, a cache, a platform quirk, a build step.
2. **Name the failure.** Before adding a test write one sentence: "if X breaks, the owner or user loses Y". Put it in the title or a one-line comment. No sentence, no test.
3. **One behaviour, one test, one layer.** Search first: `grep` the behaviour in the unit tests, `apps/web/e2e` and `apps/web/src/player/e2e`. Test it where the logic lives (a pure function in a unit test, a page script over a fake DOM, a seam across pages in one journey). Never repeat in e2e what a unit test owns, and never run a test twice because there are two projects: tag the few that depend on the viewport.
4. **Test journeys, not states.** For anything that persists, navigates, waits or fails, write the journey a person would make: do A, leave, come back, reload, go offline, let the clock run, fail the request after the page was left, use a second feature in between. One journey beats five state assertions.
5. **Do not pin what polish decides.** No assertions on copy (unless the exact words are the contract: a refusal the owner must read, a destructive confirmation), CSS values, class names, markup structure, token values, pixel geometry, animation names, source text, constants against their own literal, list lengths, or snapshots beside behaviour tests. Design rules belong in lint or in one rule table (`styles.test.ts`), not in a test per feature.
6. **Real code, fake world.** Fake clocks (`vi.useFakeTimers`, `page.clock`), a cheap verifier in place of scrypt, route mocks, frozen fixtures under `test/fixtures`. No sleeps, no waiting out a real server gap, no reading `config/*`, `state/*` or today's date unless the test is about them. Fakes must model the quirks that already cost a bug: the 0.05 s unlock sound, a response body already in use, a network that says online and is not, storage that the page overwrites when it unloads.
7. **Test the product page.** No lab, harness or prototype gets tests of its own; if a dev-only page is unavoidable it is deleted with its feature.
8. **Delete with the behaviour.** When a rule changes or a feature goes, delete or rewrite every test that pinned it in the same commit. Never leave a test asserting removed behaviour and never edit an assertion to match new output without asking whether the test earns its place. Polish must not raise the test count.
9. **A bug fix gets one regression test, at the level where the bug lives, proven red without the fix and green with it** (stash only the source: `git stash push <paths>`). A class of bug (a seam) gets one journey, not a test per symptom.
10. **Keep a budget and a gate.** On this 4-core container the unit suite stays under about 2 minutes, the site e2e under 7 minutes and the player e2e under 4 minutes. A change that breaks the budget cuts first. Counts and times go in `docs/state.md`. A suite that is not run by CI or by `/close-session` is a liability: run it or delete it.

## Rules for briefs and leads

- Never write "add a test for every fix" or "update the tests that assert it". Write: "add a test only for a logic bug that a unit or journey test can pin, prove it fails without the fix, put it where the logic lives, and delete tests that pinned behaviour you remove. Do not add tests for copy, layout or styling."
- Ask for a net test count and run-time delta in every worker report, and read what each new test protects before merging.
- State the budget in the brief. Tell the worker where an existing test of the same behaviour lives, or that there is none.
- Audit the tests as a system every few rounds, not only the product. The four-slice audit took about 30 minutes per slice and found the cut list in one pass; its checklist is below.
- Keep the journey critics. They found every bug in the table above; the suite found none of them.

## Review checklist (the audit rubric)

Look for, and count: (1) change detectors: source text, CSS declarations, copy, class names, markup, order of mock calls, constants equal to their own literal; (2) tests of the framework or platform; (3) duplicates across layers and projects; (4) table-driven opportunities; (5) brittle: pixel geometry, timing waits, real-time playback, ordering, live data; (6) over-specified mocks; (7) dead or dev-only targets; (8) trivial getters, enum maps, config shape. Protect: pure logic with real branches, security guards, money and budget counters, config ops, parsers, journeys that map to a user goal, axe sweeps, regression guards of past P1s. A test you cannot place in either list stays.

## Signs it is happening again

Test lines per source line above about 0.8; lines added to tests per line deleted well above the source's ratio; a polish commit that adds a test; the browser suites past their budget or any test that skips on every run; a worker report with no test delta; assertions on text that a designer would change; a lab, harness or second target; a failure fixed by editing the assertion.

## What this postmortem does not know

- Whether the deleted tests would ever have caught a bug. The cuts rest on the audits' reading of code and on a re-break check of this session's P1 fixes (D99), not on mutation testing.
- Why individual workers wrote individual tests; the causes above are inferred from the briefs, the history and the diffs.
- Timings vary by up to 40% between runs on this container and were not measured on CI.
