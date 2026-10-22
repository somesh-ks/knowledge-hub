# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Built for its owner first: a design engineer in Stockholm who wants the two days of tech and design-engineering news that matter, without reading feeds. Typical use is a phone, one hand, about three minutes of reading or about eight of listening, often hands-free. A wider audience may read it later, so nothing on a main path may assume the reader is the owner.

## Product Purpose

Singularity is a briefing published every second day, with a deeper pass on Sundays. Each story is three or four plain sentences and one link to its source, and the whole briefing can be played as one narrated recording with a chapter per story. Success: a reader can scan it in three minutes or hear it in eight, understands each story without background, and can reach any source in one tap.

## Positioning

The briefing is filtered by a taste model the owner tunes in one sentence, never shows a story twice, and publishes nothing on a quiet day. It is a curator's cut, not an aggregator's feed.

## Operating Context

- Phone first: iPhone Safari and the installed home-screen app. Desktop second.
- Read or heard: the same stories in the same order, with lock-screen controls and resume.
- An archive of earlier briefings.
- Owner tools: a control that generates a briefing on demand, and settings (theme, sounds, default speed). There is no passphrase (D157): the daily caps and the monthly narration budget are the only limits.
- Published at news.someshks.work, public but unlisted and not indexed.

## Capabilities and Constraints

- Static Astro site with React islands; two on-demand functions. Digests are Markdown files with frontmatter under `Digests/`.
- Sections, in order, omitted when empty: Top picks, Design, Design Engineering, AI Products, Tech Product Launches, Trending. Research, Launches and Watch and listen no longer receive stories; briefings published earlier keep them.
- One recording per briefing with a start time per story, so any story can be played directly.
- Audio is narrated on first play, by whoever presses Play, inside the daily cap and the monthly budget (D157).
- Self-hosted fonts and assets only (strict content security policy). First-load JavaScript stays under 100 KB gzipped per page.
- Internal identifiers keep the old name `dispatch` (packages, CLI, storage keys); only reader-facing text says Singularity.

## Brand Commitments

- Name: Singularity.
- Voice: plain, dry, specific. Four beats per story: what happened, the number that makes it concrete, why, the catch. Rules live in `config/voice.md`.
- Visual direction, set by the owner: Google Podcasts' visual language (flat surfaces, hairlines, one blue accent, Material Symbols, outlined play chips), with YouTube Music's behaviour for the player, which grows from a docked bottom bar into a full page. This is the category standard, chosen on purpose and to be executed straight.

## Evidence on Hand

- Real briefings under `Digests/` and generated covers from `packages/cover`.
- Fixture briefings for tests under `apps/web/src/fixtures`.
- No testimonials, customers, metrics or marketing claims exist; none may be invented.

## Product Principles

1. Curator, not aggregator: fewer stories, each worth the time.
2. Read or heard: every screen works for both, and audio is never required to follow a story.
3. Understood cold: a sharp reader with no background follows each story.
4. One obvious action per story: read it, play it, or open the source.
5. No owner-only dead ends on a main path.

## Accessibility & Inclusion

WCAG 2.2 AA. Reduced motion means fewer and gentler animations, never none. Touch targets are at least 44 by 44 pixels. Colour is never the only signal.
