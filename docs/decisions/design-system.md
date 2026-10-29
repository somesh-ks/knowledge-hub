# Decisions: design system

How the reader looks and feels: tokens, type, controls, covers, sounds, motion and the first-load budget. Rules and the Index are in [README.md](README.md).

## D17: UI and sound design live in `docs/design/`

- Date: 2026-10-06
- Status: Confirmed
- Decision: The design lead specifies the interface in `docs/design/design-spec.md` and sound in `docs/design/sound-design.md`. The build plan keeps the product requirements and points to them.
- Reason: One canonical home for visual and interaction detail lets design and engineering proceed in parallel and keeps the build plan short.
- Rejected: Keeping the full UI specification inside the build plan.

## D18: UI sounds are procedural Web Audio from `@dispatch/sound`

- Date: 2026-10-06
- Status: Confirmed
- Decision: UI sounds are synthesized in the browser by the `@dispatch/sound` package. They are optional, restrained, off while narration plays unless the sound design says otherwise, respect the iOS silent switch, and are never used for high-frequency actions.
- Reason: Synthesis needs no sample files, adds almost no weight to the first load and can be tuned in code.
- Rejected: Sampled audio files (weight and licensing). No UI sounds at all.
- Revisit if: The spike shows Web Audio misbehaving on iOS with narration playing.

## D30: The reader is called Singularity; identifiers keep `dispatch`

- Date: 2026-10-08
- Decision: Every string a reader sees or hears says Singularity: titles, the manifest, the wordmark on covers, the narration's opening line. The repository, the CLI, the `@dispatch/*` packages, `DISPATCH_*` variables, storage keys, cache names and element ids keep `dispatch`.
- Why: renaming identifiers would wipe saved preferences and playback positions and touch every import for no reader benefit.
- Rejected: a full rename.

## D31: The visual language follows Google Podcasts and YouTube Music

- Date: 2026-10-08
- Decision: Flat surfaces, hairline rows, one blue accent, Google Sans Flex in two weights, Phosphor icons from one generated source (`tokens/glyphs.json`), an outlined play chip as the one pill. Navigation is Today, Library, Create, Settings: a bottom bar below 64rem, a side column from 64rem. The Library is a cover grid with search, sort and filter. Type rule from the owner: no small text pressed against larger text, at most two type steps per block, a quiet line goes under its title with space, never above it. This updates D4 and D17; `docs/design/design-spec.md` describes the old look and is out of date.
- Why: the owner named the reference and asked for a real podcast app. A pinned reference beats a new invention.
- Rejected: Material Symbols (the owner asked for Phosphor); a page called Archive (no podcast app has one); reading time and per-section clocks in the reader (small text beside headings).
- Cost: the first-load JavaScript budget moved from 100 to 102 KB when the bottom bar became a full transport.

## D48: One shader: a light in the cover's colours behind the header, on a GPU only

- Date: 2026-10-09
- Decision: the header of Today and of an episode has a soft field of light in the cover's colours behind it. A CSS layer is the light everywhere; where WebGL draws on a GPU a small canvas (128px on its long side, scaled up, which is the blur) fades in over it and drifts through one cycle in 40 s or more, at 30 frames a second at most, only while the header is on screen and the tab is visible. Reduced motion and data saver get one still frame. A software renderer, a missing or lost context and forced colours get the CSS layer or nothing. The layer is the header's own box and fades to nothing on all four sides.
- Why: the owner asked for a clever but mild use of shaders. The cover is the one thing that differs from day to day, so its colours are the only decoration that says something.
- Cost: 325 bytes of eager JavaScript on those two page types and 2.3 KB loaded on idle. The canvas path cannot run in CI, where Chromium draws on the processor; it is checked by a script in a real window. The play chip stands on the page's surface inside a header, because its accent text fell short of 4.5:1 over the light.
- Rejected: a shader behind the whole page or the navigation (not mild); a CSS `filter: blur` (repaints, and costs more than the canvas); a library (the budget has 0.1 KB left); drawing on a software renderer (a warning per frame and a busy processor for a decoration).

## D53: First-load JavaScript budget 110 KB, kept as low as the code allows

- Date: 2026-10-10
- Decision: `FIRST_LOAD_BUDGET_BYTES` is 110 KB gzipped (was 104). The budget is a ceiling, not a target: a change that adds first-load script says what it costs, and anything a first visit does not need loads on demand, as the Podcast and Topics editors, the floating button's fold and the navigation boost already do.
- Why: the owner allowed 110 KB and asked to keep it low. The branch measured 103.2 KB on /library with the design pass, 0.8 KB under the old ceiling, so every further change would have been a fight over a few hundred bytes.
- Measured split (2026-10-10, /library): React's client 63.4 KB plus react 3.2 and react-dom 1.4; the player runtime 12.4 (store 2.7, reader sync 1.5, open-player controller 1.4, runtime 1.0, media session 0.7, reader math 0.7, surface view 0.6, switchable audio 0.6); Astro's router 4.2 with prefetch 1.1; the player island 3.8; the layout script 2.5; the sheets island 1.7; icons 1.5; the rest under 1.4 each. Own code is about 27 KB; React is the floor while it loads with every page.
- What could still come off, largest first, in [first-load-js.md](../engineering/first-load-js.md): React and the player and sheets islands only when there is something to show (about 76 KB off a first visit with nothing playing); the open-player machinery and media session on first play (about 4 KB); the service worker code after load (about 0.2 KB, done).
- Chosen by the owner's delegation (2026-10-10): React keeps loading on idle. On-demand would move a download that never blocks first paint (LCP is CSS, the font and the HTML) to the first press of Play or Create, the app's main actions, which would then wait a network round trip on a cold visit; the service worker serves everything from cache on later visits either way. The open-player machinery stays eager too: about 4 KB against a facade over the gesture code the bar and the page share. Reopen if first visits on mobile data become the measure that matters.
- Rejected: preact/compat (declined by the owner on 2026-10-10); dropping hover prefetch (1.1 KB) or the router (4.2 KB), which make moves between destinations immediate (D47).

