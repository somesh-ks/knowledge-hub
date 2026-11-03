# Regenerate hints and required comment

Date: 2026-11-03. Decisions: D337, D340 (amends D207, D323). PR #605.

## What happened

Somesh wanted Regenerate to start with only the comment, with other controls appearing "as we type, keep it natural". The earlier experiment was not in the repo or its history, so it was built new: `lib/regenHints.ts` is a local word match (no model, no per-keystroke cost). Length words bring in Length; topic words or a category's name bring in Categories. A shown control stays, so the form does not shift under the text.

Reviewing the stills, he asked for three more things: the comment is required (the writer needs the reason), a short general placeholder ("What should change?"), and the sheet in the design system's style. The shell was already the full sheet from #589; the form inside used its own label style, so both Regenerate forms now use the Create form's headings, chips and Length control. He kept Regenerate full screen on phones (D323), an exception to the bottom-sheet rule, when asked.

## Lessons

- Stills shot before the design-system PR merged showed the old half-height drawer and misled the review. Reshoot stills on the merged base before asking for an OK.
- A required field breaks every journey that submits without it: the player specs failed in CI, not locally, until they typed a comment.
- A "Notify me when it's ready" switch inside the sheets was built (#620) and rejected: notifications are managed in Settings only. Closed unmerged.

## Open

Haiku medium for the Catch up and Regenerate script ships in the weekly-run thread's config PR (D334). Watch `length_share` after it lands: revert trigger is under 0.9 on two Catch ups.
