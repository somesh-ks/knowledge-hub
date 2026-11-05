# Backlog

Long-term project memory, future explorations, parked tasks, and shipped milestones. Preserved outside `docs/state.md` to protect the read-first token budget.

## Active Roadmap (Current Focus)

Immediate priority tasks synchronized with `docs/state.md` ## Next:

1. **Owner calls**: Choose the Vercel plan (11-06 to 11-08; the Blob trial ends 11-13); decide on regenerating 3-story 2026-10-27 briefing; revoke old Vercel token pasted in chat; delete empty store `store_JmrDq8MB5Kwn3ejW`; resolve PWA open calls.
2. **Firecrawl change check**: the yield report is delivered; the owner prunes. The free change check before a scrape is built (D342) and saved fingerprints on 11-02 and 11-05; a Firecrawl monitor costs the same as a scrape per check.
3. **Lighthouse CSS**: parked. Critical CSS paints a cold phone in 1.0 s, not 3.2 s, but needs per-page CSP hashes and a flash check.
4. **Topic to Category migration**: End-to-end migration (plan 14, about 6,500 occurrences) across readers, store sync, code, and workflow outputs. The UI says Category since #312; the code and data still say topic. Only with no other PR open.
5. **Design system sweep**: Controls still outside the system (D237: icon buttons, chips, FABs, dock and transport buttons; `NOT_YET_COMPONENTS`). Review `/settings/*`, category pages, player, create; audit light and dark modes at 390px and 1280px; one PR per component family.
6. **Pipeline performance**: `first_turn_chars` read 353 and 394 on the first two episodes, which looks short; the owner decides whether to drop the split. Free the lane in the hold (D209): steps 2, 4 and 5 are not built. A shared read of each source per run and a per-field rewrite are built.

## Parked & Unfinished Tasks

Cold items offloaded from active state. Each item maintains an explicit testable closure condition.

### Operations & Infrastructure
- **Unit flake**: Sound peak check failed once.
  - Closed when: 10 consecutive gates pass cleanly.
- **Costs and sizes verification**: General feed judge requests (estimated 150 to 400 extra Jev calls) and episode script part sizes (D66 to D68).
  - Closed when: a run log reports judge request count with general topics enabled.
- **Model orchestrator (D136)**: Multi-model runtime resolution.
  - Closed when: an engine run log names the resolved models.
- **`config apply` end to end**: no E2E test applies a real op array through `config apply` (`doctor --online` checks `GITHUB_SINGULARITY_TOKEN` now).
  - Closed when: such a test exists and passes in CI.
- **Service worker preload race**: `serviceWorker.spec.ts:140` failed 1 of 373 local runs (icon stylesheet preload as page went offline).
  - Closed when: a trace identifies the cause or 500 consecutive test runs pass.
- **Service worker deploy-swap flake**: `serviceWorker.spec.ts:237` (a move to a page of a newer deploy loads in full instead of swapping in) failed once in the full site run on PR #582 (447 of 448) and passed alone. Cause not found; suspect timing between the old and new worker. Fix with a faked clock or a real signal, never a sleep or retry.
  - Closed when: the wait is replaced by a signal and the full site run passes 20 times in a row.
- **Aggregator / redirect filtering**: Links to blocked outlets via aggregators or redirects are not caught.
  - Closed when: domain matching resolves final destination URLs, or owner accepts current matching.

### Player & Audio Experience
- **Cold audio device latency**: First press on cold audio device blocks about 200 ms (`new AudioContext()` in `packages/sound`).
  - Closed when: owner decides on packages/sound initialization rule.
- **Daily audio type application**: Daily Type setting saved but narration reads digest in a single voice.
  - Closed when: owner decides on podcast multi-voice step in `audio.yml` or drops the field.
- **Player opening focus**: focus on player open is unchecked.
  - Closed when: a keyboard test verifies focus moves inside the opened player.
- **Opus audio streaming backfill**: Complete Opus transcoding backfill for legacy archive episodes.
  - Closed when: all audio episodes in Blob store possess valid `.opus` alternates alongside `.mp3`.
- **Phone gestures (D125)**: Pull to close, sticky tabs, keyboard fit on real devices.
  - Closed when: each gesture verified on a physical phone.

### UI Polish & Responsive Layout
- **PWA device theme hand-off (D123)**: Android system bar color after reinstall; splash to launch-screen transition.
  - Closed when: both transitions match theme cleanly on Android device.
- **Settings switches color flash**: Settings switches display track color until script initializes; October 6-7 audio says "Dispatch".
  - Closed when: owner rules on each visual detail.
- **Link preview cards (D153 stage 0)**: Social share previews for briefing links.
  - Closed when: briefing link pasted in WhatsApp, iMessage, and Slack displays full card preview.
- **Critic rounds 5 to 9 polish**: Minor P3 visual polish items.
  - Closed when: owner selects items to address.

## Owner Topics (added 2026-11-05)

Asked for by the owner and not yet planned. Each needs a design or a decision before code.

### Product
- **Animated icons on tap**: an icon answers a press with a short move of its own (a heart fills, Play morphs to Pause, a tab icon bounces). Today only the avatar's tap show (D353) and the press ripple (D286, D347) exist.
  - Closed when: the DS Icon has a tap animation per icon family on motion tokens, gentler under reduced motion, and the owner OKs it on his phone.
