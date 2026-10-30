# 2026-10-30: a Catch up that said Readout and aired 2 minutes

The first Catch up after the push fix (ep-20261030-0025, run 40973051794, $0.13) showed "Readout · 2 min" in the Library for a 5 minute request.

## What went wrong

- The label: the card, the player caption and the episode page led with the episode's format. The Library's filter already called everything made on request a Catch up, so the two disagreed.
- The length: the topic had one story of its own in the window; Top picks of other topics always match (D39), so 8 stories were selected. The structure's Top picks count, 2 at 5 minutes, cut them to 3 in `fitStories`, and the writer, held to what three stories carry, aired 1,694 of 4,840 characters. D218 had made counts a proportion on the daily's selection, not here. The run log showed `stories: 3, matched: 10, writer_calls: 1`, which is what a capped selection and an accepted script look like.

## What changed

- `recordingKind`, `episodeFacts`, `briefingKindLabel` and the episode hero say Catch up; the format stays in search text.
- `fitStories` fills empty slots from the unused candidates (D246).

## Not verified

A real Catch up on a thin topic after the change (it costs a paid run, which was not started): it should select about 8 stories and land near 90% of its length. The thin-pool deep-dive boost (`structureFor`'s `needed`) does not apply under a structure, so a pool of four or fewer stories can still fall short of the length.