## D54: Form fields carry a 3:1 outline; in the player only Play is in full ink

- Date: 2026-10-10
- Decision: Text fields and form selects (Settings, the Add source panel, the Create panel, the Library search) draw their outline in `--field-border` (grey-600: 3.49:1 on the light page, 4.37:1 on the dark) instead of the 1.3:1 hairline, and every field takes the full ink on hover. Toolbar chips, the view switch and the Library sort keep their hairline: their own words say what they are. In the open player, Previous and Next take the muted ink the skips already had, so Play is the one control in full ink.
- Why: the owner left the open decisions to the design pass. The fields have no fill, so their outline is the only thing that shows a field is there; WCAG 1.4.11 asks 3:1 for it, Material's outlined fields meet it, and the token already existed unused. The transport row read dark, light, dark, light, dark (ink mass 156, 100, play, 100, 156); with the helpers equal, the row reads as one control and its helpers.
- Cost: fields look firmer than before; a muted Previous and Next read as secondary, which they are.
- Rejected: a filled field with no outline (a second surface colour on a page that has none); full ink for all five transport controls (Play then stands out by size alone).
- Refined 2026-10-10: in the dark theme a disabled Previous or Next was only 1.67:1 from the muted skips beside it and read as enabled, so the dark disabled ink is one step dimmer (grey-650): 2.37:1 from muted, as the light theme's pair is 2.29:1.

## D72: The look is tonal: containers, state layers and round buttons instead of outlines and invisible hover fills

