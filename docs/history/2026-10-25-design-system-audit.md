# Design-system audit and the Structure view's return to the system

2026-10-25. The owner asked for a catalogue of every component as PNGs, open-source alternatives to zeroheight and Supernova, and an audit of how strictly the system is followed, "especially in the structure tab under preferences page".

The audit (project files, `design-system/report.md`) found the primitives clean and the drift in page stylesheets adjusting them locally: the same two breakpoints in 29 spellings, 44 negative margins pulling controls into line, 27 literal scales, the switch and the segmented control each defined twice. Structure was the newest copy of the habit: a hand-built menu sheet without item icons, SVGs without `data-icon` so D187 never reached it, a shared label recoloured in the page sheet, the tabs outdented into the card.

The first fix (D188) moved each local rule to where the system holds it: `sheetHead.ts` for the header and icon markup, `data-quiet` in settings.css, `.tabs-in-card` in primitives.css, `.field-label` in manage.css, the pencil's ink margin in buttons.css, a token for a multi-line field's ceiling. The tools question was answered with no new tool: a `/design` route in the site, rendered from the CSS the app ships; Backlight shut down in June 2025, and Storybook with the community Astro framework is the only open-source option that renders `.astro`.
