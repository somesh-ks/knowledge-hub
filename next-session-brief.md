# Singularity: brief for the next session

> **For the agent: delete this file when the work is done.** Once every item below is merged, moved into `docs/state.md`, or declined with a reason, remove `next-session-brief.md` in the same PR that closes the session record (section 4). Don't leave it in the repo root. If you stop part-way, rewrite it to what is left rather than deleting it.

Repo: `somesh-ks/knowledge-hub`. Site: news.someshks.work. Written on 2026-10-27, at the end of a two-day session that merged about 50 PRs (#315 to #377).

Start by reading `AGENTS.md`, then `docs/state.md`, `docs/learnings.md` and the `docs/decisions.md` Index. Then run `gh pr list --state open` and check every PR below against GitHub, because the state may have moved since this was written.

---

## 1. How to work (owner rules, learned this session)

- **Merging:** merge completed PRs yourself, workflow PRs included. Completed means:
  - CI green, CodeRabbit included;
  - every CodeRabbit root comment answered in its thread;
  - CodeRabbit's review-summary notes (the "required", "missing" and "follow-up" ones) handled;
  - no merge conflict.

  Squash-merge with `--delete-branch`. After a workflow PR merges, watch its first run.
- **CodeRabbit loop:** each push triggers a re-review that can add new comments. Fix real bugs and rule violations, decline style-only nits in one sentence (the reply closes the thread), and batch fixes into one push per PR.
- **Find the cause first.** Show logic bugs red first. Never loosen a test to get green; fix the product unless the test is genuinely stale.
- **Agents:** Sonnet and Haiku by default; Opus only when the owner asks, for design and visual work. At most 6 at once. Reuse a finished worker only while it's warm (under about 100k tokens, finished within the hour). Briefs must say "stop and report at call 70" (the cap is 90).
- **Worktrees on Windows only (not a concern in cloud):** `node scripts/worktreeLinks.mjs <path>` links packages per package; `--remove` before removing a worktree; `--check` lists linked worktrees. Junctions once deleted the main checkout's `node_modules` twice.
- **Config is owned by the config store (D149, D185).** Change it through `/api/config` (POST `{"op": {...}}` with `Origin: https://news.someshks.work`), never by editing `config/` in Git. Production config writes are database writes, so ask the owner first.
- **Design:** read `docs/design-engineering-ledger.md` and `~/.agents/DESIGN.md` first. Use the 8pt grid, tokens only, shared classes (a component changes in the system, never on one page), concentric radii in cards, no pill buttons by default, no elevation unless asked, no em dashes. Screenshot open states at 390 and 1280, in light and dark.
- **Live content:** creating, deleting, regenerating or changing anything must show without a redeploy (plan section 20 criteria). Content merged by PR syncs to the store on push (#359).

## 2. State at hand-off

**Merged this session (highlights):**
- Live content and deletes: #332 tombstones, #346 versioned audio and cover URLs, #359 sync on push.
- Publish timing: strict 07:00 with a 2-hour lead (#318); the cron fix for a slow store (#349).
- Audio:
  - Opus for briefings (#339), with the backfill of 5 briefings (#357);
  - Opus for episodes (#361);
  - no audio fetched before Play (#335).
- Player:
  - autoplay and Suggested (#334);
  - speed per episode with a default offer, and the desktop chevron (#320);
  - catch-up player fixes (#319).
- Settings:
  - breadcrumbs (#330, #363, #364 true 44px text-link hit area);
  - live settings save (#343);
  - sidebar save guard (#356);
  - Daily and Weekly on/off (#353);
  - the profile card (#345).
- Sources:
  - rating formula and plain reasons (#323);
  - YouTube 404 fallback (#326);
  - Firecrawl empty-fetch and fair rotation (#351);
  - Alexandria Anthropic pilot (#352, enabled in the store on 2026-10-27);
  - the `fetch_via` op (#360).
- Topic weight removed, muted topics stay muted (#340, D194).
- CI: browser suites on main and nightly (#354).

**Open or in flight when the session ended (verify each):**

| PR or branch | What | What's left |
|---|---|---|
| #373 fix/briefing-refill | **Urgent.** The daily briefing on 2026-10-27 shipped 3 stories (79 s) after grounding dropped 5 of 8 and the refill found an empty reserve (the structure caps also capped the reserve). The fix lifts the caps for the reserve and adds an `under_length` warning. | Answer CodeRabbit, merge. Then ask the owner whether to regenerate 2026-10-27. |
| #375 feat/grounding-drop-log | Logs which stories grounding dropped, their source text length and origin, and the failing sentences. | Answer CodeRabbit, merge. On the next run, read the log: is thin scraped text the cause? |
| #376 fix/dock-optical-centre | The playback bar's controls sat 1px high (the 2px progress line); the chevron is centred too. | Answer 2 comments, merge. Ask the owner to look again: they saw more than 1px. |
| #374 feat/costs-stat-boxes | The Costs stats as dashboard tiles instead of pills. | Resolve the conflict, answer the comment, merge. |
| #371 docs budget | look-and-sound.md within 8000 bytes. | Answer the comment, merge. |
| #377 fix/voice-no-default-flash | The Voice page no longer flashes the default voices. | Merge when green. Follow-up in item C below. |
| #378 fix/preferences-polish | Owner topics 4, 6, 7, 8 and 9, plus later asks. The worker was stopped mid-task. | See section 3A. Its PR body lists what is unverified. |
| #379 fix/catch-up-action | The Catch up rail button. The worker was stopped before verifying. | See section 3B. |
| #299 Dependabot fast-uri | A patch bump. | Merge when green. |

## 3. Work to do, in priority order

### A. Finish Preferences polish (branch fix/preferences-polish)

Done on the branch:
- breadcrumbs on every settings subpage, guarded by `apps/web/e2e/settingsPages.spec.ts`;
- one 24px title-to-content gap on every settings page;
- "Podcast autoplay";
- the profile select rebuilt (the "Designer" text was cropped by a one-off topics.css rule plus the shared 70% select cap).

Check each of these was done; finish any that weren't:
1. **Profile flow bug:** editing a named profile's sections overwrote the kept Custom list. Switching Custom → Student → Custom must restore the custom blocks exactly. Confirmations go through the shared confirm dialog. Below the profile card: a divider, then a "N sections" title with Reorder and Add section on the right.
2. **Revert the slider's status label** ("Normal") from above the slider to the old construction. The owner overrode their 2026-10-25 ledger entry on 2026-10-27, so update the ledger. Give the content under the segmented selector (tabs-in-card) the card's standard inner spacing.
3. **Default playback speed:** its own row directly below Podcast autoplay, in one playback card.
4. **Card radius from height:** radius ≤ about 25% of the card's height. A one-row card steps down to about 16 to 20px, chosen automatically in the shared card class with `:has()`. Inner radii stay concentric. Add a designSystem.spec assertion.
5. **Category page Sources card:** less space above the "Sources" title, and top padding on the search and tabs block when it's sticky.
6. **Daily and Weekly:** remove the "Setting to be changed in preferences" value text from the Podcast structure link row.

### B. Catch up button (branch fix/catch-up-action)

Owner decision: no elevation; a 16px rounded rectangle, recorded as an exception to the pill rule. A distinct tonal fill (a primary-container-like token), richer than the nav's active tint but not solid blue. The nav active tint keeps meaning "you are here". It must not look faded: label at least 4.5:1, fill against the rail at least 3:1, in light and dark.

### C. Follow-ups already identified

1. **Voice instant paint:** hold the `/settings` index summary lines too, and apply the device's cached store copy before first paint (an inline head script), so the last-known values show instantly.
2. **ffmpeg on runners:** confirm the audio and podcast workflows really produce `.m4a` (Opus) on GitHub's runners. If ffmpeg is missing, add an install step to the audio, podcast and ci workflows. Check the next audio run's log.
3. **iPhone:** the owner plays https://news.someshks.work/d/2026-10-24 on an iPhone. Only after that may the backfilled MP3s be deleted.
4. **Alexandria pilot:** check on the next briefing run's log that `anthropic-blog` was fetched via `alexandria:anthropic-com` with dated posts. Revert with `source.update` and `fetch_via: null`.
5. **Firecrawl:**
   - changelog providers (Claude, OpenAI release notes) if the pilot proves out;
   - a per-source yield table so the owner can decide which low-yield curated scraped sources to keep: 21 Firecrawl sources produced about 1 published story per 4,460 credits a month.
6. **Lighthouse CSS:** defer the BaseLayout CSS without breaking the resumed bar (#347 only removed a duplicate stylesheet).

### C2. Older pending items, still open from earlier in the session

1. **CodeRabbit on open PRs:** #371, #373, #374, #375 and #376 had 1 or 2 unanswered comments each when the session ended (a worker was stopped mid-way). #376 had a half-made ledger edit for a "label" comment; redo it from the comment. Read every review summary too.
2. **Live-content criteria not yet met (plan section 20):**
   - Criterion 3: an open page on another tab or device should refresh within 60 s. Today it updates only on the next navigation.
   - Criterion 10: `scripts/smokeLive.mjs` exists but has never run against production. It runs only on the owner's command. Ask the owner, then run it (`--apply`) and confirm `/build.json` is unchanged after a delete, add and regenerate.
   - Unaudited surfaces: a removed episode in other devices' offline copies, and the run card's Listen now after its episode is deleted.
3. **Lighthouse (mobile, 2026-10-25):** Performance 99, SEO 66 (noindex, intended).
   - Still open: render-blocking BaseLayout CSS (34 KiB), about 19 KiB of unused CSS, and the 1.4 s request chain (share, overlays and the Create tools could load on interaction; `/api/share` is an intended prefetch for the iOS share sheet).
   - Re-run Lighthouse after any CSS change.
4. **A flaky test:** `apps/web/e2e/topics.spec.ts` (the tests near lines 661, 723 and 1257 to 1452) fails intermittently under load on Windows. Check whether it also flakes in CI now that browser CI runs on main (#354). If it does, find the race.
5. **Episode length:** #327 added an extend pass and longer deep dives. Verify on the next podcast episode's "Script length" log line that it reaches at least 90% of its target, and check the next daily briefing's length after #373.
6. **Settings shared by friends:** the owner's single config is shared by everyone with the URL. That's deliberate until OAuth (see E); no action.

### D. Larger items (start only when sections 3A to C2 are merged)

1. **Topic to category rename, end to end (plan task 14):**
   - About 6,500 occurrences in about 300 files, much of it persisted.
   - Order: an inventory, which the owner reviews; readers that accept both names; a store-synced migration; a scripted code rename; the workflow outputs; then drop the old names.
   - Run only when no other PR is open. `docs/history/2026-10-25-owner-feedback-pass.md` has the inventory starting points.
2. **Design-system sweep (task 17):** a design audit across `/settings/*`, the category pages, the player and the create flow, in light and dark at 390 and 1280, with fixes in shared classes, one PR per component family.

### E. Known gaps, decided

- **Write-route auth:** #370 was closed by the owner. The URL is shared with friends only, and OAuth will replace it. Until then, any same-origin request can change config, and friends share the owner's single config.
- **Analytics and costs:** become admin-only once OAuth exists.

## 4. Session close (do at the end)

- `docs/state.md`: rewrite it to the new state.
- `docs/decisions.md`:
  - make sure D193 (speed and chevron), D194 (topic weight), D195 (breadcrumb) and D197 or later exist;
  - add the strict publish time, Opus, live content and tombstones, `fetch_via`, and the auth decision if they're missing.
- `docs/learnings.md`: one line each for:
  - `**/api/config` route globs ignore query strings, so use a regex;
  - a squash merge leaves commits off the remotes, so check via PR search;
  - docsCheck budgets break every PR's check job;
  - grounding drops plus empty reserves cause short briefings;
  - the worktree junction failures.
- `docs/history/`: a note for 2026-10-26 to 27.
- **Cleanup:** remove merged branches and worktrees, and verify production (`/build.json` matches main).
- **Delete this file** (`next-session-brief.md`) in that final PR, once everything above is done or recorded in `docs/state.md`.