- Date: 2026-10-11
- Decision: Controls are drawn as tonal shapes, not boxes with outlines.
  - Colour: `surface-container` (the page's tonal fill: the search pill, the play chip, an unselected filter chip, the bottom bar), `accent-container` with `on-accent-container` (the selected or current state: a chosen chip or segment, the current destination, the loaded story, a tonal button, the floating button). Text on the accent container is never `accent` (4.0:1 in light). `accent-subtle` and `surface-sunken` stay for wells, skeletons and tracks; at about 1.03:1 on the light page they are never the only sign of a hover, a selection or a control. A test keeps the two containers 1.08:1 and 1.2:1 from the page in both themes, and the text on them at 4.5:1.
  - State layers: a hover lays 8% and a press 12% of the control's text colour over its own fill (`--state-hover`, `--state-press`), on every button, chip, row, option and navigation item.
  - Shape: buttons, chips and navigation items are full pills; a tappable row and a list option are 12px (`--row-radius`); the Create button and the floating button are 16px; a text field keeps `--field-radius` and its outline.
  - Navigation: a tonal bottom bar, 4rem tall, with a pill behind the current icon; in the side column the current row and the Create button take the accent container. The hairline above the bar is gone.
  - The play chip is a tonal pill with no ring or outline; it takes the accent container while it is the loaded story. The hero chip no longer needs the page's surface behind it, since its fill is opaque.
- Why: the owner called the boxed look "ai slop" and asked for a real Google app. Outlines on every control read as generated; a hover or a selected tint at 1.03:1 read as no state at all (chips looked unselectable). Material's tonal containers answer both with a fill that is visible without a line.
- Cost: a transparent 1px border stays on chips and filter chips so their size holds where forced colours draw one; the bar is 8px taller; D54's outlines remain on text fields only.
- Rejected: keeping the hairline outlines and only strengthening them (still boxes); `accent-subtle` made stronger (it is also the hover tint of text controls, where it must stay light); a per-component hover colour (twenty fills to keep in step).
- Supersedes: the outlined play chip of D31 and, for selects, segmented controls and chips, the outlines of D54.

## D73: A steadier type scale: 16px reading, 18 to 20px headlines, 14px meta, 22px regular section headings

- Date: 2026-10-11
- Decision: Story and summary text is 16px at every width (it was 15 to 17px); a story's headline is 18px rising to 20px at 1280px (it was 16 to 17px, one pixel over its summary on a phone) with leading 1.35; the meta line is 14px, level with labels; section headings are 22px regular, so weight 500 marks headlines only; the display step is at most 32px. Reading leading is 1.55.
- Why: the critique found headline and summary a pixel apart on a phone and the same size on desktop, three sizes between 15 and 17px and a medium weight on everything, so nothing was marked. A scale in which each step is visible removes the need for a bold inline label.
- Cost: the 13px meta size is gone, so facts lines grow a point and wrap sooner on a 360px phone.
- Rejected: a fluid reading size (it is the same word at two sizes); making headlines semibold (it breaks the two-weight rule).

## D86: An action has its own tone, the player bar is one tonal block with the navigation, and reading text keeps a 34rem measure

- Date: 2026-10-12
- Decision: `accent-container-high` (blue 200 in light, blue 800 in dark, with `on-accent-container-high`) is the tone of an action that is not a place: the New episode button in the side column and the floating New episode button. `accent-container` stays for what is chosen or current (a chip, a segment, the current destination), so on a phone the button, the Gallery toggle and the current tab no longer share one fill, and on desktop the button is no longer the colour of the Library row 68px below it. A test keeps its text at 4.5:1 and the tone 0.2 further from the page than the selected one. The player's mini bar and desktop dock use `surface-container`, as the navigation does, so the two read as one tonal block in both themes (the bar was the overlay surface, raised, with the navigation sunk under it and a hairline between them). The reading measure is `34rem`: the old `68ch` resolved to about 702px here, wider than the 592px column, so it capped nothing and summary lines ran to 85 characters. In the side column the brand mark, the New episode icon and the navigation icons start at 28px and their labels at 68px.
- Why: the third critic round found one blue meaning three things, a bar that was raised above the page over a navigation that was sunk, and lines too long to read.
- Cost: the New episode button is the loudest tonal shape on a page; the 34rem measure leaves 64px of the reading column empty on desktop.
- Rejected: a filled New episode button (it would compete with the page's one filled action, Play); a hairline between the bar and the navigation (D72 took it off the navigation).
- Amends: D72, for the New episode button and the player bar.

## D96: An empty screen is one simple illustration, a title, one line and one filled action

- Date: 2026-10-12
- Decision:
  - Every screen with nothing to show has the same four parts, centred: a spot illustration, a title (22px, regular), one muted line (about 36 characters wide) and one action, the filled `.btn-primary` pill, with a text `.btn` beside it for a second way on. The illustration is inline SVG (`components/EmptyArt.astro`, one 240 by 180 canvas): one flat focal object of two to four shapes, three tones from the theme's own roles (the accent container, a deeper step of it, the accent) mapped by classes in `styles/empty.css`, so both themes follow and nothing carries a colour attribute. It is `aria-hidden`, and forced colours hide it. A scene is 0.25 to 0.45 KB of markup; no script, no request.
  - The scenes: Today with no briefing (a cover with a play disc), an empty Library (a dashed square with a plus; New episode), a search or filter with no result (a card and a magnifier; the Library's script still writes the title and the button from `emptyCopy`, and the line under the title follows the search box in CSS, `:has(:placeholder-shown)`, so `libraryPage.ts` did not grow), offline and back online (the signal glyph cut by a slash, and the same with a check; both are in the page and `data-state` on the section shows the one that is true), 404 (a document and a pin), and a topic with no sources (the dashed square at 96px beside the existing Add source).
  - The title is the page's h1 on a page whose only content this is (Today, offline, 404) and an h2 under the Library's own title. A full-page state sits a little above the middle of the screen, and the art draws about 250px across from 64rem.
- Why: the owner asked for "beautiful empty state illustration with title and an action button", then, when the first scenes carried a ground, floating marks, a shelf, a waveform and a clock badge, "keep the illustrations simple". The scenes were redrawn to one object each; the byte count fell by half or more.
- Cost: an empty Library on a desktop shows New episode twice (the side column's and the empty state's); the Today and Library scenes could only be seen in an emptied copy of the site (the fixture build always has content), so axe never ran on them, and they are tested from the component source.
- Not done: "Nothing cleared the bar." (a banner above a briefing that is there, and a sheet result) and the player's Up next, transcript and the source panel's search have no scene; "No topics yet." on a podcast's page stays a quiet line, since the row under it is the action.
- Rejected: an illustration set as image files (a request each and no theming), an animation, a different palette for each state.

## D110: Monthly covers

- Date: 2026-10-14 (#109)
- Decision:
  - A cover dated 2026-10 or later (`MONTHLY_FROM` in `packages/cover/src/season.ts`; `isMonthly` is the one place that decides) is drawn from its calendar month's colour scheme: a small set of colours taken from the existing palettes, inside one hue family or an analogous or split-complementary set. The seed picks which scheme colour takes the ground, the figure and the type, so covers vary inside a month and a past cover keeps its colours.
  - Each kind has a set layout. Daily: a flat template (no outlined numerals or ring line art), about a third on a light ground. Weekly: the matted plate with a deep ground, its ISO week number (`W42`) and its Monday to Sunday range. On demand (a briefing on request and an episode): a round plate on a matte.
  - Harmony is enforced in code, not by review: a draw is legal only when type meets 4.5:1 on its ground and the figure 3:1 (`TYPE_CONTRAST`, `FORM_CONTRAST`; a plate 1.6:1 on its matte, the derived tints apart from both), and `assertSchemes` fails a scheme that leaves a kind with no legal draw.
  - Covers dated before 2026-10 keep production's mixed palettes, so nothing already published changes.
- Why: any cover a month makes should look intended beside the others (`season.ts`): one scheme a month and a layout per kind let a shelf read by month and kind, and a contrast rule in code keeps a random draw from producing an illegible cover.
- Rejected: the redesign of 2026-10-14 (three new layered layouts, Strata, Orbits and Facets, with a theme per month, on the unmerged branch `worktree-agent-aeb65c83279c743fc`), rejected by the owner. Its contact sheets showed Orbits busy, Facets weak and on-demand titles unreadable at 48px.

## D112: First load: preload hints, idle loading, a lazy player motion, a 109 KB budget

- Date: 2026-10-14 (the owner's first-load plan; #111, #112, #113, #115)
- Decision:
  - Every page names each module it loads at start in a `<link rel="modulepreload">` at the end of its head, added after the build by `dispatch-module-preload` (`astro.config.mjs`, `withModulePreloads` in `bundleBudget.ts`). `checkBundle` fails a page that loads a module at start without one. Links only: no inline script, every page script stays a file.
  - Code a press needs is fetched at idle (`scripts/idle.ts`), never on the press itself: the Topics editor, the vote sender, the episode actions, the Create sheet, the click cues, the player's late glyphs. A page editor whose page has a pre-ready state can load at idle instead of at start (Blocked outlets).
  - The player's eager glyph registry holds what the bar draws at first paint; `Icon` draws the rest from the full registry.
  - The player surface's motion (`playerSheetMotion.ts`) loads at idle with the open page's controls. `playerSheet` is a facade: closed at rest, as the island's markup draws it, and a call made before the motion loads waits and runs in order.
  - The first-load budget is 109 KB, about 3 KB over the heaviest page (Topics, 105.7 KB).
- Why: the bar answered 2.5 to 3 s after the largest paint on a slow phone because the island's graph was fetched one round trip at a time; hints brought it 1.1 to 1.5 s forward with LCP unchanged. A first press that waits on a download breaks D47's instant moves. A ceiling 44 KB above the code (D103) let a page grow by a third before anything failed.
- Cost: about 15 to 20 KB more script fetched at idle, by the warmed chunks' sizes (not counted by the budget, not measured as a transfer). A press on the bar before idle waits for the motion chunk, as it already waited for the open page's controls. A feature that adds first-load code now has 3 KB of room.
- Rejected: no island eager at first load (about 73 KB off every page; parked by the owner for its risk to the early Play tap, D82); loading page code on first input (a press would wait on a download); moving only `detentGain` out of scrubberMath (0 KB: the module moved to another eager chunk).

## D121: medium-chroma covers, three series on one paper

- Date: 2026-10-15 (the owner: "the color palette of the album arts is too saturated, keep it medium so it is not too much on the eye when multiple albums are viewed at the same time", and "make sure weekly and daily covers are easily distinguishable")
- Decision:
  - Every cover palette in `tokens/covers.json` sits at OKLCH chroma 0.12 or less, hue and lightness kept. Near-duplicates the lower chroma would have made (the October scheme's two terracottas and two sands) are pulled apart in lightness.
  - Each monthly series draws from its own twenty styles, picked by the cover's seed (`packages/cover/src/series/`): dailies, on-demand covers (briefings and episodes) and paper weeklies. The owner chose them from contact sheets of twenty per series and dropped a first weekly set of coloured covers in a cream frame ("drop the brick red option").
  - Every series prints on the month's paper, made from the scheme's palest colour, in the same inks (`series/paper.ts`), each on its own close tint (`SERIES_L`): weeklies palest at 0.88 in the light theme and 0.80 in the dark (the owner: "too bright on light mode, could be faintly less bright on dark mode"), on-demand covers a step deeper at 0.82 and 0.74, as the stock around an ink disc (the owner: "on-demand ones should also follow the same color theme"), and dailies a step deeper again at 0.76 and 0.68. A first cut separated the series by lightness, with dark dailies (0.55 or less); in a grid the dark and pale covers clashed (the owner: "why are some dark and some light? the albums should be in a harmony"), and the owner chose close steps over one identical paper. Covers before October 2026 keep their templates and the framed weekly.
  - Every cover prints its year after the month in medium weight, "October 2026" (a New Year week shows "2026–27"; the owner: "mention the year in all album arts in a small yet elegant place").
  - The weekly's range prints with a dash, "2 – 8 November", from that year's ISO week (the owner: "each year the week range changes ... the subtitle can be like 5 - 10 November").
  - The cover box takes the colour drawn at the cover's edge (`coverEdge`, `lib/covers.ts`), not the palette id's ground, so a pale matte or a pale monthly ground gets its rim on the light page.
  - Covers adapt to the theme (the owner: "I want the color palette to adapt to light and dark theme, have this modularity in design theme"). `tokens/covers.json` `mode` maps every drawn colour's lightness into a band per theme: light keeps covers as authored and dark fades them (inks lift to charcoal, the palest settle to parchment, chroma 0.9; the owner: "the faded ones are in dark mode, bright ones are in light mode"); `mode.ts` then holds each contrast floor again. Pages and the player show `/covers/<light|dark>/<id>-<size>.webp` by theme; the lock screen and social card keep the colours as authored.
- Why: October's scheme drew from chroma 0.16 to 0.22 colours, and a grid of them measured 107 to 134 on Hasler and Suesstrunk's colourfulness ("extremely colourful"). The weekly's matte was its own ground, so it showed only as a slightly smaller picture.
- Check: grids of every scheme measure 47 to 58 (moderately to quite colourful), 95th-percentile chroma 0.11; the worst date contrast is 4.8:1; a month's daily, on-demand and weekly grounds sit in that order at least 0.04 apart and within 0.15 of each other in OKLCH lightness, in both themes (`family.test.ts`).
- Rejected: a coloured badge or a "W" corner mark (the week numeral already says it, and it fails at the 40 px row size); a dark matte (it disappears into the dark page); a weekly mounted in a pale frame around a coloured plate (the owner dropped it for the paper set).

## D122: brighter covers, a header light read from the cover, a clean theme switch

- Date: 2026-10-16 (the owner, over a dark Library grid: "the album arts are too dull in both dark and light theme, they can be slightly brighter", "the shader color blur must be natural and not very elliptical, if there's an ambient movement that's even better. The shader color should match the colors of the album art every time", and "there is a glitch in the screen when I switch the app theme")
- Decision:
  - Every series' paper sits 0.04 to 0.05 lighter (`SERIES_L`: weekly 0.92 and 0.85, on-demand 0.86 and 0.79, daily 0.80 and 0.73, light and dark), with at least 0.03 chroma, and the dark theme keeps full chroma (`tokens/covers.json` `mode.dark.chroma` 1). Inks still lift to charcoal on the dark page. A card's progress scrim covers the bottom quarter, not 40%.
  - The header light's colours are read from the drawn cover for each theme (`coverSwatches`, `packages/cover/src/swatches.ts`: the cover rendered at 64 px with its fonts, flat colours counted by area). The light is the largest colour, then the two that catch the eye most (area weighted by chroma; dark colourless ink gives no light), each at the theme's lightness (`ambientTint.ts`).
  - The shader draws three round gaussian lights, sized and placed from the measured cover: the main colour behind the cover, the other two beside it toward the title, drifting on a 40 s loop and bent by slow noise. The layer's mask is only a fade at its four edges; the CSS layer draws the same three as circles.
  - A theme change fetches and decodes the new theme's covers on screen first (at most 400 ms), then crossfades with the bars in the page's picture (`data-theme-change`, `themeApply.ts`).
- Why: the paper at 0.68 to 0.88, under a 40% scrim, read grey. The light used `coverColors`' three roles, dropped every colour under 0.03 chroma and squeezed the field into one wide ellipse, so a beige and red cover lit the page in a faint pink smear. The other theme's cover images are lazy and `display: none`, so they were never fetched: a switch showed empty boxes filling in after the fade, while the bars, in their own view-transition groups, faded at 100 ms over a 200 ms page.
- Check: the contrast proof now sweeps every hue at every chroma up to each theme's cap (`ambientPalette.test.ts`); `family.test.ts` still holds the series' order and spacing; a screencast of a switch on Library shows every cover in both pictures and no bar ahead of the page.
- Then (2026-10-16, the owner: "the album arts can be slightly saturated as the colors are too dull"): the paper prints at 0.045 chroma or more, not 0.03, and the spot and tint 25% richer than the scheme's colour, still at most `MAX_CHROMA` 0.12 (`series/paper.ts`). The paper is nine tenths of every cover, so its grey was most of the dullness.
- Rejected: sampling the cover image in the browser (the CSS layer and the first paint would still need server colours); warming the other theme's images on every page load (twice the cover bytes for a switch made rarely).

## D125: headings never bold, a plainer Topics and sources, a floating Add

- Date: 2026-10-20 (the owner's Settings and Podcast redesign brief: "Never use bold for headers, this applies globally", "Add a new Intelligence section containing only the AI model picker", "Remove the status-type filters entirely", "Move the add action to a floating action button", "Convert type filters into a scrollable tab bar, with All as the first tab", "Wrap Weightage and Formats sliders inside an accordion", "Add swipe/pull-down-to-dismiss")
- Decision:
  - No heading is bold anywhere: the title and lead type roles are regular (D73 kept 500 for headlines; that ends), and the medium weight left on headings (a shelf head, a compact empty title, the contents title, a form's field headings, the scorecard) goes. Medium stays on labels, buttons, chips and tabs.
  - Settings group heads are the page's H2: the 22px heading role in the text colour, apart from the 28 to 32px title by size and space alone (they were 14px accent). Sections: Podcast, Intelligence (the model select alone, D123's "upfront" kept), Sound, Appearance, About. Daily and Weekly keep their short row labels; their pages are titled Daily Podcast and Weekly Podcast.
  - Topics and sources is a search and the list: no count, no format or status chips. Add is a floating button below 64rem (`AddFab.astro`, the New episode button's shape and folding; `fabFor` returns `add` so the page keeps room for it and a toast clears it); from 64rem, with the side column and no floating button anywhere, it is an outline button at the end of the search row, where a desktop toolbar puts a page's action.
  - A topic's page: Listen in sits in the card under a full-width line, its options Daily, Weekly and On Demand (was Custom; the panel's too). Its sources take a tab bar of their formats, All first, one at a time (`?format=`), shown when two or more formats are present; below 64rem the search and tabs stick under the app bar until the list ends. Add source is the floating Add below 64rem and stays beside the Sources heading from 64rem.
  - Topic weightage, Formats and Perspective are collapsed `details` groups with an H2 summary, on every page that has them: every topic with a weight now shows Topic weightage (Technology and the owner's own topics had a bare Weight row). Formats still needs two formats on the page, as one format has nothing to weigh against. Perspective shows on World and Business, as left and right is a question of political coverage, and on another general topic only while it holds a lean set before, so that lean can be seen and reset.
  - The source panel, full screen on a phone, closes when pulled down from its head or from the top of its body, past a quarter of its height or with a flick; a shorter pull springs back (`pullDismiss.ts`). No grabber is drawn (D106).
- Why: medium headings beside regular text read as shouting, the owner's long-standing complaint about weight; the 14px accent heads read as captions, not sections. Status filters answered a maintenance question the page does not need to ask on every visit. A floating Add is the phone's one primary action, and a desktop toolbar keeps the wide page's hierarchy without a floating shape over a column of rows.
- Rejected: tabs on the index (the owner: they do not belong there); a floating button on desktop; Perspective on every general topic; a Formats group for a single format.
- Then (2026-10-20, the owner on a phone: "the subsection headings and the accordion titles are too big", "the tabs are not scrollable", "I want it in a single line", "on-demand can be renamed to catch up everywhere", "a weird jump in the full screen modal ... with the Android phone keyboard visible"): H2s are 18 to 20px (the title size), not 22px. The filter's grid column takes `minmax(0, 1fr)`, so seven format tabs scroll in their strip instead of widening the page, which Chrome had zoomed out. Listen in is one line at the label size in the card. Custom and On Demand are "Catch up" in Listen in, the add panel and the Library filter. The add panel focuses its first field without scrolling while it slides, and on a phone ends where the keyboard begins (`keyboardFit.ts`: the VirtualKeyboard API's overlay in Chrome, the visual viewport in Safari).
- Check: the topics journey covers search, a format tab and their reload; the weight and format specs open their groups first; `fabFor` routes Add; a scripted touch pull closed the panel and a short one did not (not a test: touch gestures are not in the suites).

## D131: an 8pt spacing system, held by design checks

- Date: 2026-10-21 (the owner: "I don't know why you keep committing spacing problems in the UI, is it a rule or design system problem? I want to use a 8 point spacing system", "Keep 4px exceptions for granular control, but mostly 8px spacing", "Add tests or a linter to have a design system compliance check")
- Decision: the space scale is 4, 8, 16, 24, 32, 48, 64 and 96px; the 12px and 2px steps are gone (about 240 values moved: 12px became 16 between separate things and 8 inside one control). 4px is allowed only in the selectors `ALLOWED_4PX` names in `apps/web/src/styles/styles.test.ts`, each with a reason (an icon beside its label, a title onto its subtitle, a chip's or button's inner gap, a hit-area or focus offset, an optical nudge). A list row carries its own padding, so it is spaced the same in a page, a panel or a sheet. Headings are never medium or bold. `npm run design-check` runs the static rules (the 8pt grid, regular headings, no inline style that bypasses the tokens) with the token tests in seconds; `e2e/designSystem.spec.ts` reads the computed spacing of every element on every page and in the open player, the Add source panel and a Library menu, and fails off the 4px grid without pinning any value. AGENTS.md makes both a step of any UI change.
- Why: the old scale offered 2, 4 and 12px beside the 8pt steps, so each new surface picked whatever looked right in its own context, and spacing applied by a parent selector vanished when a row moved into a panel (the cramped suggested sources). No test read spacing at all.
- Rejected: dropping 4px entirely (small controls read loose); pinning measured gaps in browser tests (AGENTS.md forbids pinned geometry; the grid invariant catches the class of bug without it).
- Check: each static rule was shown red on a probe; the sweep passes on every page, both widths.

## D132: two segmented controls, and Close at the end of every sheet

- Date: 2026-10-21 (the owner: "I need two types of segmented selector component, one for selection duty with a check, another for navigation, used like tabs. Make them visually distinct. The topic page should use the latter", "In full screen modals with the X, have it on the right side. Change it in the parent component")
- Decision: `.segmented-choice` (a radiogroup: one outlined pill split by hairlines, the chosen segment in the accent container with a check) is for picking a value: the New episode form's Length, Look back, Format and Tone. `.segmented-nav` (a tablist: a tonal track with a raised pill that slides under the active label, no check, arrow keys) is for switching what shows below: a topic page's Sources and Preferences, and the add panel's Topic and Source. A style rule keeps radiogroup markup on the first and tablist markup on the second. `SheetHeader.astro` gives New episode, Add or Edit source and Regenerate one header: the title at the start and Close at the end, as the bottom sheets already were; focus order follows.
- Why: one look for two jobs made a view switch read as a setting, and three copies of a sheet header had drifted from the bottom sheets' layout.
- Check: the style rule was shown red first; the topics, create and episode actions specs cover both controls and the headers.

## D141: a 130 KB first-load budget

- Date: 2026-10-21 (the owner: "Increase bundle size to 130kb")
- Decision: `FIRST_LOAD_BUDGET_BYTES` is 130 KB of gzipped JavaScript per page (from 109 KB, D112). `checkBundle` still fails any page above it; the heaviest page is 109.0 KB.
- Why: at 109 KB every feature that adds first-load code needed a cut first; the fault reporter and the player's tabs had used the last bytes.
- Cost: about 21 KB of headroom is roughly a fifth more script to fetch and parse on a slow phone before the page answers, if it is all used.
- Revisit if: the heaviest page passes 120 KB, or INP or LCP on a real phone gets worse.

## D144: phone sheets close by gesture and show no Close

- Date: 2026-10-21 (the owner: "All bottom sheets must be swipable down without x, and should be dismissed when clicked outside the bottom sheet")
- Decision: below 40rem every sheet built from `SheetHeader` or `.sheet-head` (the ⋮ menu sheets, the Library card sheet, the Create sheet, Add source and topic panels, the rewrite panel, the passphrase sheet) shares `scripts/pullDismiss.ts`: a pull from the header, or from the content once scrolled to its top, moves the sheet; a release past a quarter of its height or a flick closes it, a shorter pull springs back; a dialog closes on a tap on its scrim, a popover by light dismiss. Reduced motion skips the follow, not the close. The Close button is visually hidden on a phone (sr-only styles, still focusable); Escape works as before. From 40rem the close controls are as D132 left them. The React sheets (Base UI Drawer) already swiped and closed on the scrim, so they only lose the visible Close. The grabber stays removed (D106).
- Why: a visible X on a phone is a reach and a second way to do what a swipe does.
- Amends: D132 (one header with Close at the end, now visible from 40rem only).

## D152: a full-screen phone sheet shows its Close

- Date: 2026-10-22 (the owner, on the visual audit's item 8: full-screen sheets show the X on the right, as on desktop; partial bottom sheets keep none)
- Decision: below 40rem a sheet that fills the screen (`dialog.create-sheet`: New episode, the topic and source panel, Regenerate) shows its Close at the end of its header row, as from 40rem. The partial sheets (the menu sheets, the emoji picker, the React drawers, the passphrase sheet) keep D144: no visible Close, a pull or a tap outside closes them. Pull to dismiss stays on every sheet. One selector in `create-sheet.css` under `SheetHeader.astro`.
- Why: a full-screen sheet leaves no page showing to tap away to, so the only visible way out was a gesture with no affordance.
- Amends: D144.

## D161: a story's publisher sits above its headline

- Date: 2026-10-23
- Decision: in a briefing's story and an episode's highlight, the publisher's quiet link (muted, label size, its open-in-new glyph) is a line of its own above the headline, shortened only when wider than the column. The row under the text holds the Play chip and the story controls, on one line at every width.
- Why: in one row with the chip (112px, sized for "Play again") and three 44px controls, the publisher kept about six letters at 360px and one at 320 for every name in the fixture (measured 2026-10-23). The owner chose the order a news list uses over a cut name or controls wrapping to an orphan line.
- Rejected: the name cut with an ellipsis in the row (the owner's first call, 2026-10-22, before the measurement); dropping its glyph on a phone (about three letters more); a row that wraps (the orphan controls the owner had asked to remove).
- Amends: D31's type rule that a quiet line goes under its title, never above it, for the publisher alone.
- Revisit if: the chip and the controls narrow enough to hold a whole name beside them.

## D167: one control has one shape wherever it stands, and every list is a bottom sheet on a phone

- Date: 2026-10-23 (the owner: "different types of drop-down and chips with different radius, that shouldn't be possible in a design system unless requested"; "some dropdowns have a blue flash on click on phones and not others"; "most of the drop downs on phone should be using a bottom sheet"; "the chevron optically aligns with the search bar")
- Decision: A chip, a select chip, a select's value, a segmented control and the search field are pills everywhere, in a card as on the page. The three concentric overrides of 2026-10-22 go: `.card-group` chips and select values (`primitives.css`), the Costs card's chips (`costs.css`, which also kept a chevron 8px from the end; it now shares the Library chip's 16px), and the topic panel's switch, field, Add and chips (`topics.css`), with the Listen in value. A row's tile and a button keep the concentric radius (`.card-group .btn`, `.row-action::after`), and a form's text fields keep `--field-radius`: the Add source panel's selects stand beside text inputs and follow them. Under 40rem every list that opens from a field is a bottom sheet with the sheet's corners, surface and scrim: a select's drawn list (`::picker(select)`, CSS alone), the searchable picker (`picker.ts` sets `data-sheet` and lets CSS place it) and the multi-select (fixed in place; the card around it rises to `--z-sheet`). A select and an input lose the tap highlight (`foundations.css`): the flash showed on native selects and not on the buttons beside them. A Sources row and a source row take the search field's 16px inline padding, so the emoji and the chevron sit where the field's glyph and clear button do; the chevron is no longer pulled out to the edge.
- Why: the concentric rule gave one chip three radii (pill on the Library, 8px in a card, 8px in the topic panel) and one select chip two, which read as different components; the owner saw it on the phone a day after choosing it. A phone's anchored popover under a value is small and far from the thumb; the More menu is already a sheet there.
- Cost: a popover's backdrop lets a tap through, so a tap on the scrim can also press what is under it (as the More menu's can); the multi-select is not a popover, so its sheet is drawn inside the card's layer and the card is lifted over the navigation bar while it is open. `lightningcss` rejects `::picker(select)::backdrop` and fails the build, so the select sheet's scrim is a spread of its shadow (`0 0 0 100vmax`).
- Rejected: making the multi-select a popover with anchor positioning (desktop placement would need anchors in every engine, or JS); pills for the panel's text fields (a textarea pill); a scrim-less sheet.
- Amends: the card rule of 2026-10-22 (D72's tonal language, [ledger](../design-engineering-ledger.md) section 1) for chips, select values and segmented controls.
- Revisit if: Firefox and Safari draw the select list natively on phones (they keep the system picker, which is a sheet of its own), or a tap on the scrim reaches a control under it in use.

## D171: covers take a step of colour: chroma to 0.16, the light stock deeper and tinted

- Date: 2026-10-23 (the owner: "the album arts of the podcasts are very dull, they need to be refreshing in all themes but still be optimized for dark and light theme")
- Decision: `MAX_CHROMA` rises from 0.12 to 0.16 and every palette's ground and accent in `tokens/covers.json` carries 1.4 times its chroma, capped there (text roles unchanged). The monthly paper (`series/paper.ts`) reads as a coloured stock: its least chroma 0.045 to 0.09, its inks 1.4 times the scheme's colour (was 1.25), and the light theme's stocks a step deeper (weekly 0.92 to 0.88, on-demand 0.86 to 0.81, daily 0.80 to 0.74 in OKLCH lightness); the dark theme's stocks stay, since the dark page already carried full chroma. Every contrast floor is still held by the code and the family tests; the site's cover cache key hashes the renderer and the palettes, so the next build redraws every cover.
- Why: D121 answered "too saturated" on 2026-10-15 with a 0.12 cap and pale papers; eight days of the October paper read as dull on the phone. The paper is nine tenths of each cover, so its tint and depth move the grid more than any ink.
- Cost: a grid of a month is more colourful than D121 measured for (its colourfulness check is not rerun here); the owner's "too bright on light mode" weeklies are a step deeper, not brighter. One hue family a month is still the scheme's rule, so variety across a month comes from the forms, not the hues.
- Rejected: more hues per month (D121's harmony); a different paper per series (the owner chose close steps).
- Amends: D121 (the cap and the stocks' lightness).
- Revisit if: the owner judges the October grid on the phone in both themes; the contact sheet (`npm run covers:sheet`) is the review aid.

## D186: every control is a pill, text fields and a card's buttons too

- Date: 2026-10-24 (the owner, on the edit source panel: "all the ui elements as much as possible should have fully rounded corners to be consistent")
- Decision: `--field-radius` is the pill, so every one-line text field and every form select that follows it (the Add and edit source panels, Blocked sources, the sheets) is round like the buttons, chips and selects beside it. A multi-line field takes `--field-radius-multiline`, 24px, half a field's height, so its corners draw the one-line field's arc. A button in a card is a pill (the concentric `.card-group .btn` override goes), the floating button is a pill (a circle folded) (owner, 2026-10-24: "only to the components that make sense"). Page row tiles are #295's (`--row-tile-radius`).
- Why: D167 left text fields at 8px and a card's buttons concentric, so an 8px Name field stood over pill selects in one panel; the owner read it as two languages.
- Rejected: a pill textarea (it clips the first and last lines' corners); rounding containers (cards, sheets, menus, toasts, banners, covers), which are surfaces, not controls.
- Kept for the owner's call: the Create Title (a filled field with round top corners over its D54 bottom line), menu and list option tiles inside a popup or sheet, checkbox squares (round reads as a radio), the mini player's open target, the emoji grid's cells (a wide cell would hover as a pill).
- Amends: D167's text-field and card-button rules.
- Revisit if: a pill field's text or placeholder reads cramped at its start.

## D187: a glyph that ends a row lands its ink on the row's end, not its box

- Date: 2026-10-25 (the owner, on Blocked sources: "so many ui elements that are not aligned optically on both sides of the screen - fix them all and check if other screens also have this to fix it at the source of design system")
- Decision: words and bare glyphs align by their ink; a filled or outlined control (a field, a select chip, a segmented track, the sample disc) aligns by its edge. Each Phosphor glyph's ink margin is measured once (`getBBox` on its path) and set as `--ink-end` on the glyph and on what holds it (`buttons.css`; `Icon.astro` writes `data-icon`). A row's chevron, a value select's chevron, a settings multi-select's chevron, Create's More options chevron, and `.icon-btn-end` (the Blocked row's cross, a topic card's More) pull out by it; the voice sample's disc meets the row's end. Measured at 390 and 1280px on Settings, Daily, Weekly, Voice, Blocked sources and a topic page: every row-end glyph's ink 24px in from the card's edge, where the words end (before: 24 to 39.5px, the select chevrons 3px and the cross 6.5px short).
- Why: the chevron's 0.28 pull fitted one glyph only; a chevron down, a cross and the More dots sit further inside their boxes, so each ended a few pixels short of the line the words make.
- Rejected: pulling the More dots on Today's story rows and hero, and the Library's view buttons, to the 16px page edge (their 44px targets would leave the screen); moving the topic page's source list, which lines up with its search field's glyph (owner, 2026-10-23).
- Revisit if: a glyph outside the table ends a row (add its measured margin).

## D188: a list a script redraws takes its sheet header and icons from the same source as the pages

- Date: 2026-10-25 (the design-system audit; the owner: "I see too many deviations - especially in the structure tab").
- Decision: `apps/web/src/lib/sheetHead.ts` holds the markup of a sheet's header row and of an icon; `SheetHeader.astro` renders it, and any list a script rebuilds (`structureView.ts`) calls it. A menu a script builds is `MenuSheet.astro`'s menu: the header, and each item with its glyph at the start. Every glyph carries `data-icon`, so D187's ink margins reach it. A row that cannot act says `data-quiet` (settings.css) rather than a page recolouring `.settings-label`; tabs in a card are `.tabs-in-card`; a multi-line field's ceiling is `--field-max-height-multiline`.
- Why: the Structure view copied the menu sheet by hand, lost the item icons and the D187 alignment, and placed its glyphs with negative margins; each copy is a place the system drifts.
- Rejected: server-rendering the menus once per row (the list is rebuilt after every edit, so the client needs the markup too).
- Revisit if: a second script-drawn list appears (then `MenuSheet.astro` should also render through `sheetHead.ts`).

## D189: the design catalogue is a route of the site, not a tool

- Date: 2026-10-25 (the owner: "I need a simple storybook kinda tool/page to visualize all the tokens, typography, colors, ui components"; and "shouldn't we have a different ui repo?").
- Decision: `/design` (`apps/web/src/pages/design/[...slug].astro`) lists the tokens from `tokens.json`, the type roles, the colour roles as live swatches, every glyph, and each shared component drawn by its own class, with the usage comment over that class read from its stylesheet at build time (`lib/designCatalogue.ts`). It is built in dev and in the fixture build only (no static path otherwise), sits in the browser suites' page list, and no separate UI repository or package is made.
- Why: one consumer and one person; a catalogue rendered by the CSS the app ships cannot drift from it, while zeroheight, Supernova or a Storybook (the community Astro framework is the only one that renders `.astro`) are a second source of truth kept by hand. A separate repository buys versioning and publishing work for no second consumer.
- Rejected: Storybook with `@storybook-astro/framework` (a second build and dev server, a story per component); zeroheight and Supernova (Figma sync and team governance this project does not have); Backlight (shut down 2025-06-01).
- Revisit if: a second app consumes the styles (then lift them into a workspace package under `packages/`), or the catalogue needs knobs and isolation per state (then try Storybook on a branch first).

## D195: settings subpages show a Settings breadcrumb

- Supersedes: the no-breadcrumbs clause of D129 (the rest of D129 stands).
- Context changed: D129 dropped breadcrumbs as repeating the title and app bar; the owner found a subpage gave no quick way up to the Settings index.
- Date: 2026-10-25 (the owner's ask).
- Decision: each settings subpage has a small "Settings /" line above its title (`.settings-crumb`), a `.text-link` with a 44px target.
- Why: one tap up beats the app bar's back, which can leave settings.

## D223: motion gets six spring tokens from Material 3 Expressive, adopted a moment at a time

- Date: 2026-10-29 (the owner: the app has M3's structure but none of Expressive's motion; "I'll start conservative and show me some visuals").
- Decision: `tokens.json` holds six `linear()` springs, `--ease-spring-spatial-{fast,default,slow}` (stiffness 800, 380, 200; damping 0.6, 0.8, 0.8) and `--ease-spring-effects-{fast,default,slow}` (3800, 1600, 800; damping 1), each with a `--duration-spring-*` total. Spatial springs move and reshape and may overshoot (9.5% fast, 1.5% the others); effects springs fade and recolour and never pass their target. Reduced motion collapses the spatial durations and keeps the effects ones, as it does for fades. `scripts/springCurve.ts` draws the curves; `buildTokens.test.ts` re-derives each from the stiffness and damping its token records. No component uses them yet; the three older springs (settle, release, pop) stay.
- Why: a fixed pair of numbers per speed, with a physical meaning, lets every later component inherit one motion language; CSS `linear()` needs no library.
- Rejected: adding a spring library (the tokens and the existing `spring.ts` cover transitions and gestures); one token per component (they would drift).
- Revisit if: the owner approves the Play morph, wavy scrubber and morphing loader; each then lands in its own design-system PR and may retire an older spring.

## D224: the admin pages become a command center app, the style guide its own app

- Date: 2026-10-29 (the owner opened `/design` on the live site and got "Page not found", then: the admin pages "should not be part of the Singularity app visually anymore ... its own dashboard, separately", the style guide "on its own", `news.someshks.work/design` and `/admin`).
- Decision: `apps/admin` (the command center: Coverage, Costs, Health, later Sentry and analytics) and `apps/design` (the style guide: colour, type, tokens, atomic components with live states, search) are two Astro apps in this repo, each its own Vercel project and reached at `/admin` and `/design` by rewrites in the reader's `vercel.json`; each carries its path as its Astro `base`. Both are drawn with the reader's own stylesheets and shell classes, so they look like it. Costs and Health leave the reader and Settings when the command center has them (their old addresses redirect). The command center reads the reader's `/api/costs` and `/api/health` until the data code moves into a package; `/admin` is gated in the app (Vercel protection cannot guard a project reached through a rewrite): an owner password and a signed cookie, run as Routing Middleware, shut when its two variables are missing; Google login later. Each component gets a `*.design.ts` spec beside it in `apps/web`. Plan: `docs/design/command-center.md`.
- Why: a route inside the reader shares its chrome, bundle and keys; separate deploys keep both apart while one domain keeps the owner's addresses and his theme choice (same origin).
- Rejected: a separate repository (D189: one maintainer, no second consumer); `/admin` routes inside the reader (PR #420, closed); subdomains (not the addresses asked for); Storybook (D189).
- Revisit if: the data code moves into a package (then remove the reader's routes), or a second consumer of the components appears.
- Supersedes: the route half of D189 (`/design` inside the site); its no-separate-repository and no-Storybook rulings stand.
- Context changed: D189 said a second app consuming the styles would lift them into a package. D224 adds that second app and defers the package: the apps import the reader's files by relative path until that hurts.
