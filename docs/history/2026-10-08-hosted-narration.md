# 2026-10-08: making the narration sound hosted

## Question

The owner found the podcast lifeless and the headlines transactional, and would accept up to ten minutes for a good day.

## Findings

- The narration was the headline, then the summary, verbatim, so every story sounded like a card read aloud.
- A typical 14-story briefing runs about 5.4 to 7 minutes at 62 ms per character, so there was room.

## Changes

- `spoken` on a digest item, written in the same call as the summary and checked by `write/spokenCheck.ts` (every number must be in the headline or summary).
- `audio/hostFrame.ts`: opening, section bridges, connectives and sign-off, in code. Decision D29.
- Headline rule, prompt and six before and after pairs in `config/voice.md`; a changelog-shape warning in the linter.

## Open

- Hear it: no Speechify run was made, so the phrasing is judged on text only.
