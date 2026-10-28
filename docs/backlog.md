# Backlog

Long-term project memory, future explorations, parked tasks, and shipped milestones. Preserved outside `docs/state.md` to protect the read-first token budget.

## Future Ideas

Architecture, new features, and design explorations consolidated from Ledger section 9.

- **Settings live everywhere**: Read schedule, topics, and writer at request time from Vercel Edge Config or Blob, with the repo remaining the record. Pages read runtime config instead of build-time imports.
- **Rubber-band player and sheets**: Settle-spring resistance past bounds via `x * (1 - 1 / (x * k + 1))` in `gestureMath.ts`.
- **Unified sheet and switch primitives**: Consolidate drawer variants into a single `Sheet` primitive with bottom, side-panel, and centered presentations.
- **Shared-element cover transitions**: View transition on cover elements from Library cards into episode heroes without moving page chrome.
- **Haptic feedback paired with audio**: Native `navigator.vibrate` cues on detents and toggles, mapped alongside `uiSound.ts`.
- **CSS Highlight API for transcripts**: Replace individual word span class updates with `CSS.highlights.set('spoken', new Highlight(range))` to eliminate DOM manipulation during playback.
- **Dynamic audio-breathing ambient light**: Sample narration RMS at 10 Hz to subtly modulate ambient header canvas opacity during playback.
- **Per-digest accent palette in player**: Derive dynamic controls accent via `oklch(from var(--cover-key) ...)` clamped to verified contrast floors.

## Parked & Unfinished Tasks

Cold items offloaded from active state. Every item includes an explicit testable closure condition.

- **Seventeen historical items**: [five](history/2026-10-21-owner-backlog-in-parallel.md#parked) and [twelve](history/2026-10-27-session-close.md#parked) archived items.
  - Closed when: each individual item's test condition is satisfied.
- **Automated source candidate discovery**: Ingest pipeline candidates into evaluation queue.
  - Closed when: candidate sources in `state/source-candidates.json` are automatically scored and promoted by `packages/engine` CLI.
- **Model orchestrator (D136)**: Multi-model runtime resolution.
  - Closed when: an engine run log names the resolved models.
- **Opus audio streaming backfill**: Complete Opus transcoding backfill for legacy archive episodes.
  - Closed when: all audio episodes in Vercel Blob store possess valid `.opus` alternates alongside `.mp3`.
- **Multi-select batch actions in Library**: Bulk mark played, download, or delete multiple digests.
  - Closed when: multi-select toolbar renders in Library and batch status mutations pass E2E assertions.

## Shipped Milestones

Key historical milestones with links to architectural decisions and history notes.

- **2026-10-25**: Dynamic topics panel and source weight management (D185, D186).
- **2026-10-22**: Living Design Catalogue at `/design` rendering all tokens and component specimens (D189).
- **2026-10-19**: Static-first reader architecture with React audio player islands and zero CLS fallbacks (D110, D122, D132).
- **2026-10-14**: Full audio player engine with Speechify-style synchronized transcript view and tactile UI sounds (D101, D105).
