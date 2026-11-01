# Small component fixes

Ledger section 3, one surface. Read [the core](../design-engineering-ledger.md) first (taste in section 1, how to work in section 2, the phone in section 11). Each row: the ask, what was built, the decision; if a decision and a row disagree, the decision wins.

## Small component fixes

The craft that makes components hold still and answer clearly. Each was a reported or measured defect.

- **Nothing changes width or jumps.**
  - The play chip keeps one width (7rem), so the publisher beside it never moves (D92). Played shows Play again only under a mouse, at a held width (D106, #116).
  - A filter chip's and a segment's check takes no room; the label slides by half of it (D95, 2026-10-11).
  - The segmented thumb slides only while used, so a page never opens with motion (`player.css:2254-2304`).
  - The scrub bubble and the bar's times sit over a hidden copy of the widest time and snap to device pixels, so digits do not shimmer (2026-10-11).
  - Toasts have a fixed width on a phone (they jumped from 105 to 358px).
  - A stable scrollbar gutter stopped the New episode panel rewrapping when More options opens (D102).
  - Rows keep one height with or without a search match (D95). The Add panel's switch keeps one height at every width (D89).
  - The first frame of an episode page drew the first story, then the current one. The page now derives `override ?? first` instead of holding the first in state (2026-10-09).
  - A sticky element centred with `translate: 0 -50%` blurs on odd heights; use a measured `calc()` offset (2026-10-12).
- **Visibility.** `[hidden]` lost to author `display` rules, so hidden elements showed. A global rule keeps it hidden (`foundations.css:158`) and a test walks every page (2026-10-08).
- **Fields and selects.**
  - One drawn list for every select (`appearance: base-select`, set once in `primitives.css`).
    - The text is centred with no UA block padding (2026-10-10).
    - The list opens below its field when it fits, and a phone in landscape still shows more than three rows.
  - The same gap between a value and its chevron (`--field-chevron-gap`), and equal padding in multi-line fields (D106).
  - The model field is as wide as its name, so the hover fill hugs the words (D103). A longer name ends in an ellipsis, not half a name (D91).
  - A field grows on focus only with a fine pointer, so it never moves under a tap (2026-10-12).
  - An open list lifts its row above the next one (`.rows > :has([aria-expanded="true"])`, 2026-10-11).
  - A list that fails to load says so inside the open list (2026-10-12).
  - The ask for lists: "styled better in the same theme and... consistent with good padding on the top and bottom" (2026-10-09). Equal inner padding top and bottom, on the page's surface.
  - The model field is a plain select, never a combobox. Its list has Top and All groups; the switch deleted 640 lines (2026-10-13, `primitives.css:487`).
  - A searchable picker is placed once, so it closes on any scroll (capture, passive) and takes its `transform-origin` from the trigger's centre (`picker.ts:198`, `:315`). In forced colours its search field keeps a system border (`picker.css:109`).
  - The cadence select clipped "Every second day"; fields are sized to their longest value (2026-10-09).
  - Under 40rem every list that opens from a field is a bottom sheet (D167): a select's drawn list through `::picker(select)` in CSS alone, the searchable picker (`picker.ts` sets `data-sheet`), the multi-select (fixed in place, its card lifted over the navigation bar). The scrim is a spread of the sheet's shadow where the list has no usable backdrop. A select and an input have no tap highlight (`foundations.css`).
- **Press, hover and focus.**
  - Words never shrink on press; label controls show a press on their fill (2026-10-10, `styles.test.ts`).
  - The compact segmented navigation (`.segmented-nav-compact`) sits in a row of chips: a chip's height on 44px columns, a layer above and below its 36px face for a 44px target, and its track's tone from `--segmented-nav-bg` (the overlay on a card). It was drawn in `costs.css` until the design audit found its tabs answering across 36px (2026-10-24).
  - A segmented tab that holds a glyph centres it (`.segmented-nav-tab:has(> .icon)`): Costs' chart and table glyphs sat at their tabs' start, off the pill, because a block glyph ignores text-align (owner: "the graph, table switcher is broken", 2026-10-24).
  - A segmented control's chosen item takes a full outline or container, never only a bottom border: the Gallery and List switch "shows only a bottom border" (2026-10-09).
  - Two targets in one card look different under a mouse: "there is a distinction between clicking on the thumbnail... versus clicking on the text... That distinction is necessary" (2026-10-12, D101).
  - Remove buttons in lists show on hover or focus with a mouse and always on touch (2026-10-08).
  - A focus ring inset into its row stops clipping inside overflow containers (2026-10-08).
  - Hover layers are the fill's own alpha, so a focus ring is never faded (2026-10-11).
  - A colour transition runs on the hover state only, so a theme switch never shows a mid-fade colour (2026-10-12).
  - A ring on a two-line headline is drawn round the block, not per line (D88).
  - Typing in a field does not switch to the keyboard ring (D93).
  - 44px targets drawn with `::after` subtract the hairline: a 36px button with -4px reached only 42px (#116).
- **Glyphs and art.**
  - The plus and the More dots were too thin. Now Phosphor bold, with More as three drawn circles of radius 20 (2026-10-10).
  - Icon swaps scale from 0.95, not 0.6 (2026-10-11 audit).
  - The transport: previous and next take the skips' Phosphor regular outline at their size, so the four helpers are one family and Play the one fill (2026-10-22).
  - Latest is Phosphor FireSimple, rest and current: a plain outline with no inner lick, as "simple outline ones and not have inner details" asked (D133; built 2026-10-22 in `tokens/glyphs.json`).
  - Covers are `draggable="false"`, so a mouse flick closes the player instead of dragging an image (2026-10-10).
  - A cover that cannot load shows its palette, never the broken-image glyph (D93).
  - A headline keeps a hyphenated word whole with `inline-block`, so `text-wrap: balance` still works (D93).
- **Rows and lists.**
  - Settings rows hover as rounded tiles clear of the hairlines, like the model list's options (2026-10-11).
  - Hairlines run full-bleed past the gutters.
  - One row height per kind: 72px for sources (D89), 88px for suggestions from 40rem (D91).
  - The Generate bar's line shows only while the bar is really stuck (D87).
  - The section strip is opaque, so text never shows through under it (D88).
  - List edges fade only where more content exists (`player.css:2087-2173`); the create sheet's body fades 32px above its sticky foot the same way, by a scroll timeline (2026-10-22). A sideways scroller takes the shared `.scroll-fade-inline` (`primitives.css`, 2026-10-24, the Costs table first), 32px or its `--scroll-fade-size`; the section tabs and the Earlier shelf (40px) dropped their own copies for it the same day. A scroller that fits, or a browser without scroll timelines (Firefox before 159), shows no fade: the old copies rested with a fixed end fade there. A scroller a keyboard must reach is a tab stop only while it overflows, and its ring is drawn on its parent, since the mask clips its own (the Costs table, axe `scrollable-region-focusable`, 2026-10-24).
  - A source tile's hairline edge is drawn on `.source-icon::after`, so a loaded icon keeps it (2026-10-22).
  - The rail's rows keep 8px apart and each hit area reaches 4px into the gap, so a pointer never falls between them (2026-10-22).
- **Speech and status.**
  - One element speaks each message: a polite region, an alert region for errors, and a toast with no role (2026-10-10).
  - The live region stays quiet whenever a visible notice already speaks (D90).
  - The spoken word's fill appears at once, and only the leaving word fades (D105).
