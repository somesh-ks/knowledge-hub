# Stories control

2026-11-06. Thread: Fix catch-up and regenerate flow. Follows PR #728. D377.

## What was wrong

- The story count was the length: `storiesForMinutes` sized every podcast from its minutes alone, so the only way to hear more stories was a longer podcast. A rewrite asked for "More stories" aired 12 again.

## What changed

- Core: `storyCount.ts` (zod-free, `@singularity/core/storyCount`) holds the pace constants with `autoStories`, `mostStories` (a 20-word telling), `storiesFor` and `tellingWords`. `VOICE_LIMITS` moved to `voiceLimits.ts` so the browser can load it. `StoryCount` (zod) is in `podcast.ts`; the schedule (daily, `weekly`, `custom`) and an episode's request carry `stories`.
- Engine: `--stories` (run.yml's new `stories` input for a briefing Regenerate). The write stage selects the picked count, asks the writer for `telling_words` and lints to it; validation cuts to the count (`sparesOverCount`) and refills toward it. An episode's `max_stories` is the pick, capped at what its length holds.
- Site: a Stories Select beside Max length in Settings and Catch up, and in both Regenerate sheets, shown as the comment asks for more or fewer stories (Haiku now returns a `stories` step too). Counts the length cannot hold are hidden (`fitStories`).

## Not done

- Unverified on a real run: whether a 20-story pick at 5 minutes airs within the length, and how a 20 to 30 word telling sounds.
