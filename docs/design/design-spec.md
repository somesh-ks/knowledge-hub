# Dispatch design spec

> The canonical UI specification. Two implementers build the web app from this file, [tokens.json](../../tokens/tokens.json), [foundations.css](../../apps/web/src/styles/foundations.css) and the prototype. Sound is specified in [sound-design.md](./sound-design.md).
>
> Visual reference: [ui-prototype.html](../prototype/ui-prototype.html), a working prototype built on the real tokens, the real foundations stylesheet and the real sound engine. Its component CSS, [ui-prototype.css](../../scripts/prototype/ui-prototype.css), is the source for every value below. [Screenshots](./screenshots) show each state. Hosting is Vercel; the Cloudflare mentions in the build plan are stale for design purposes.

When a number appears here, it comes from a token. When this file and the prototype disagree, the token wins, then the prototype, then this file; open a fix.

## 1. Design intent

Dispatch is a private briefing for one design engineer. About twelve items every second day, read in two minutes or heard in four. The job, in order: scan on a phone in under three minutes, listen hands-free, say what was wrong in one sentence.

### The one memorable thing

The rail. A single line runs down the page, and it is three things at once: the table of contents (a node per chapter, a node per item), the reading position, and the audio scrubber. Press play and the line fills, continuously, at the pace of the voice. Tap the line and the voice jumps. Open the player and the same line reappears, horizontal, as the scrubber, with a tick for every item and the same current node as its thumb. The Generate sheet uses it a third time as the progress list. One object, learned once, used everywhere.

The second expressive element is the cover: a generated, album-style square for each briefing. It appears in the hero, the mini player, the archive and the expanded player, and the expanded player takes its accent color from it. Everything else is deliberately quiet: no cards, no dividers between items, no decoration.

### Design values

| Value | In practice | Source |
| --- | --- | --- |
| One strong idea, quiet everything else | One accent, one rail, one cover. No gradients, no ornament | frontend-design: spend boldness in one place |
| Scan first | Titles keep full ink, summaries step back while listening, spacing groups instead of lines | visual-hierarchy; better-layout: group with space |
| Physical rules | Surfaces have elevation, motion has springs, controls respond on press, not release | apple-design; DESIGN.md: treat the product as having physical rules |
| Honest copy | Sentence case, plain verbs, errors say what happened and what to do | config/voice.md; frontend-design: writing in design |
| Defaults refused | No cream, no italic accent word, no numbered section labels, no monospace eyebrows, no pill buttons, no all-caps labels, no middle-dot meta strings, no gradient washes, no uniform radius, no grey shadows, no terracotta | CLAUDE.md persona |

### What changed from the first prototype

| Before | After | Why |
| --- | --- | --- |
| Rail filled in steps per item | Fills continuously between item nodes, by time | Build plan 8.3: with a real timeline the rail fills inside an item |
| Item dimmed by opacity 0.66 | Summaries change color to the muted text token; titles stay full ink | Opacity broke contrast on muted lines; color keeps every line above 4.5:1 and keeps titles scannable |
| 36px circle play buttons, pill-like CTA | Rounded squares everywhere, circles only for data marks | Circles are reserved for items and the scrubber thumb, so a circle always means "a position" |
| Weights 650, 680, 770, 780 | Four weights: 400, 500, 600, 700 | refactoring-ui: two weight tiers, no values off the scale |
| Hover on touch, `transition: all`-style shorthand | Hover gated to fine pointers; every transition names its properties | DESIGN.md; emil-design-eng |
| Passphrase error in accent color | Danger color with an icon and text | Color is never the only signal; accent means "interactive or current", not "wrong" |
| Items listed with a "Why it matters." label | "Why" label, no claim of mattering | config/voice.md: the why line never says that something matters |
| Fonts from Google CDN | Self-hosted variable subsets with metric-matched fallbacks | Build plan 8.2; no layout shift |

## 2. Color

OKLCH throughout, in three tiers, light and dark. Source: [tokens.json](../../tokens/tokens.json), compiled by `scripts/buildTokens.ts` to `tokens.css`.

### Tiers

| Tier | Contains | Rule |
| --- | --- | --- |
| Primitive | Raw ramps: fog (cool neutrals), berry (accent), green, amber, red, blue, shadows, scales | Never read by a component. Color primitives are invisible to component CSS |
| Semantic | Roles: surface, text, border, accent, status, shadow. Each carries a dark value | The only color layer components read |
| Component | Sizes, radii, bindings such as `--mini-player-bg` | Aliases semantic tokens. Scale families (space, radius, type, motion) are consumed directly because the scale is already the semantic layer |

Dark mode swaps semantic tokens only. It applies under `prefers-color-scheme: dark` unless `data-theme="light"` is set, and always under `data-theme="dark"`. The theme preference has three values: system, light, dark. The surface is the status-bar tint on Safari 26, so the header carries an opaque background.

### Neutrals: fog

Cool, slightly blue neutrals at hue 240 to 250 with chroma tapering to 0.036 in the mid tones. Not cream, not grey.

| Step | OKLCH | Light use | Dark use |
| --- | --- | --- | --- |
| 50 | 97.6% 0.006 240 | Page surface `#f4f8fb` | Primary text, `#f4f8fb` |
| 100 | 94.6% 0.010 240 | Wells, hover fill | Inverse surface (toast) |
| 200 | 90.5% 0.014 242 | Hairline | n/a |
| 300 | 83.5% 0.020 245 | Track | Secondary text |
| 400 | 72% 0.028 248 | Unplayed ticks, nodes | Tertiary text |
| 500 | 60% 0.034 250 | Control border, disabled | Control border, disabled |
| 600 | 49% 0.036 250 | Tertiary text | Unplayed ticks |
| 700 | 40% 0.036 250 | Secondary text | Track |
| 800 | 29% 0.026 250 | n/a | Overlay surface, hairline |
| 850 | 25% 0.024 250 | n/a | Raised surface |
| 900 | 21.5% 0.022 250 | Primary text | Sunken surface |
| 950 | 17.5% 0.020 250 | n/a | Page surface `#0a1119` |

### Accent: lingonberry

Hue 14, on the crimson side of red. Terracotta lives at hue 35 to 50; a test keeps the accent between hue 5 and 25.

| Role | Light | Dark |
| --- | --- | --- |
| `--color-accent` | berry 600, `#ab2442` | berry 400, `#f36d7f` |
| `--color-accent-hover` | berry 550, `#c2314f` | berry 300, `#f99da5` |
| `--color-accent-pressed` | berry 650, `#9a1b39` | berry 450, `#e5586e` |
| `--color-accent-subtle` | berry 50, tint behind the current row | berry 900 |
| `--color-on-accent` | white | fog 950 |

The dark accent is lighter and slightly less saturated than the light accent, which keeps contrast above 4.5:1 on dark surfaces without glowing (dark-mode-design: desaturate and lighten accents).

