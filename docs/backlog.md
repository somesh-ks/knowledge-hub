# Backlog

Long-term project memory, future explorations, parked tasks, and shipped milestones. Preserved outside `docs/state.md` to protect the read-first token budget.

## Active Roadmap (Current Focus)

Immediate priority tasks synchronized with `docs/state.md` ## Next:

1. **Owner calls**: Decide on regenerating 3-story 2026-10-27 briefing; revoke old Vercel token pasted in chat; delete empty store `store_JmrDq8MB5Kwn3ejW`; resolve PWA open calls.
2. **Firecrawl yield table**: Generate per-source yield table (21 scraped sources produced about 1 published story per 4,460 credits/month) for owner pruning; onboard changelog providers (Claude, OpenAI) once stable.
3. **Lighthouse CSS optimization**: Defer `BaseLayout.astro` 34 KiB CSS without breaking the resumed player bar; cut the 19 KiB unused CSS on initial load; optimize 1.4 s interaction chain.
4. **Topic to Category migration**: End-to-end migration (plan 14, about 6,500 occurrences) across readers, store sync, code, and workflow outputs.
5. **Design system sweep**: Review `/settings/*`, category pages, player, create; audit light and dark modes at 390px and 1280px; one PR per component family.
6. **Pipeline performance**: Unified fetch for briefing passes, selective story rewriting, split long first turns (D141, D178).

## Parked & Unfinished Tasks

Cold items offloaded from active state. Each item maintains an explicit testable closure condition.

### Operations & Infrastructure
- **Unit flake**: Sound peak check failed once.
  - Closed when: 10 consecutive gates pass cleanly.
- **Costs and sizes verification**: General feed judge requests (estimated 150 to 400 extra Jev calls) and episode script part sizes (D66 to D68).
  - Closed when: a run log reports judge request count with general topics enabled.
- **Model orchestrator (D136)**: Multi-model runtime resolution.
  - Closed when: an engine run log names the resolved models.
- **`doctor --online` validation**: Does not check `GITHUB_SINGULARITY_TOKEN`, and no E2E test applies a real op array through `config apply`.
  - Closed when: both checks exist and pass in CI.
- **Service worker preload race**: `serviceWorker.spec.ts:140` failed 1 of 373 local runs (icon stylesheet preload as page went offline).
  - Closed when: a trace identifies the cause or 500 consecutive test runs pass.
- **Aggregator / redirect filtering**: Links to blocked outlets via aggregators or redirects are not caught.
  - Closed when: domain matching resolves final destination URLs, or owner accepts current matching.

### Player & Audio Experience
- **Cold audio device latency**: First press on cold audio device blocks about 200 ms (`new AudioContext()` in `packages/sound`).
  - Closed when: owner decides on packages/sound initialization rule.
- **Daily audio type application**: Daily Type setting saved but narration reads digest in a single voice.
  - Closed when: owner decides on podcast multi-voice step in `audio.yml` or drops the field.
- **Player opening focus & 429 wait**: Refused narration (429) omits retry wait time; focus on player open unchecked.
  - Closed when: 429 toast displays wait duration and keyboard test verifies focus moves inside opened player.
- **Opus audio streaming backfill**: Complete Opus transcoding backfill for legacy archive episodes.
  - Closed when: all audio episodes in Blob store possess valid `.opus` alternates alongside `.mp3`.
- **Phone gestures (D125)**: Pull to close, sticky tabs, keyboard fit on real devices.
  - Closed when: each gesture verified on a physical phone.

### UI Polish & Responsive Layout
- **Story chip layout shift**: Mouse hover on story chip grows 11px from idle to played ("Play again").
  - Closed when: chip maintains fixed width in browser test assertion.
- **Phone sticky bar overlap**: On 360x740 viewport, sticky Generate bar obscures More options on `/create` at rest.
  - Closed when: a 360x740 browser test confirms More options is visible and clickable at rest.
- **PWA device theme hand-off (D123)**: Android system bar color after reinstall; splash to launch-screen transition.
  - Closed when: both transitions match theme cleanly on Android device.
- **Settings switches color flash**: Settings switches display track color until script initializes; October 6-7 audio says "Dispatch".
  - Closed when: owner rules on each visual detail.
- **Settings logic gaps (D102)**: Partial `skip_topics` without `general_scoped` un-skips general topics; `topic.enabled` never set to false.
  - Closed when: each edge case fixed or removed with test coverage.
- **Link preview cards (D153 stage 0)**: Social share previews for briefing links.
  - Closed when: briefing link pasted in WhatsApp, iMessage, and Slack displays full card preview.
- **Critic rounds 5 to 9 polish**: Minor P3 visual polish items.
  - Closed when: owner selects items to address.

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