- **Splash screen animation**: a richer first moment for the installed app. Today the launch screen (D123, `LaunchScreen.astro`, `launch.css`) shows the ringed dot sending out two rings, installed app only, and the Android splash hand-off is unverified on a device.
  - Closed when: a new launch animation is designed from the DS, starts where Android's splash leaves the mark, adds no wait to the first paint, and the owner OKs it on his phone.
- **Feedback sharing**: a way for the owner (and later users) to send feedback from inside the app: a note, the page, the device, optionally a screenshot. Today only story votes and the Regenerate comment (D337, D340) carry any.
  - Closed when: a decision names where feedback lands (an admin inbox in Neon, or a GitHub issue) and a sent note shows there with its page and device.
- **Google sign-in (OAuth)**: today the profile's Log in button is a dummy (D335), and admin Google sign-in waits as #496 (D261) for an OAuth client the owner makes in Google Cloud Console (runbook). Reader sign-in is Stage A of the multi-user plan; it would also let write routes require a session (D201) and give push a per-person identity.
  - Closed when: the owner signs in with Google on his phone, his avatar and settings follow the account, and a signed-out visitor cannot write.
- **Better push notifications**: Daily, Weekly and Podcast ready shipped (D284, #529). A ping has not yet been confirmed on his Android phone (4 Nov: Notify logged no watched run). Ideas: a "Send a test" button, the cover and Play or Later actions on the notification, a ping per device identity once sign-in exists, more kinds (asked, unanswered).
  - Closed when: a Daily and a Podcast ready ping reach his phone and a tap opens the episode, then the owner picks which ideas to build.

### Operations
- **Better analytics**: Simple Analytics (D154) counts cookieless page views and a few named events on the reader; the admin Analytics page waits as #495 for `SIMPLE_ANALYTICS_API_KEY`. Missing: listening (plays, how far an episode is heard, skips), install and push opt-in counts, and a weekly summary.
  - Closed when: a decision lists the events to add (nothing that names a person) and the admin page shows them for a week.
- **Error reporting**: nothing collects a browser or server error today; Sentry was dropped by the owner's call on 10-22. Options: a small own endpoint that keeps `error` and `unhandledrejection` reports in Neon and shows them in admin Health, or a hosted tool.
  - Closed when: the owner picks one, and a thrown error on his phone shows in admin with its page, build and device within a minute.
- **npm to pnpm**: asked for on 10-24 for faster installs and builds. Today the repo uses npm workspaces and `package-lock.json`; every workflow, the Vercel builds, `worktreeLinks.mjs` and Dependabot use npm.
  - Closed when: CI, the Vercel builds and the scheduled runs install with pnpm and a measured install is faster than npm's.
- **History rewrite (D298)**: remove the owner's old data from git history.
  - Closed when: it is done with no PR open, and a clone holds none of it.

## Future Ideas & Explorations

Architecture, new features, and design explorations consolidated from the Design Engineering Ledger and architectural discussions:

- **Settings live everywhere**: Read schedule, topics, and writer at request time from Vercel Edge Config or Blob, with the repo remaining the record. Pages read runtime config instead of build-time imports.
- **Rubber-band player and sheets**: Settle-spring resistance past bounds via `x * (1 - 1 / (x * k + 1))` in `gestureMath.ts`.
- **Unified sheet and switch primitives**: Consolidate drawer variants into a single `Sheet` primitive with bottom, side-panel, and centered presentations.
- **Shared-element cover transitions**: View transition on cover elements from Library cards into episode heroes without moving page chrome.
- **Haptic feedback paired with audio**: Native `navigator.vibrate` cues on detents and toggles, mapped alongside `uiSound.ts`.
- **CSS Highlight API for transcripts**: Replace individual word span class updates with `CSS.highlights.set('spoken', new Highlight(range))` to eliminate DOM manipulation during playback.
- **Dynamic audio-breathing ambient light**: Sample narration RMS at 10 Hz to subtly modulate ambient header canvas opacity during playback.
- **Per-digest accent palette in player**: Derive dynamic controls accent via `oklch(from var(--cover-key) ...)` clamped to verified contrast floors.
- **Alexandria domain datasets**: Direct integration with Alexandria domain sources (podcasts, company filings, registries) before falling back to raw scraping.
- **Multi-select batch actions in Library**: Bulk mark played, download, or delete multiple digests with batch status mutations.

## Shipped Milestones

Key historical milestones with links to architectural decisions and history notes:

- **2026-10-28**: Comprehensive dead dependency and font asset cleanup; verified W3C DTCG token architecture.
- **2026-10-27**: Live content and tombstone deletes without redeploy (D199); Opus narration pipeline with fallback (D198); strict publish schedule (D197).
- **2026-10-25**: Dynamic topics panel and source weight management (D185, D186).
- **2026-10-22**: Living Design Catalogue at `/design` rendering all tokens and component specimens (D189).
- **2026-10-19**: Static-first reader architecture with React audio player islands and zero CLS fallbacks (D110, D122, D132).
- **2026-10-14**: Full audio player engine with Speechify-style synchronized transcript view and tactile UI sounds (D101, D105).