### Semantic roles

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-surface` | fog 50 | fog 950 | Page |
| `--color-surface-sunken` | fog 100 | fog 900 | Wells, inputs, segmented track, hover fill |
| `--color-surface-raised` | white | fog 850 | Sheets, dialogs |
| `--color-surface-overlay` | white | fog 800 | Mini player, popovers |
| `--color-surface-inverse` | fog 900 | fog 100 | Toast, scrub bubble |
| `--color-on-surface` | fog 900 | fog 50 | Primary text |
| `--color-on-surface-muted` | fog 700 | fog 300 | Secondary text |
| `--color-on-surface-subtle` | fog 600 | fog 400 | Tertiary text, never lighter |
| `--color-on-surface-disabled` | fog 500 | fog 500 | Disabled controls only |
| `--color-border-hairline` | fog 200 | fog 800 | Decorative dividers |
| `--color-border-control` | fog 500 | fog 500 | Input and control boundaries, 3:1 |
| `--color-track` | fog 300 | fog 700 | Rail and scrubber track |
| `--color-track-strong` | fog 400 | fog 600 | Unplayed ticks, upcoming nodes |
| `--color-scrim` | 18% 0.03 250 at 42% | 8% 0.02 250 at 60% | Behind sheets |
| `--color-image-outline` | black at 10% | white at 10% | 1px outline on covers |
| `--color-focus-ring` | accent | accent | Focus outline |
| `--color-focus-gap` | surface | surface | Inner focus layer; raised surfaces override it locally |

Dark surfaces rise by lightness: page 17.5%, sunken 21.5%, raised 25%, overlay 29%. A test asserts the order. Shadows in dark mode are mostly black with a 1px rim highlight, because depth in dark UI reads from lightness, not from cast shadow.

### Status colors

Never the only signal: each is paired with an icon and text.

| Status | Text and icon, light | Tint, light | Text and icon, dark | Tint, dark | Used for |
| --- | --- | --- | --- | --- | --- |
| Success | green 600 | green 50 | green 300 | green 900 | "Briefing ready", bot check passed |
| Warning | amber 700 | amber 50 | amber 300 | amber 900 | Offline, stale briefing |
| Danger | red 600 (hue 28) | red 50 | red 300 | red 900 | Wrong passphrase, failed run, load error |
| Info | blue 600 | blue 50 | blue 300 | blue 900 | "Nothing cleared the bar." |

Banner body text stays on-surface or on-surface-muted. Only the icon takes the status color, so grey-on-color never happens (refactoring-ui hard rule 1).

### Contrast, measured

Computed by `scripts/colorMath.ts` and asserted in `scripts/buildTokens.test.ts` for both modes.

| Pair | Light | Dark | Requirement |
| --- | --- | --- | --- |
| Primary text on surface | 16.3 | 17.7 | 4.5 |
| Muted text on surface | 8.6 | 11.4 | 4.5 |
| Tertiary text on surface | 5.8 | 7.7 | 4.5 |
| Tertiary text on sunken | 5.3 | 7.1 | 4.5 |
| Accent on surface | 6.4 | 6.6 | 4.5 as text |
| Accent on sunken | 5.9 | 6.1 | 4.5 as text |
| Accent on accent tint | 6.2 | 5.7 | 4.5 as text |
| On-accent on accent | 6.9 | 6.6 | 4.5 |
| On-accent on hover state | 5.5 | 9.4 | 4.5 |
| On-accent on pressed state | 8.1 | 5.4 | 4.5 |
| Control border on surface | 3.7 | 4.8 | 3 |
| Control border on raised | 3.9 | 4.1 | 3 |
| Status text on its own tint | 6.1 to 6.6 | 7.3 to 8.6 | 4.5 |

axe-core finds no WCAG 2.2 AA violation in 20 prototype states (10 screens, light and dark), including color contrast.

### Cover palette accent flow

The expanded player takes its accent from the digest's cover palette. The cover agent owns `tokens/covers.json`; the contract this app needs from each palette is one **key color**: the palette's most chromatic color.

The web app sets it on the player panel:

```html
<div class="player-panel" data-cover-key style="--cover-key: oklch(74% 0.13 330)">
```

Then, in the panel scope:

| Derived | Rule | Why |
| --- | --- | --- |
| `--player-key` | Light: `oklch(from var(--cover-key) 0.5 min(c, 0.17) h)`. Dark: lightness 0.78 | Lightness is pinned per mode so the accent always clears 3:1 against the sheet, whatever the palette. Hue and chroma come from the cover |
| `--color-cover-accent` | `var(--player-key)` | Scrubber fill and thumb, played ticks, main play button, selected speed, current chapter marker |
| `--color-on-cover-accent` | The semantic on-accent | Glyph on the main play button. Check: at lightness 0.5 white reads above 4.5:1; at 0.78 fog 950 does |
| `--player-surface` | `color-mix(in oklch, var(--cover-key) 5%, var(--color-surface-raised))` | A flat 5 percent tint of the raised surface. Not a gradient |
| `--color-focus-ring`, `--color-focus-gap` | Player key and player surface | The ring matches the player's own accent |

Fallback when no key is set: the app accent. A key color of very low chroma (a grey palette) yields a grey accent, which is acceptable because the lightness pin keeps it legible. Derive the key in CSS, not in script. Relative color syntax runs in Chrome 119, Safari 16.4 and Firefox 128; where it is unsupported the app accent applies, which is a correct and legible fallback.

On iOS the status-bar tint follows the full-screen player's `--player-surface`, because the sheet touches the top edge and carries an opaque background.

## 3. Type

Two families, clearly distinct, both Scandinavian in provenance and chosen for a reading product.

| Role | Family | Why |
| --- | --- | --- |
| UI and headings | Schibsted Grotesk Variable | A Nordic newsroom grotesque: confident, a little condensed in the bold weights, strong numerals. Weights 400 to 700 |
| Reading | Literata Variable | A text serif designed for long reading on screens, with an optical size axis. Gives the summary a different voice from the headline |

Both ship as self-hosted latin variable subsets (`@fontsource-variable/schibsted-grotesk`, `@fontsource-variable/literata`), one preloaded, 80 KB or less together.

### Fallbacks

Metric-matched local fallbacks stop layout shift. Measured from the font files with `@capsizecss/unpack` against Arial and Georgia:

```css
@font-face {
  font-family: "Schibsted Grotesk Fallback";
  src: local("Arial");
  size-adjust: 104.49%;
  ascent-override: 93.46%;
  descent-override: 24.67%;
  line-gap-override: 0%;
}

@font-face {
  font-family: "Literata Fallback";
  src: local("Georgia");
  size-adjust: 107.67%;
  ascent-override: 109.31%;
  descent-override: 28.61%;
  line-gap-override: 0%;
}
```

The family tokens already name these (`--font-ui`, `--font-read`). `font-display: swap`; `font-synthesis: none`; `font-optical-sizing: auto`.

### Scale

Fluid between 20rem and 80rem viewports. Roles are composite tokens that expand to `--text-<role>-family|size|weight|tracking|leading`.

| Role | Size | At 390px | Weight | Leading | Tracking | Used for |
| --- | --- | --- | --- | --- | --- | --- |
| Display | `clamp(2.25rem, 1.9167rem + 1.6667vw, 3.25rem)` | 36px | 700 | 1.04 | -0.03em | Page date, empty state, archive title |
| Lead | `clamp(1.5rem, 1.2917rem + 1.0417vw, 2.125rem)` | 24px | 700 | 1.1 | -0.025em | First item's headline, year in the archive |
| Title | `clamp(1.1875rem, 1.1042rem + 0.4167vw, 1.4375rem)` | 19px | 600 | 1.22 | -0.015em | Item headlines, player title |
| Heading | 1.0625rem | 17px | 600 | 1.25 | -0.01em | Chapter names, section titles, sheet titles |
| Label | 1rem | 16px | 600 | 1.25 | 0 | Buttons, setting names |
| Body | 1rem | 16px | 400 | 1.5 | 0 | UI body |
| Reading | `clamp(1.0625rem, 1.0208rem + 0.2083vw, 1.1875rem)` | 17px | 400 | 1.6 | 0 | Summaries (Literata) |
| Meta | 0.875rem | 14px | 500 | 1.4 | 0.005em | Bylines, why line, times |
| Caption | 0.8125rem | 13px | 500 | 1.4 | 0.005em | Scrubber bubble, cover tag |

Rules, with the reason for each:

- **Tracking is size-specific.** Large text tightens, small text opens a hair (apple-design section 15).
- **Leading falls as size rises.** 1.04 on the display, 1.6 on the serif body; a serif gets more leading than a sans.
- **Four weights.** 400, 500, 600, 700. Nothing under 400. De-emphasis comes from color and size, not from a lighter weight (refactoring-ui).
- **Measure.** Summaries cap at 62ch; the column is 40rem. On a 390px phone the measure is about 38 characters, accepted for a serif on mobile.
- **Headlines wrap with `text-wrap: balance`, paragraphs with `pretty`.** No orphans, even lines.
- **Numerals.** Anything that changes while you watch it uses tabular lining numerals (`.num`): elapsed, remaining, the CTA clock. Static times and counts are proportional. Tabular figures also widen the colon, so live clocks render the colon in a 0.34em box (`.colon`).
- **No eyebrows, no all caps, no accented single word.** Hierarchy comes from size, weight and position. The date headline is one weight and one color.
- **Inputs are 16px or larger** so iOS never zooms.

## 4. Spacing, radius, elevation

### Spacing

A 4px base on a scale where adjacent steps are at least 25 percent apart (asserted by test).

| Token | Value | Typical use |
| --- | --- | --- |
| `--space-1` | 4px | Gaps inside a control, row inset in the rail strip |
| `--space-2` | 8px | Mini player inset, within-group gaps |
| `--space-3` | 12px | Control padding, gap between byline items |
| `--space-4` | 16px | Page gutter on phones, sheet padding |
| `--space-6` | 24px | Page gutter from 40rem, player padding, hero gaps |
| `--space-8` | 32px | Hero bottom padding, section breaks inside sheets |
| `--space-12` | 48px | Gap between items, column gap with the aside |
| `--space-16` | 64px | Gap between chapters |
| `--space-24` | 96px | Page end |

Gaps between groups are at least double the gaps within a group: item to item is 48px, within an item 8 to 12px, chapter to chapter 64px (better-layout: group with space).

### Radius and the concentric rule

Outer radius equals inner radius plus the padding between them. Tokens declare the rule and `buildTokens.test.ts` asserts it.

| Token | Value | Use |
| --- | --- | --- |
| `--radius-xs` | 4px | Chapter node, ticks, tags |
| `--radius-sm` | 8px | Cover thumbs, mini player controls, item play button, segment |
| `--radius-md` | 12px | Buttons, fields, rows, switch track outer is 10px |
| `--radius-lg` | 16px | CTA, mini player, archive row, medium transport button |
| `--radius-xl` | 24px | Main play button |
| `--radius-sheet` | 28px | Sheets, dialogs |
| `--radius-round` | 9999px | Circles only: item nodes, scrubber thumb, spinner |

| Container | Radius | = inner | + padding |
| --- | --- | --- | --- |
| Mini player | 16 | control and cover 8 | inset 8 |
| Archive row | 16 | cover thumb 8 | row padding 8 |
| Segmented track | 12 | segment 8 | track padding 4 |
| Switch track | 10 | thumb 7 | track padding 3 |
| Toast | 16 | action 8 | padding 8 |
| Sound-lab card | 24 | button 16 | padding 8 |

Buttons are rounded rectangles. There are no capsule shapes: the switch track is a rounded rectangle on purpose, and the only circles in the product are positions.

### Elevation

Four named levels. Layered, hue-tinted shadows (the tint is a cool blue at hue 250 to 255; higher levels are more diffuse and slightly more chromatic), one light direction (down), and never pure black in light mode.

| Token | Used by | Light | Dark |
| --- | --- | --- | --- |
| `--shadow-cover` | Covers | 3 layers, up to 12px offset, 32px blur | 2 black layers |
| `--shadow-floating` | Mini player | Ring plus 3 layers up to 20px offset | Rim highlight plus black layers |
| `--shadow-sheet` | Sheets, dialogs | Ring plus two ambient layers, no offset (a bottom sheet has no "below") | Rim highlight plus black ambient |
| `--shadow-popover` | Toast | Ring plus 2 layers | Ring plus 1 layer |

Covers also carry a 1px inner outline at 10 percent black or white, for edge definition on any surface (DESIGN.md).

### Strokes, sizes, z-index

| Token | Value |
| --- | --- |
| `--stroke-hairline` | 1px |
| `--stroke-rail`, `--stroke-ring`, `--stroke-ring-gap` | 2px |
| `--size-touch` | 44px |
| `--size-touch-comfortable` | 48px |
| `--size-icon`, `--size-icon-lg` | 20px, 24px |
| z-index | header 10, mini 20, sheet 30, toast 40 |

Icons are one set (Lucide-style, 2px round strokes) at 20px, 24px for transport controls, 16px inside the item play button. Decorative, `aria-hidden`.

## 5. Layout

Mobile first. Breakpoints sit where the content stops fitting, not where devices change. Source of truth for the numbers: `semantic.layout` and `semantic.breakpoint` tokens.

### Three widths

| Width | Designed at | Layout |
| --- | --- | --- |
| Under 40rem (phone) | 390px; verified 320 to 430 | One column. Gutter 16px. Bottom mini player floats 8px from the edges. Generate and Settings are floating bottom sheets. The expanded player is full screen |
| 40rem to 64rem (tablet) | 820px | The reading column stays 40rem and centers. Gutter 24px. The mini player is capped at 38.5rem and centers. Generate and Settings become centered 28rem dialogs. The expanded player becomes a centered 26rem card that scales in |
| 64rem and up (desktop) | 1280px | A 14rem sticky aside appears left of the column, holding the cover and the chapter list. Header and banners span aside plus gap plus column so the wordmark sits over the aside and the actions over the column. Beyond 72rem nothing is added: same layout, more air, never a wider measure |

Below 23.5rem the hero stacks: the cover (6.5rem) sits above the date so the date keeps its size.

### Reading column anatomy

```text
| 16 | rail strip 36 | title and text (up to 62ch)         | 16 |
     ^ rail center at 12px
