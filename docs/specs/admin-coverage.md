# Admin coverage

`/admin/coverage` in the command center: how much of what the apps draw comes from the design system. Counted at build from `tokens/system.json` and the reader's and command center's sources (`apps/admin/src/lib/coverage.ts`, with the system's own class reader), so the page has no script and no request.

## Requirements

- The answer first: a ring with the share of control uses drawn with a shared part, and a legend with the parts and one-offs and their uses.
- A use is a file that draws a control, counted once per control. A part is drawn by a file that writes one of its classes or imports one of its components; its own files are its definition, not a use. A component more than one part names (Button.astro) counts through the classes only.
- Parts: one bar split by kind, the most drawn darkest, with a legend (parts and uses per kind); then the eight most drawn parts as bars against the most drawn, the rest behind "All N parts".
- One-off controls: each bespoke class no part lists, as a bar of the files that write it; its reason on hover. A bespoke class a part lists is used through that part and is left out.
- Tokens: the total, how many semantic roles a part reads, and a bar and legend by tier.
- Marks only, tokens only; no tone colour, since nothing here is good or bad on its own.

## Not built

A rebuild on every reader edit. The admin app rebuilds when tokens, the design system or its shared sheets change (`apps/admin/ignore-build.sh`), so a page edit that changes no part shows on the next such build. Widen the ignore list if the owner wants each edit counted; it costs a deploy per reader change.

## Code

`apps/admin/src/pages/coverage.astro`, `apps/admin/src/lib/coverage.ts`.
