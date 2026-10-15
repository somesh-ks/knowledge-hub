# Episode rubric

Fixed before any track A fix (2026-10-15). `loop/eval.ts` reads the definitions below; neither
file changes after the baseline.

## Segments

A segment is one story as the listener hears it. For a briefing (daily or weekly), that is one item's
spoken block, built the way the audio is built (`itemBlock` in `packages/engine/src/audio/spokenText.ts`).
The frame (hello, section bridges, sign-off) is airtime but not a segment.

## Length

- The setting is `length_minutes` from the fixture's settings (the schedule's daily or weekly length).
- Script minutes = spoken characters of the whole narration / 968. 968 is the app's own figure
  (`PODCAST_CHARS_PER_MINUTE`, packages/core/src/podcast.ts), measured on real audio. It is about
  161 words a minute at the app's 6 characters a word.
- Audio minutes = `duration_ms` of the episode's audio file, when one exists.
- Pass: each measured value is within ±10% of the setting.

## Topics

- The topic universe is `config/topics.json`.
- A segment's topic is its item's `category`.
- Selected topics are the enabled topics that are not in the settings' `skip_topics` and that the
  owner wants. A built-in category counts as wanted when its preference weight is at least 0.5;
  today that leaves out `venture_capital_and_gossip` (0.10) and `generic_ai_hype_listicles` (0.02).
- Unselected airtime is the airtime of segments whose topic is disabled (for example `trending`),
  skipped, or unwanted.
- Pass: every selected topic has at least 1 segment, and unselected airtime is at most 20% of the
  segments' airtime.

## Importance (LLM judge)

The judge labels each segment `major`, `minor` or `changelog`.

A segment is **major** when it meets at least one of these:

1. It reports a new capability, product, model, method or finding that changes what a design
   engineer can build or how they work. Shipping an existing product's next patch or version
   number does not count.
2. It reports evidence: a study, a measurement or a dataset with numbers a practitioner could act
   on or cite.
3. It is a significant event in the field, such as a launch, a policy, an acquisition or a shutdown,
   that many practitioners would discuss that week.
4. It explains a technique or a decision in enough depth to apply it, not just that it exists.

A segment is **changelog** when its substance is a version bump, release notes, a dependency
update, a bug-fix list or a minor plugin or package release, whatever the framing.

Any other segment is **minor**.

Pass: major segments take at least 80% of the segments' airtime, and no segment is changelog.

## Quality (LLM judge)

The judge scores the whole episode from 1 to 5 on four criteria:

- clarity: each story is understandable on first hearing, without reading the article;
- novelty: it tells the listener something they probably did not know;
- no repetition: no fact, phrase or framing repeats across or within segments;
- worth listening to: a busy design engineer would choose to hear this over skipping it.

Pass: the mean of the four is at least 4 and no score is below 3.

## Judge runs

The judge runs twice per episode at temperature 0, with the same prompt. If the two runs give any
segment a different label, or score any criterion differently, the episode fails
importance and quality. Without a model key, both metrics are reported as BLOCKED, which counts as
not passing.