```

The briefing has a 36px left gutter for the rail. The rail line is 2px wide, centered 12px in. Item nodes and chapter nodes center on it. Content starts at 36px.

### Safe areas

- `viewport-fit=cover`. The four `env(safe-area-inset-*)` values are mirrored once in `:root` as `--safe-top|right|bottom|left` with a `0px` fallback. A zero inset is a legitimate value and nothing waits for a positive one (apple-web-app).
- Content bleeds; controls float. Text and controls stay inside `max(gutter, safe-area)`.
- Header: `padding-top: var(--safe-top)`, sticky, opaque `surface` background. The hairline under it fades in over the first 16px of scroll through a scroll-driven animation (progressive; no hairline where unsupported).
- Mini player: `bottom: max(8px, var(--safe-bottom))`. Pages reserve its height plus inset plus safe area at the end of `main` while it is visible.
- Sheets: bottom padding `max(8px, var(--safe-bottom))`. The home indicator auto-hides on iOS 26 but still reports its inset.
- Layout is correct at inset `0px`: top bars are `base + inset`, never inset alone.

### The iPad window-controls corner

iPadOS windowed apps draw window controls over the top-leading corner, and `env()` does not report it. Primary controls stay out of the top-leading 64px.

- The header's first element is the non-interactive wordmark, and its start padding is `max(gutter, --window-controls-inset)`.
- `--window-controls-inset` is `0px` everywhere except `@media (display-mode: standalone) and (pointer: coarse) and (min-width: 40rem) and (min-height: 40rem)`, where it is 4rem. That matches iPad and excludes phones in landscape.
- The expanded player's close button sits top-trailing. The archive's back link sits in the content area under the header, never in the corner.

### Installed-app navigation

Standalone mode hides browser chrome, so every screen that can be left has a visible way out: the archive has a "Today" back link; sheets have a close button, scrim tap and Escape; the wordmark links home.

## 6. Components

Each component lists anatomy, states and values. State vocabulary: **default**, **hover** (fine pointers only, never on touch), **pressed**, **focus-visible**, **disabled**, **loading**, **error**, **empty**. A cell reading "none" means the state does not exist for that component.

### Site header

| Part | Value |
| --- | --- |
| Container | Sticky, `z-index` 10, min-height 56px plus safe-area top, opaque surface |
| Wordmark | The brand mark (the rail with its current node, 16 by 24px, accent) plus "Dispatch" at heading size, weight 700. Link to home |
| Actions | Archive (text link, from 40rem), Generate (icon and label), Settings (icon). Each 44px tall; text actions have 12px horizontal padding |

States: hover fills sunken with primary text; pressed scales 0.97 (100ms in, 160ms out); focus-visible shows the two-layer ring. Disabled, loading, error, empty: none.

### Cover

A square image. In the prototype it is a placeholder: a block of palette color with the day numeral in Schibsted 700, cropped by the frame, and a "Placeholder cover" tag on sizes of 7rem and up.

| Size | Token | Radius | Where |
| --- | --- | --- | --- |
| Thumb | 44px | 8 | Mini player |
| Row | 40px | 8 | Archive row |
| Hero | 8.5rem (11rem from 40rem) | 12 | Home hero, desktop aside (12rem track) |
| Player | up to 22rem, 36dvh cap | 16 | Expanded player |

Production: `<img alt="">` (decorative; the title sits beside it), 512 and 1024 PNG from the cover renderer, with the palette color as the box background so there is no empty flash. 1px image outline and the cover shadow. Weekly digests carry a framing rule inset 7 percent so a deep dive reads as a different record at a glance.

### Reader hero

Anatomy: cover, date `h1`, two meta lines, call-to-action.

| Part | Value |
| --- | --- |
| Layout | Grid, cover 8.5rem and text, gap 16px (11rem and 24px from 40rem), text aligned to the cover's bottom edge, padding 24px top and 32px bottom |
| Date | Display role, "Wednesday 7 October". The only `h1` |
| Meta | Two lines, meta size, muted: "12 items since Monday", "2 min to read, 4 to listen". Plain commas, no dots |
| CTA | Full width, min-height 56px, radius 16, accent fill. Icon and label left, clock right. 17px semibold |

CTA states:

| State | Appearance | Behavior |
| --- | --- | --- |
| Default | "Play the briefing", play glyph, clock "3:32" | Starts playback from the beginning or the remembered position |
| Hover | Accent hover fill | none on touch |
| Pressed | Scale 0.98, accent pressed fill | Feedback on press, 100ms |
| Focus-visible | Two-layer ring | none |
| Playing | "Pause", pause glyph, "1:26 of 3:32" | Pauses |
| Paused | "Resume" | Resumes |
| Ended | "Play again" | Restarts |
| Loading | Label "Preparing audio"; after 300ms a spinner replaces the glyph | Never a layout shift |
| Disabled | Sunken fill, disabled text color, `aria-disabled` so it stays focusable. "Audio needs a connection" or "Audio is still being prepared" with a hint line below | Does nothing |
| Error | Danger banner above the hero, with "Try again" | See banners |
| Empty | Replaced by the empty state | See empty states |

### The rail

The line, its nodes and its fill. One element tree, driven by the player state.

| Part | Value |
| --- | --- |
| Track | 2px wide, 12px from the left of the briefing, `--color-track`, full height of the briefing |
| Fill | Same box, accent, `transform: scaleY(var(--player-progress))`, origin top. A leaf element: it has no children, so writing its progress never restyles content |
| Item node | 10px circle. Idle: surface fill with a 2px ring in track-strong. Played: accent fill and ring. Current: accent fill and ring, a 5px halo at 24 percent accent, scale 1.35 |
| Chapter node | 14px rounded square (radius 4), same states. The square marks "a section"; the circle marks "an item" |
| Tap strip | 32px wide, full height, centered on the line, `z-index` 2, above the nodes. The nodes ignore the pointer |

Fill position is piecewise linear between item node centers, by time: for playhead time t inside item i, `y = lerp(node[i], node[i+1], (t - start_i) / (end_i - start_i))`, with the last item ending at the bottom of the briefing. The fill advances every animation frame while playing, with no transition. After a tap or a seek it glides for 300ms with the ease-out curve (`data-seeking`), then returns to frame-driven.

Rail tap: a tap anywhere in the strip resolves to the nearest node and plays that item. The strip is one flush target, so the gaps between nodes are live (interactive-hit-areas). It is an accelerator for pointer users, not the accessible control: it is `aria-hidden`, not focusable, and every item has a real play button.

States: nothing hovers on the rail. Focus: none (not focusable). Disabled and loading: none. When playback has not started the fill is empty, nodes are idle, and `data-live` is absent.

### Chapter header

A row, not a heading style: `h2` containing a button that plays the section.

| Part | Value |
| --- | --- |
| Row | Min-height 44px, radius 12, bleeds 8px left and 12px right so its hover fill clears the text, which stays aligned |
| Name | Heading role |
| Time | Meta size, muted, section length "1:02" |
| Node | 14px rounded square, vertically centered on the row |

States: hover fills sunken; pressed fills sunken and scales 0.97; focus-visible ring; current section marks its node accent (and the desktop aside link takes the accent tint). Accessible name: "Listen to Top picks, 1:02".

### Item

Anatomy, top to bottom: headline link, byline row with play button, summary, why line.

| Part | Value |
| --- | --- |
| Headline | Title role (the first item uses Lead). A link to the source, underline appears on hover in accent, 2px, offset 0.18em. `text-wrap: balance` |
| Byline | Meta size. Source in semibold primary, author in muted, separated by a 12px gap, not a dot. "by" is visually hidden for screen readers |
| Play button | 44px target, 36px rounded-square face (radius 8), sunken fill, accent glyph. Sits at the trailing end of the byline row |
| Summary | Reading role, 62ch cap |
| Why | Meta size, muted, a semibold primary "Why" label then the sentence |
| Spacing | Headline to byline 4px; byline row 36px; to summary 12px; to why 12px; item to item 48px |

Item states:

| State | Appearance |
| --- | --- |
| Upcoming (no `data-state`) | Hollow node |
| `data-state="played"` | Filled node |
| `data-state="current"` | Filled node with halo; play button face accent tint |
| Playing and current | Play button face solid accent with the pause glyph |
| While listening (`.briefing[data-live]`) | Non-current summaries change to muted text; titles stay primary |
| Play button hover (fine pointer) | Accent fill, on-accent glyph |
| Play button pressed | Scale 0.97 |
| Focus-visible | Ring on the control that has focus (title link or play button) |

Play button label: "Listen from here: {headline}"; when it is the playing item, "Pause: {headline}". Disabled, loading, error, empty: none (the button does not exist while audio is offline; the CTA carries that state).

### Archive

Used twice: three rows under "Earlier" on the home page, and the full archive page.

**Archive row** (day): a link. Grid of cover thumb (40px), text, chevron.

| Part | Value |
| --- | --- |
| Row | Padding 8, radius 16 (concentric with the 8px thumb), bleeds 8px so the hover fill clears the text, rows flush with no gap |
| Date | Label weight, "Monday 5 October" |
| Meta | Muted: "11 items, 4 min". Weekly digests add a first line "Weekly deep dive" in semibold primary, and the thumb carries the framing rule |

States: hover and pressed fill sunken; focus-visible ring; chevron in tertiary text.

**Month**: a `<details>` disclosure. Summary row 44px, month name (heading role), count "4 briefings" and a chevron that rotates 180 degrees over 200ms. Body expands with `::details-content` over 250ms ease-out (grid-rows or `interpolate-size` where unsupported falls back to an instant toggle).

**Year**: a `<details>` whose summary is the year in Lead role with a chevron. The newest year and its newest month start open.

The archive page: `h1` "Archive", a muted line "19 briefings, newest first. Weekly deep dives are marked.", the "Today" back link above, then years. Empty: "No briefings yet" as in the empty state.

### Mini player

A floating bar. Appears after the first play and never hides again.

| Part | Value |
| --- | --- |
| Container | Fixed, 8px from the left, right and bottom (bottom is `max(8px, safe-area)`), radius 16, overlay surface, floating shadow, `max-width` 38.5rem centered. Height 60px (44px controls plus 8px padding twice) |
| Progress hairline | 2px, inset 8px from the edges, top of the bar, accent, `scaleX(--player-progress)` on a leaf |
| Open button | Cover thumb (44px, radius 8), then two lines: section and position "Interaction craft, 5 of 12" (caption, muted, semibold), headline (meta size, semibold, one line, ellipsis) |
| Controls | Play or pause (44px, radius 8, solid accent), next item (44px, radius 8, ghost) |

States:

| State | Appearance |
| --- | --- |
| Hidden (before first play) | Translated off the bottom, `visibility: hidden` so it cannot take focus |
| Enter | Slides up 300ms on the drawer curve while fading 200ms |
| Default, playing, paused | Glyph swaps with a 200ms scale-and-blur crossfade |
| Hover | Sunken fill on the open button and next button; accent hover on play |
| Pressed | Scale 0.97 (0.98 on the open button) |
| Loading | Play glyph hides, a spinner shows after 300ms |
| Focus-visible | Ring with the overlay surface as its gap |
| Disabled, error | none. Playback errors appear as a danger banner and the bar shows paused |

Gestures: tap the open button opens the player. Swipe up on it opens the player interactively (section 7). The open button owns vertical pans (`touch-action: none`) so the swipe is not swallowed by page scroll.

### Expanded player (phone)

A full-screen sheet, edge to edge, with a drag handle. Not a card: it covers the status bar and carries the cover-tinted surface so the status bar matches (apple-web-app: status-bar color sampling).

Anatomy, top to bottom:

| Zone | Contents | Behavior |
| --- | --- | --- |
| Drag zone (non-scrolling) | Handle (36 by 4px, radius 4, track-strong), bar with the date on the left and the close button on the right, the cover, title block | Starts a dismiss drag. Everything inside that is a button keeps its own tap |
| Controls (non-scrolling) | Scrubber, elapsed and remaining, transport row | Always visible |
| Scroll area | Speed segmented control, chapter list | Scrolls under the controls with `overscroll-behavior: contain`; never starts a sheet drag |

Cover: centered, up to 22rem and never taller than 36dvh, radius 16. Title block: section and position (meta, muted, semibold), headline (Title role, two lines then ellipsis), then "Source, Author" (meta, muted).

**Scrubber**

| Part | Value |
| --- | --- |
| Hit area | 44px tall, full width, `touch-action: none`, `direction: ltr` even in RTL locales (a timeline is not text) |
| Track | 4px, radius 4, track color |
| Fill | Cover accent, `scaleX(--player-progress)`, leaf |
| Ticks | One per item start: 2 by 10px, radius 1, unplayed track-strong, played cover accent. Chapter starts are 2 by 16px |
| Thumb | A 16px disc with a 2px ring in the sheet surface, centered on the playhead |
| Bubble | Above the thumb while dragging: time (semibold) and "Item 7 of 12" (caption), inverse surface, radius 8, clamped inside the track |
| Labels | Elapsed left, remaining right with a minus, meta size, muted, tabular |

States:

| State | Appearance |
| --- | --- |
| Default | As above |
| Hover | none (the thumb is always visible; no hover-only affordance) |
| Pressed or dragging | Track grows to 8px (`scaleY(2)` in 160ms ease-out), thumb disc scales to 1.4 with the pop spring, bubble fades in over 100ms |
| Focus-visible | Ring around the whole slider |
| Disabled | none (the scrubber is not shown when audio is not ready; the player cannot open) |
| Loading | The thumb stays; a quiet spinner appears on the main play button after 300ms |

ARIA: `role="slider"`, `aria-valuemin 0`, `aria-valuemax` duration in seconds, `aria-valuenow` rounded seconds, `aria-valuetext` "1:26 of 3:32, Interaction craft, item 5 of 12". The value attributes update at most once a second while playing and immediately on a seek, so a screen reader is not flooded.

The scrubber and the rail are one state: moving one moves the other.

**Transport**

Five controls in a row, space-between: previous item (56px), back 15 seconds (44px), play and pause (72px), forward 15 seconds (44px), next item (56px).

| Control | Size | Radius | Fill |
| --- | --- | --- | --- |
| Item skip | 56px | 16 | None, primary glyph |
| 15-second skip | 44px | 12 | None, muted glyph with the "15" in the arrow |
| Play and pause | 72px | 24 | Cover accent, on-cover-accent glyph |

States: hover (fine pointer) fills sunken on the ghost controls; pressed scales 0.97; focus-visible ring; loading hides the glyph and shows a spinner after 300ms; disabled uses the disabled text color with `aria-disabled`.

Previous item restarts the current item when more than 3 seconds in, otherwise goes back one, like every audio player.

**Speed**

A segmented control with four segments: 1x, 1.25x, 1.5x, 2x. Native radios inside labels, so arrow keys and form state come free.

| Part | Value |
| --- | --- |
| Track | Sunken fill, padding 4, radius 12, height 44 |
| Segment | Radius 8 (concentric), meta size semibold, muted text |
| Selected | Cover accent fill and on-cover-accent text in the player; raised surface with a 1px ring in settings. The ring and the fill both signal selection, never color alone |

The choice is remembered and shared with the default-speed setting. `preservesPitch` stays on.

**Chapters**

One row per section: 48px, radius 12, name left, length right. The current chapter has a 12 percent cover-accent tint, primary text, and a leading 8px accent square. Hover (fine pointer) fills sunken. Tapping plays the section.

### Generate sheet

A floating bottom sheet on phones, a centered dialog from 40rem. Heading, a muted line, the form, the progress list, the result.

| Part | Value |
| --- | --- |
| Panel | Raised surface, radius 28, padding 16, inset 8px from the edges |
| Heading | "Generate a new briefing", 17px bold |
| Lede | "Covers everything since Monday. It takes a few minutes, and you can close this sheet while it runs." Meta size, muted |
| Field | Label above ("Passphrase", semibold), 48px input, radius 12, 1px control border, sunken fill, 16px text. Hint below in muted |
| Bot check | A status line: spinner and "Checking you are not a bot", then a check and "Bot check passed" |
| Submit | Primary button, 56px, "Generate briefing" |
| Progress | Six steps, drawn with the rail's grammar |

Progress steps: Waiting for a slot, Reading sources, Judging, Writing, Checking, Publishing. Each is a row with a 10px node on a 2px line. Pending: hollow node, muted text. Active: filled node with halo, semibold, "In progress". Done: filled node, "Done". Failed: danger node and text, "Failed". The state word is always shown, so the list reads without color.

Sheet states:

| State | What the person sees | Copy |
| --- | --- | --- |
| Default | The form | As above |
| Wrong passphrase | Input border turns danger, `aria-invalid`, inline error with an alert icon, focus stays on the input and its text is selected | "That passphrase does not match. Check it and try again." |
| Empty submit | Same inline error | "Enter the passphrase to continue." |
| Offline | Same inline error | "You are offline. Reconnect, then try again." |
| Cooldown | Same inline error | "Generate is on cooldown. Try again in 5 hours 12 minutes." |
| Running | Submit keeps its accent fill, shows a spinner and "Generating", `aria-disabled`; input locked; list appears | Steps announced politely |
| Success | List all done, success banner, "Open the new briefing" primary and "Close" secondary | "Briefing ready" and "12 items for Wednesday 7 October." |
| Nothing | List all done, info banner, "Close" | "Nothing cleared the bar." and "No new items since Monday 5 October. The next scheduled run is in about two days." |
| Failed | The Writing step fails, danger banner with an alert role, "Try again" and "View the run" | "The run failed while writing" and "Open the run for details, or try again in a few minutes." |
| Closed while running | Run continues; a toast appears when it finishes | "Briefing ready", "Open" |

Submit stays enabled until the request starts (better-accessibility). The passphrase input is `type="password"`, `autocomplete="off"`, no paste block.

### Settings sheet

Heading "Settings". Groups, each with a muted label:

| Group | Control | Notes |
| --- | --- | --- |
| Theme | Segmented: System, Light, Dark | Changes crossfade over 200ms; no sound |
| Sound | Switch "Interface sounds" with a hint, then Volume | Volume is disabled when sounds are off. Release of the slider plays a sample |
| Default speed | Segmented: 1x, 1.25x, 1.5x, 2x | Same preference as the player's |
| Install | A tinted card: share icon, "Add Dispatch to your Home Screen", "In Safari, tap Share, then Add to Home Screen. It opens full screen and keeps playing in the background.", and "Hide this" | Shown only in Safari on iOS, not already installed, after two or more visits; dismissal is remembered permanently. Never the word "install" in copy |

The prototype adds a collapsed "Prototype states" group (page state, slow network, device voice). It is not part of the product.

**Switch**: 52 by 32px, radius 10 (thumb radius 7 plus 3 padding), off track-strong, on accent, thumb raised surface (near-white in dark mode). The thumb moves in 200ms on the ease-out curve and stretches 12 percent while pressed. The row is one 48px target with the label. Native `input type="checkbox" role="switch"`.

**Volume**: a native range, 44px target, 4px track filled with accent, 16px thumb.

### Toast

Used for events that finish while their sheet is closed.

| Part | Value |
| --- | --- |
| Container | Top-layer popover, centered above the mini player, inverse surface, radius 16 (action radius 8 plus padding 8), min-height 56px, popover shadow |
| Content | Message, one action button, a dismiss button (44px each) |
| Motion | Enters over 250ms with opacity and 12px rise; exits over 150ms |
| Behavior | A toast with an action stays until it is used or dismissed. It never steals focus; its text is announced through a polite live region |

States: action hover and pressed use the inverse text color at 14 percent; focus-visible rings in the inverse text color.

### Banners and the page states

One banner component: icon, title (semibold), body (muted, meta size), optional trailing action. Tone sets the tint and icon color. A `role="status"` unless it is an error, which is `role="alert"`.

| State | Banner | Page behavior |
| --- | --- | --- |
| Offline | Warning, wifi-off icon. "You are offline", "Showing the last briefing you opened. Audio needs a connection." | CTA disabled with "Audio needs a connection"; items and the archive stay readable from cache |
| Nothing new | Info icon. "Nothing cleared the bar.", "No new items since Monday 5 October. The next run is due in two days." | The previous briefing stays below |
| Stale | Warning, clock icon. "This briefing is 4 days old", "Generate a new one to see what changed since." with a "Generate" action | Shown when the latest digest is older than the cadence allows |
| Audio preparing | No banner. The CTA is disabled: "Audio is still being prepared", a hint "Narration is generated after the text. It usually takes a few minutes." | Text is fully readable |
| Load error | Danger, alert icon. "The briefing did not load", "Check your connection, then try again." with "Try again" | The "Earlier" list stays so there is somewhere to go |

### Empty state

No briefings yet. A placeholder cover (hero size), "No briefings yet" (Display role), "The first one arrives within two days. Generate one now to see how it reads.", and a primary "Generate a briefing" button. It invites an action and says what will happen.

## 7. Interaction

### Should it animate: the frequency gate

Every motion in this spec passed the same gate: how often does the person see it, and what is its purpose?

| Frequency | Examples | Decision |
| --- | --- | --- |
| Constant while playing | Rail fill, scrubber fill | Linear, per frame, no easing: it is progress |
| Every few seconds, tens a day | Play and pause glyph, item change, press feedback | Short, subtle: 100 to 200ms; nothing travels |
| Occasional | Sheets, the player, toasts, theme change | Standard animation within the ceilings below |
| Rare | Generate finishing, first run | The one place for delight: the signature chime |
| Keyboard actions | Arrow-key seek, Page keys | No motion and no sound beyond the state change itself |

### Timings and curves

All values are tokens, from DESIGN.md. Reduced motion is implemented by remapping the movement durations (section 7.8).

| Motion | Duration | Curve | Notes |
| --- | --- | --- | --- |
| Press in | 100ms | ease-out | Scale to 0.97 (0.98 on large buttons) |
| Press out | 160ms | ease-out | Asymmetric on purpose: meets the finger, then settles |
| Hover, color | 150ms | ease | Fine pointers only |
| State change (node fill, text color, glyph swap) | 200ms | ease-out | |
| Small enter (toast, month body) | 250ms | ease-out | Opacity, 8 to 12px rise, 3px blur |
| Small exit | 150ms | ease-out | Opacity only |
| Sheet in | 300ms | drawer | Bottom sheet and scrim |
| Sheet out | 220ms | drawer | Quicker than in: the system gets out of the way |
| Full-height player | 350ms perceptual spring | Spring | The documented drawer exception; never above 500ms |
| Rail seek glide | 300ms | ease-out | Only after a tap or seek |
| Stagger | 40ms | n/a | Between entering items; total under 300ms |

Curves: ease-out `cubic-bezier(0.23, 1, 0.32, 1)`; in-out `cubic-bezier(0.77, 0, 0.175, 1)`; drawer `cubic-bezier(0.32, 0.72, 0, 1)`. Nothing uses ease-in. Nothing starts from `scale(0)`; entering surfaces start from 0.96 to 0.97 with opacity 0. No `transition: all`; every transition names its properties. Only `transform` and `opacity` animate, plus `scale`, `filter` and `clip-path` on single small elements, and one `block-size` (month body) where no transform exists.

### Springs

Two CSS curves are generated with `linear()`; one JavaScript spring runs gestures.

| Name | Perceptual duration | Bounce | Total time | Use |
| --- | --- | --- | --- | --- |
| `--ease-spring-settle` | 350ms | 0 | 650ms | Critically damped settle. Opening the player from a tap |
| `--ease-spring-release` | 400ms | 0.15 | 750ms | Gesture release with momentum |
| `--ease-spring-pop` | 250ms | 0.25 | 450ms | Scrubber thumb grab |

The total time includes a sub-pixel settling tail; the perceptual duration is the number the motion rules measure. In script the same parameters drive a velocity-preserving spring: mass 1, stiffness `(2 pi / duration)^2`, damping ratio `1 - bounce`. In `motion`, the equivalent is `animate(value, target, { type: "spring", duration, bounce, velocity })`. Apple's "response" is the perceptual duration; Apple's damping ratio is `1 - bounce`.

Choices, from apple-design: critically damped by default; add bounce only when the gesture carried momentum (a flick, a drag release); never bounce a close. Visual overshoot at the open edge is clamped, because the sheet cannot rise above the top of the screen.

### Gestures

| Gesture | Where | Behavior |
| --- | --- | --- |
| Tap | Any control | Feedback on pointer down (scale 0.97 in 100ms), commit on up. Hover is gated to fine pointers so touch never shows a stuck hover |
| Press and hold | None | No long-press gestures in v1. Anything a long press could do has a visible control |
| Scrub | Scrubber | Pointer capture on down, so the drag survives leaving the strip and the window. The thumb jumps under the finger and follows 1:1. Narration pauses while the thumb is down and resumes on release; the seek happens on release. Time bubble follows the thumb. Crossing an item boundary fires one soft detent (hysteresis of 2 percent of the digest length so a hovering finger does not retrigger) |
| Rail tap | Rail strip | Plays the nearest item. Taps only; a vertical movement over 10px is a scroll and does nothing |
| Swipe up | Mini player | The sheet follows the finger, amplified so the full height opens over three quarters of the finger travel. Release commits on velocity above 0.4px per ms or progress above 35 percent, otherwise it closes again with no sound |
| Flick down | Player drag zone | 1:1 follow after an 8px dead zone. Release dismisses when velocity exceeds 0.5px per ms downward, or when travelled distance exceeds 35 percent of the sheet height and the finger is not moving back up. Otherwise it springs back with the release velocity. Dismissal happens on release, never mid-drag |
| Tap scrim, Escape, close button | Player and sheets | Close with the quicker exit |
| Scroll | Player scroll area | Contained; never chains to the page and never starts a sheet drag |

Gesture rules shared by all: pointer events with capture; one pointer at a time (a second touch is ignored, so switching fingers cannot make the sheet jump); `touch-action: none` only on the surface that owns the gesture; every animation starts from the current on-screen value, never from the target, so a sheet grabbed mid-flight follows the finger and a tap during a settle retargets without a jump.

### Mini player to full player

One variable, `p`, drives everything: 0 is closed, 1 is open.

- Panel `translateY = (1 - p) * height`
- Scrim opacity `= p`
- Cover `translate(...) scale(...)` interpolates from the mini player's cover rect to its resting rect, with its corner radius divided by the scale so it stays true
- The mini player's own cover is hidden while the sheet is open, so exactly one cover is ever visible; the swap at the ends is seamless because they are identical

Tap, keyboard, swipe and flick are four ways of moving `p`. Each starts from the live value and keeps velocity.

**Why not the View Transitions API for the cover.** A view transition cannot be driven by a finger, cannot be interrupted, and freezes the page for its duration. The swipe-up gesture is a requirement, so the same interpolation covers tap too: one path, no fallback needed. View transitions are used where they fit: the home to archive navigation (a 200ms crossfade of the root with the mini player in its own named group so it stays put) and the theme change. Without the API both are instant swaps.

**Wide layouts.** From 40rem the player is a centered card that fades and scales from 0.96, with `transform-origin: center` (modals stay centered). No cover morph: there is no bottom edge to travel from.

### Entry, exit, asymmetry

| Element | Enter | Exit |
| --- | --- | --- |
| Generate and Settings sheets | 300ms slide and 200ms fade, `@starting-style` | 220ms slide back, 200ms fade; display and overlay transition with `allow-discrete` so the exit plays |
| Scrim | 300ms fade | 220ms fade |
| Mini player | 300ms slide up, 200ms fade | 220ms; `visibility` flips after the exit |
| Toast | 250ms rise and fade | 150ms fade |
| Month body | 250ms grow | Same, reversible |
| Play and pause glyph | Incoming glyph scales from 0.7, 3px blur to sharp, 200ms | Outgoing scales to 0.7 and blurs |

Entering surfaces never leave the screen the way they came in unless they are a drawer: a sheet enters from the bottom and leaves through the bottom.

### Reduced motion

`prefers-reduced-motion: reduce` means fewer and gentler animations, not zero.

- Movement durations collapse to 0.01ms through token remapping (enter, exit, sheet in and out, drawer, stagger, spring durations), so `transitionend` still fires and no component needs its own media query.
- Fades and color changes keep their timing, so a sheet becomes a 200ms crossfade.
- The player replaces the slide and the cover morph with a fade of `p` over 200ms.
- Smooth scrolling is off; auto-follow scrolls instantly.
- Entrances use opacity alone; the spinner pulses instead of rotating.
- The rail and the scrubber still update, because they carry information.
- Sounds default to off (they stay available as a setting).

Also honored: `prefers-contrast: more` (hairlines and tracks take the control-border strength), `prefers-reduced-transparency: reduce` (scrim becomes opaque), `forced-colors: active` (rail, nodes, thumb, switch and covers get system-color borders and fills; focus outlines survive because they are outlines, not shadows).

### Hit areas

- Every control is at least 44 by 44px, comfortable 48px in sheets.
- Where the visible shape is smaller, the button box is 44px and the face is drawn inside: the item play button is a 44px button with a 36px face. Negative margins keep the layout box at face size and push the hit area outward so it never overlaps a neighbor.
- Interactive siblings sit flush; spacing lives inside the target (archive rows, chapter rows, segmented segments, chapter list).
- The one exception is the rail strip at 32px, because the chapter row starts 28px in. It is an accelerator beside a full-size control.
- Decorative layers over controls have `pointer-events: none`.
- `touch-action: manipulation` on all controls; `-webkit-tap-highlight-color: transparent` because every control has a pressed state.

### Keyboard map

| Key | Context | Action |
| --- | --- | --- |
| Tab, Shift+Tab | Anywhere | Moves through the DOM order: skip link, wordmark, actions, hero CTA, chapters, items, earlier rows, mini player. Dialogs trap focus and everything behind them is `inert` |
| Enter, Space | Buttons, links, switch | Activates. Space toggles a switch |
| Left, Right (or Up, Down) | Scrubber | Seek 5 seconds. Shift: 15 seconds |
| Page Up, Page Down | Scrubber | Previous or next item |
| Home, End | Scrubber | Start or end of the digest |
| Arrow keys | Segmented controls | Move and select (native radio behavior) |
| Escape | Sheet, player | Closes it and returns focus to the control that opened it |
| Enter on a headline | Item | Opens the source |

Keyboard-initiated seeking is silent and unanimated beyond the state change. A global play and pause shortcut is deferred, because a bare Space key conflicts with page scrolling.

## 8. Accessibility

Baseline WCAG 2.2 AA. Native elements first.

### Structure

- Landmarks: `header` (site), `main`, an `aside` for chapters from 64rem, and a `region` named "Audio player" for the mini player.
- One `h1` (the date). Each chapter is an `h2` whose child is the button; items are `h3`; "Earlier" is an `h2`. Sheets use their own headings inside a `dialog` labelled by it. Archive: `h1` "Archive", year and month summaries in `details`.
- A skip link ("Skip to the briefing") is the first focusable element.
- On a route change the page title updates and focus moves to the new `h1` (`tabindex="-1"`), without scrolling.
- Lists that have `list-style: none` keep an explicit `role="list"`.

### Names and labels

| Control | Accessible name |
| --- | --- |
| Item play button | "Listen from here: {headline}" or "Pause: {headline}" |
| Chapter button | "Listen to {section}, {m:ss}" |
| Mini player open button | "Open the player. {headline}" |
| Mini and transport toggle | "Play" or "Pause" |
| Skip buttons | "Previous item", "Next item", "Back 15 seconds", "Forward 15 seconds" |
| Close buttons | "Close the player", "Close settings", "Close", "Dismiss" |
| Scrubber | "Playback position", with `aria-valuetext` as in section 6 |
| Settings, Generate | "Settings", "Generate" with visible text |
| Covers and icons | Decorative: `alt=""` or `aria-hidden` |

Visible label text always appears in the accessible name.

### Focus

- A visible `:focus-visible` ring on every control: a 2px accent outline with a 2px offset, plus a 2px inner gap in the local surface color, so it reads on any background. It is an outline, so it survives forced colors. Containers that take focus on open (dialogs, the player panel) show no ring of their own; the controls inside carry it.
- Sheets use native `<dialog>` with `showModal()`: focus trap, `inert` background, Escape, and focus restored to the trigger on close. The prototype verifies the restoration.
- The scroll lock sets overflow hidden on the root while a dialog is open.

### Screen-reader announcement plan

Two polite live regions are used alternately and cleared before reuse, so no message is dropped. Focus movement is never used as an announcement.

| Event | Announced | Not announced |
| --- | --- | --- |
| Play, pause by the person | "Playing." "Paused." | The time ticking |
| Item chosen or skipped | "Item 5 of 12: {headline}" | Automatic advance during narration, so a screen reader and the narrator never talk over each other |
| Speed change | "Speed 1.5x." | |
| Digest ends | "Briefing finished." | |
| Generate progress | "Generating. Waiting for a slot." then each step name | Timer ticks |
| Generate finishes | "Briefing ready.", "Nothing cleared the bar.", or "The run failed while writing." | |
| Connectivity | "You are offline." "You are back online." | |
| Toast | Its text, politely | |
| Errors tied to a field | Through `aria-describedby` and `role="alert"` on the inline error | |
| Scrubber | `aria-valuetext`, throttled to once a second while playing | |

### Other

- Color is never the only signal: selection has a ring, status has an icon and text, progress steps have words, the current item has a halo and a different play button.
- 200 percent zoom and a 320px width reflow without horizontal scroll; no fixed heights on text containers.
- Reduced motion, contrast, transparency and forced-colors are handled (section 7.8).
- Targets, hit areas and keyboard behavior as in section 7.

## 9. Sound

Fourteen sounds, one wooden-bar instrument, all synthesized in the browser. Decisions, the sound map table, the recipes, ducking rules, and the real-device test plan are in [sound-design.md](./sound-design.md). The engine is `@dispatch/sound`; the lab for auditioning is [sound-lab.html](../prototype/sound-lab.html).

What the product team needs to know here:

- Sounds confirm discrete events: play, pause, item skip, a scrub crossing an item boundary, a speed change, sheet open and close, Generate started, finished and failed, a switch, the end of a digest.
- They stay silent for scroll, links, hover, theme changes and keyboard navigation.
- While narration plays, sounds that bracket it stay silent and the rest duck. The cue for play is called before the audio starts, and the cue for pause after it stops.
- Default on, off for people who ask for reduced motion, with a switch and a volume slider in Settings.
- iOS plays Web Audio as ambient audio, so a silenced phone plays nothing. That is intended.

## 10. Implementation handoff

### Files

| Path | Role |
| --- | --- |
| `tokens/tokens.json` | Source of truth for every design value |
| `scripts/buildTokens.ts` | Compiles tokens to `apps/web/src/styles/tokens.css`. Run `npx tsx scripts/buildTokens.ts` in `prebuild`; `--check` fails when the committed CSS is stale. Tests assert contrast, concentric radii, the motion ceilings and the freshness of the CSS |
| `apps/web/src/styles/tokens.css` | Generated. Do not edit |
| `apps/web/src/styles/foundations.css` | Reset, base type, focus ring, motion utilities, safe areas, sheet and dialog base. Token references only; a test rejects raw colors and dimensions |
| `packages/sound` | The sound engine, recipes and offline renderer |
| `scripts/prototype/ui-prototype.css` | Component CSS reference: translate it component by component |
| `scripts/prototype/*.ts` | Behavior reference: the fake player store, the rail controller, the scrubber, the sheet controller, the Generate flow |

Import order: `tokens.css`, `foundations.css`, then component CSS. Foundations live in cascade layers, so unlayered component CSS always wins.

Repo notes for whoever owns configuration (outside this task's paths): `biome.json` ignores `!docs/Prototype` but the folder is `docs/prototype`, so Biome lints the generated prototype pages; fix the case or the pages will fail `npm run lint`. The prototype pages are built by `scripts/buildPrototype.ts` and `scripts/buildSoundLab.ts`; add them, `scripts/auditPrototype.ts` and `scripts/checkPrototypeInteractions.ts` as npm scripts when `package.json` is next edited.

One rule for component CSS: elements that toggle `hidden` must still disappear when a component sets `display`. End the component stylesheet with `[hidden] { display: none; }`, or use data attributes for visibility.

### Components and props

Astro renders content as HTML; React islands add behavior. The page is complete without JavaScript, minus audio.

```ts
// Shared shapes come from @dispatch/core: Digest, DigestItem, AudioTimeline, Section.

interface CoverProps {
  digestId: string;
  size: "thumb" | "row" | "hero" | "player";
  paletteBg: string;      // box color shown before the image decodes
  weekly: boolean;        // framing rule
}

interface BriefingProps {
  digest: Digest;
  timeline: AudioTimeline | null;   // null while audio is preparing
}

interface ItemProps {
  item: DigestItem;
  index: number;
  isLead: boolean;                  // first item
  timelineItem: AudioTimeline["items"][number] | null;
}

interface BannerProps {
  tone: "info" | "warning" | "danger" | "success";
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}
```

| Component | Kind | Notes |
| --- | --- | --- |
| `SiteHeader` | Astro | Wordmark, Archive, Generate, Settings. Start padding uses `--window-controls-inset` |
| `DigestHero`, `PlayCta` | Astro shell, React for the CTA | The CTA reads the player store |
| `Briefing`, `Chapter`, `Item` | Astro | Static HTML. `ReaderSync` adds the live state |
| `ReaderSync` | React, headless | Subscribes to the player store and writes attributes and one transform per frame; never rerenders per frame |
| `Cover` | Astro | `<img alt="">` with the palette color as its background |
| `ArchiveList`, `ArchiveYear`, `ArchiveMonth`, `ArchiveRow` | Astro | Native `details` |
| `Banner`, `EmptyState` | Astro | |
| `PlayerProvider`, `usePlayer` | React | One module-scope `Audio` object; state in an external store read with `useSyncExternalStore` |
| `MiniPlayer` | React | Persistent across navigation |
| `PlayerSheet` | React | Full-screen sheet. Implement the pointer controller from `playerSheet.ts`, or drive Base UI Drawer's swipe and read its progress for the cover morph (confirm in the Drawer spike) |
| `Scrubber`, `TransportControls`, `SpeedControl`, `ChapterList` | React | Inside the player |
| `GenerateSheet`, `SettingsSheet` | React with Base UI Dialog or Drawer | Floating panels from the foundations sheet styles |
| `Toaster` | React | Top-layer popover |
| `SoundProvider` | React | Creates the engine, installs the gesture unlock, exposes `play(name, options)` |

```ts
interface PlayerStore {
  getState(): PlayerState;           // { status, time, duration, rate, itemIndex, sectionIndex, scrubbing, hasStarted }
  subscribe(listener: (state: PlayerState, previous: PlayerState) => void): () => void;
  onFrame(listener: (time: number, duration: number) => void): () => void;
  play(): void; pause(): void; toggle(): void;
  seek(time: number): void;
  playItem(index: number): void;
  next(): boolean; previous(): boolean;
  skip(deltaSeconds: number): void;
  setRate(rate: number): void;
  beginScrub(): void; scrubTo(time: number): void; endScrub(time: number): void;
  isNarrating(): boolean;
  itemAt(time: number): number;
}
```

The prototype's `playerStore.ts` implements this with a timer. The real store wraps the audio element, Media Session handlers (play, pause, seekbackward, seekforward, seekto, previoustrack, nexttrack, `setPositionState`) and the saved position per digest.

### Contract between the reader and the player

Data attributes (set by `ReaderSync` and the player; read by CSS):

| Attribute | On | Values |
| --- | --- | --- |
| `data-item-id` | `.item` | The 12-hex digest item id; matches `AudioTimeline.items[].id` |
| `data-index` | `.item` | Zero-based item index |
| `data-chapter` | `.chapter-block` | Section slug: `top`, `ui-craft`, `ai`, `research`, `launches`, `watch` |
| `data-state` | `.item`, `.chapter`, aside links | `played` or `current`. Absent means upcoming |
| `data-live` | `.briefing` | Present while a playhead exists and the digest has not ended |
| `data-lead` | `.item` | Present on the first item |
| `data-current`, `data-playing` | `.item-play` | `"true"` or `"false"` |
| `data-playing` | Any play and pause button | `"true"` or `"false"`; drives the glyph swap |
| `data-loading` | CTA, main play button | `"true"` after 300ms of buffering |
| `data-seeking` | `.rail-fill` | Present for 400ms after a tap or seek, enabling the glide |
| `data-dragging` | `.scrubber` | `"true"` while a scrub is active |
| `data-player-state` | `html` | `idle`, `loading`, `playing`, `paused`, `ended`, `error` |
| `data-mini` | `html` | `hidden` or `visible` |
| `data-player` | `html` | `open` or `closed` (the full player; hides the mini cover while open) |
| `data-view` | `html` | `home` or `archive` |
| `data-theme` | `html` | `light` or `dark`; absent means system |
| `data-cover-key` | `.player-panel` | Present when `--cover-key` is set |

Custom properties:

| Property | Set on | Meaning |
| --- | --- | --- |
| `--player-progress` | Leaf elements only: `.rail-fill` (0 to 1 of rail height), `.mini-progress-fill` and `.scrubber-fill` (0 to 1 of the digest) | Consumed as `scaleY` or `scaleX`. Never set on a parent of content, because the cascade would restyle every child |
| `--cover-key` | `.player-panel` | The cover palette's key color |
| `--player-key`, `--color-cover-accent`, `--player-surface` | `.player-panel` | Derived (section 2) |
| `--range-fill` | `.range` | Fill percentage for the WebKit range track |
| `--i` | Children of `.stagger` | Index for the 40ms stagger |
| `--color-focus-gap` | Raised surfaces | Local override for the inner focus layer |

Events and calls: item play buttons call `playItem(index)`; chapter buttons call `playItem(firstIndex)`; the rail strip resolves a tap to the nearest node and calls `playItem`; the scrubber calls `beginScrub`, `scrubTo`, `endScrub`; the mini player and the full player share the same store, so scrubbing moves the page and tapping an item moves the audio.

### Head, PWA and icons

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f8fb">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a1119">
```

The two hex values come from the generated footer of `tokens.css`. The manifest's `background_color` is `#f4f8fb`; the icon, splash and body share that color so there is no flash. The app icon is the rail mark (a vertical line, its upper half full strength, and a node at the midpoint) in `--color-accent` on the surface color, rendered at build to opaque PNGs including the 180px Apple touch icon:

```svg
<svg viewBox="0 0 16 24"><rect x="7" y="0" width="2" height="24" rx="1" opacity=".28"/><rect x="7" y="0" width="2" height="12" rx="1"/><circle cx="8" cy="12" r="5"/></svg>
```

### Performance rules the design depends on

- The audio object lives in module scope; never in the DOM.
- Progress is written to leaf elements as transforms from `requestAnimationFrame` while playing, and nothing else is written per frame.
- `will-change: transform` is set on the player panel and the scrubber thumb only while they can move.
- `content-visibility: auto` with `contain-intrinsic-size: auto 320px` on items below the fold in long digests.
- No backdrop blur on animating surfaces. Sheets use a scrim, not a blurred background, and the page does not scale back behind the player.
- First-load JavaScript 100 KB gzipped or less; the sound engine adds under 5 KB gzipped.

## 11. Decision log

| Decision | Rule that drove it |
| --- | --- |
| The rail is the signature and doubles as scrubber and progress | frontend-design: one memorable element; apple-design: continuity over novelty |
| Four weights, a fluid scale, size-specific tracking | refactoring-ui scales; apple-design section 15; DESIGN.md fluid type |
| Hover gated, press at 0.97, press-in 100ms and press-out 160ms | DESIGN.md; emil-design-eng; transitions-polish asymmetry |
| Durations through tokens; reduced motion by remapping | DESIGN.md "fewer and gentler, not zero"; CODE.md read durations from custom properties and avoid `!important` |
| Springs for gestures, `linear()` CSS for settles | apple-design sections 3 to 6; web-craft motion; DESIGN.md springs for physics-feel |
| One progress variable `p` for the player; FLIP-style cover morph | apple-design interruptibility; DESIGN.md shared-element continuity |
| No View Transitions for the player cover | Not drivable by a finger or interruptible; web-craft dom-transitions |
| Floating sheets with concentric 28px radius; centered dialogs from 40rem | DESIGN.md concentric radius; modals stay centered |
| Native `dialog` with `@starting-style` and `allow-discrete` | web-craft css-animation |
| Two-layer outline focus ring, containers excluded | web-craft accessibility; better-accessibility |
| Rail strip as one flush target; item buttons 44px with negative-margin growth | interactive-hit-areas; DESIGN.md 44px |
| Items separated by space, not rules | better-layout; visual-hierarchy |
| Summaries dim by color, not opacity | refactoring-ui hard rule on contrast; dark-mode-design |
| Cover accent pinned by lightness per mode | refactoring-ui contrast; web-craft color relative colors |
| Surface elevation by lightness in dark mode | dark-mode-design |
| Tinted, layered, direction-consistent shadows | refactoring-ui and userinterface-wiki visual rules; CLAUDE.md |
| No eyebrows, caps, dots, numbers, gradients, pills | CLAUDE.md persona; frontend-design calibration list |
| Safe areas mirrored once; zero inset valid; iPad corner reserved | apple-web-app; build plan 8.5 |
| Opaque sticky header; status bar from surface | apple-web-app status-bar sampling |
| Sounds: frequency rule, ducking, visual twin, volume, default off for reduced motion | userinterface-wiki sound rules; DESIGN.md delight curve; apple-design multimodal feedback |

## 12. Verification

| Check | Result |
| --- | --- |
| Token tests: contrast in both modes, concentric radii, motion ceilings, scale steps, generated CSS freshness, raw-value ban in foundations | Pass (`scripts/buildTokens.test.ts`) |
| Sound tests: recipe validity, offline-rendered level, length, spectrum, family relationships, engine behavior against a fake context | Pass (`packages/sound/src`) |
| Sample content against `config/voice.md` limits and banned lists; no em dashes in authored files | Pass (`scripts/prototype/sampleContent.test.ts`) |
| axe-core, WCAG 2.2 AA, 10 screens in light and dark | No violations (`scripts/auditPrototype.ts`) |
| Pointer-driven behavior in headless Chrome: play and pause, continuous rail fill, rail tap, scrubber drag with pause and resume, keyboard seek, flick to dismiss, slow release snaps back, swipe up to open, focus return, reduced-motion and sound defaults | Pass (`scripts/checkPrototypeInteractions.ts`) |
| Visual review of every state at 320, 390, 820 and 1280px, light and dark | See [screenshots](./screenshots) |
| userinterface-wiki rules applied by hand to the finished CSS and TypeScript: animation timing, physics, springs, pseudo-elements, view transitions, sound synthesis, typography, visual design, hit targets | Pass, with two deliberate deviations where `~/.agents/DESIGN.md` is the source of truth: exits use ease-out or the drawer curve because DESIGN.md forbids ease-in, and press-in is 100ms (inside DESIGN.md's 100 to 160ms range, below the wiki's 120 to 180ms) |
| Biome and TypeScript on every authored file | Biome: no errors, 16 descending-specificity warnings in the prototype stylesheet (selectors for different elements, harmless). TypeScript strict: clean |

Not verified, because it needs a device: touch gesture feel and momentum on a real phone, iOS status-bar tinting, installed-app safe-area timing, background and lock-screen playback, and how the sounds actually sound. These are on the real-device gate in the build plan; the sound checklist is in [sound-design.md](./sound-design.md).

## 13. Open design questions

1. **Lead headline size.** The Lead role suits headlines of about eight words; the voice allows twelve, which wrap to four lines at 390px. Option: use the Lead role only when the first headline is short, otherwise Title.
2. **Sounds on by default.** The map is restrained, but play and pause happen tens of times a day. Option: ship with Sounds off and let the Settings sample sell it.
3. **Cover contract.** The player needs one key color per palette. Confirm the cover agent's `covers.json` carries one, or derive it from the most chromatic color.
4. **Full-screen player versus a sheet with the page pushed back.** Full screen gives a clean status-bar tint and avoids scaling a long page. A pushed-back page is more native but costs a large layer.
5. **Archive search and month jump** are not designed; the archive at about 180 briefings a year will want them.
6. **A global Space shortcut** for play and pause on desktop is deferred; it conflicts with scrolling.
