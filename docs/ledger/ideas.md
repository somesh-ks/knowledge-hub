# Ideas not built

Ledger sections 9 and 10: dreams, and the queue of lessons for the design skills. Nothing here is a rule; read it when you plan new UI or enrich a skill, not before every UI task.

## 9. Dreams

Ideas the record points toward. Each has its value, its cost and the mechanism behind it. Ordered by what I would do first.

| # | Idea | Why it fits this owner | Mechanism | Cost |
| :- | :--- | :--- | :--- | :--- |
| 1 | **Settings live everywhere** | "Reflected instantly" is met only on Settings; every other page waits a minute. | Read schedule, topics and writer at request time from Vercel Edge Config or Blob, with the repo still the record (the config workflow writes both). Pages read runtime config instead of build-time imports. | Large: an architecture change; touches the build, CSP and caching (D79). |
| 2 | **Rubber-band the player and sheets** | Native sheets resist past their rest; ours stop dead (`gestureMath.ts` clamps 0 to 1). | Past the bounds, map travel through `x * (1 - 1/(x*k+1))`, then let the settle spring return. Apply the same to the native and create sheets, which have no drag to dismiss at all. | Small to medium; the spring and state machine already exist. |
| 3 | **One sheet, one segmented control, one switch** | Three sheet systems drift (one had round corners in a comment and square in code). | One `Sheet` primitive with three presentations (bottom, side panel, centred), one timing list and drag on all; fold the duplicate segmented and switch rules. | Medium; mostly deletion, and the browser suites guard it. |
| 4 | **Shared-element cover from card to page** | The owner asked for the cover to grow from the bar; the same grammar from a Library card into the episode hero would make the app feel continuous. | A view transition on the cover only (`view-transition-name` set at the press), keeping chrome still as `view-transitions.css` already does. Not for the player, whose motion must stay finger-driven. | Small; scoped to one element, skipped under reduced motion. |
| 5 | **Haptics paired with sound** | Every control already makes a sound by kind. On Android a 5 to 10 ms tick on detents, toggles and the open threshold is the native feel. | Built (D273): tokens, a dispatcher, an intent on each cue in `soundMap.ts` and `uiCues.ts`, its own On or Off; an iPhone gets a tick by the Safari 18 switch trick, unverified. | Small. |
| 6 | **Token hygiene pass** | The tests are the craft's memory; they have blind spots (gaps 1, 2, 5). | Route the raw scales through `--scale-*`, extend the forced-colours regex, make `spring.ts` read durations from tokens, delete the 62 unused tokens or wire the cover accent, and unify breakpoints in one `@custom-media` file built from tokens. | Small; no visible change. |
| 7 | **Reduced motion done right** | The spec says gentler, not zero (DD-003). | Keep durations and zero only travel (`--translate-enter: 0`, `--scale-enter: 1`), so fades keep their timing. | Small; one token remap and its test. |
| 8 | **CSS Highlight API for the transcript** | The spoken word must never lag (D105). Today each word is a span whose class changes. | `CSS.highlights.set('spoken', new Highlight(range))` paints the word without touching the DOM, which also helps a long transcript on a slow phone. | Small to medium; Chromium and Safari 17.2+, with a fallback to today's spans. |
| 9 | **A per-digest accent in the player** | Promised in `tokens.json`, never built. A briefing's own hue in the scrubber fill and the playing chip ties cover, ambient light and controls together. | `--cover-key` already reaches the frame; derive an accent with `oklch(from var(--cover-key) ...)` clamped to the contrast floors the ambient proof uses. | Medium; needs the contrast proof extended to controls. |
| 10 | **A generating card in the Library** | The run card shows stages; the Library shows nothing until the episode lands. | A placeholder card that draws its cover as stages complete (the cover generator is deterministic from the id) and becomes the real card on publish. | Medium. |
| 11 | **Toast swipe and hover pause** | Every other floating surface responds to the finger. | Swipe sideways to dismiss on touch, pause the 5 s timer on hover or focus (`Toaster.tsx`). | Small. |
| 12 | **Ambient light that breathes with audio** | A dream with a risk: it could become a gimmick. | While playing, modulate the canvas opacity by plus or minus 3% from the narration's RMS, sampled at 10 Hz; off under reduced motion and data saver, never on the CSS layer. | Small to build, and taste decides. I would prototype it and let the owner judge on a phone. |

### My picks
- **Ask the owner first: 1.** It is the only item that makes the latest ask, "settings reflected instantly", fully true. It is also an architecture decision.
- **Build now: 2, 6 and 7.** They are cheap and invisible until they matter, and they protect the "nothing moves that I did not move" taste.
- **Prototype: 12.** It is the one taste call worth showing the owner as a recording.

## 10. Skill enrichment queue

Lessons from this repo that belong in the `sk-design-engineering` plugin (`~/.agents/plugins/sk-design-engineering`, 1.4.2), checked against its skills on 2026-10-14:
- **Covered:** the skill already says it; leave it.
- **Partial:** add the missing half.
- **New:** the skill says nothing.

The rule text is written to paste, project-neutral. Coverage was judged by keyword search with a few files read, so confirm each before adding. Make the changes through `sk-skill-creator`, keep them lean, and do not duplicate what a reference already says.

### Proposed new reference files

| File | Holds | Why |
| :--- | :--- | :--- |
| `web-craft/references/audio-and-player.md` | One timeline and one transport, the AudioContext warm-up, the iOS unlock, the sound policy, interruptible sheet physics (one progress scalar, a velocity-carrying spring, flick and distance thresholds, slop anchoring), never caching media | Six rules cluster here; `dom-input.md`'s click-sound section would move into it |
| `web-craft/references/service-worker.md` | Stamped page copies, a background recheck, expiry on a version file, the import follower (backticks, depth), cache version bumps, never caching Range requests, one reload after a deploy | No service-worker guidance exists |
| `web-craft/references/webgl-ambient.md` | The four-step degrade, software-renderer detection, a jitter-tolerant frame cap, redraw on resize and theme, `isConnected` before mounting, the idle fallback, a contrast proof over every palette | No canvas or WebGL guidance exists |
| `build-design/references/feedback-and-copy.md` | Silence by default, affordance over instruction text, three- or four-word status, one message per live region, optimistic UI for slow work | Process and product-feel rules have no home |

### Rules

| # | Rule to add | Target | Status | Evidence here |
| :- | :--- | :--- | :--- | :--- |
| 1 | Before designing, name the reference product and copy its behaviour and its names; a destination is called what that product calls it. | build-design (process) | New | §1.1, §4 Archive |
| 2 | Treat every layout shift as a bug: fixed-width chips, a hidden widest-value copy under changing text, checks that take no room, `scrollbar-gutter: stable`, reserved room for notices. | web-craft `css-visual.md` | Partial | §3 Small component fixes |
| 3 | Confirm with the changed control, not a toast. Background saves are silent; status copy is three or four words and appears only when the user can act. | feedback-and-copy (new) | New | §1.3, D115 |
| 4 | Never write instruction text a control can make obvious. A glyph says what a press does; a control that cannot act stays visible, dimmed and named. | baseline-ui | Partial | §1.5 |
| 5 | Keep the accent fill for the one primary action and for current state; transport and secondary controls stay unfilled. Destructive red appears only inside the confirm. | refactoring-ui `systems.md` | Partial | §1.6 |
| 6 | One timeline and one transport on screen at a time; a second scrubber for the same audio is a defect. | audio-and-player (new) | New | §3 The player |
| 7 | Never set a small meta line directly above a headline; secondary text goes below with a full spacing step. | page-layout `grouping-and-alignment.md` | New | §1.9 |
| 8 | When one card has two targets (art plays, title opens), give them different hover states. | page-layout `spacing-and-adaptivity.md` | Partial | §1.5, D101 |
| 9 | Siblings in one group share one size, including a primary action placed among navigation items. | refactoring-ui | New | §1.6 |
| 10 | Popover and select lists: equal inner padding top and bottom, the page's surface, and a screenshot of the open state before shipping. | animation-rules `component-craft.md` | Partial | §3 Fields and selects |
| 11 | A segmented control's chosen item takes a full outline or container, never a bottom border alone; words never scale on press. | web-craft `components.md` | New | §3 Press, hover and focus |
| 12 | Measure perceived speed before optimising: move timings, LCP and time to a pressable control on a throttled phone profile, behind a gzip proxy if the test server does not compress. | web-craft `performance.md` | Partial | §2.9 |
| 13 | Astro's client router drops custom root attributes on swap; copy them onto `newDocument` in `astro:before-swap`. For moves under 50 ms, swap without a snapshot transition. | web-craft `dom-transitions.md` | Partial | §5 |
| 14 | Create the AudioContext on the first `pointerdown` or `keydown`, before a click needs it, and queue the first cue; construction can take over 200 ms on a phone. | audio-and-player (new) | Partial | §5 |
| 15 | WebGL effects: detect software renderers by name, cap frames at the interval minus a few ms, redraw on resize and theme change, check `isConnected` before mounting a lazily imported module, and fall back to `setTimeout` where `requestIdleCallback` is missing. | webgl-ambient (new) | New | §5, §3 Ambient light |
| 16 | A service worker that follows imports must match backtick-quoted dynamic imports; bump the cache version after any chunking change; never cache Range requests or media. | service-worker (new) | New | §5 |
| 17 | `[hidden]` loses to any author `display` rule; ship a global rule and a test. | web-craft `css-visual.md` | Partial | §5 |
| 18 | Headless Chrome has a minimum window width: capture phones with device emulation or a phone-width iframe, in both themes, with open and playing states. | web-craft-audit `browser-pass.md` | Partial | §2.4 |
| 19 | `:is()` takes the specificity of its highest argument and `:where()` is zero; order rules so specificity never descends. | web-craft `css-visual.md` | Partial | §5 |
| 20 | Compute a time zone's offset at an instant with Intl; never store or prerender it. | web-craft `dom-input.md` | New | §5 |
| 21 | Reduced motion is gentler, not zero: keep fade durations, zero only travel and scale. | animation-rules | Covered | §7.9 shows the gap in this repo |
| 22 | Prove contrast in code over every palette in both themes. Opacity-dimmed text fails; mark a locked or unavailable choice with a glyph and an edge, or do not draw it. | refactoring-ui `diagnose.md` | Partial | §3 Colour, §4 |
| 23 | resvg and other server SVG renderers ignore variable-font axes (ship static instances) and can crash on blur inside masks (use gradient masks). Compose a social card at its own size, never crop it. | web-craft `typography.md` | New | §3 Covers |
| 24 | iOS: `pointerdown` does not unlock audio. Also listen to `pointerup`, `touchend` and `click`, and set `navigator.audioSession.type = "playback"` where it exists. | audio-and-player (new) | New | §5 |
| 25 | Every enabled control makes a sound by kind through one delegated listener; hover, focus, scroll, typing and successful background saves are silent. Silence on a press reads as broken. | audio-and-player (new) | Partial | §3 Sound |
| 26 | A repeated ask is a hard requirement. Do not remove a control or delete content to simplify without asking; such removals tend to come back. | build-design (process) | New | §1 Repeat asks, §4 |
| 27 | Review loop: references first, screenshots at desktop and phone sizes in both themes, open states seen by eye, one PR per piece, and a list of what headless could not verify. | build-design (process) | Partial | §2 |
| 28 | Put colour transitions on the hover state only, so a theme switch never shows a mid-fade colour. | web-craft `color.md` | Partial | §3 Press, hover and focus |
| 29 | Grow a field on focus only with a fine pointer, so nothing moves under a tap. | web-craft `mobile.md` | Partial | §3 Fields and selects |
| 30 | A 44px target drawn with `::after` must subtract the control's border, or it lands short. | page-layout `spacing-and-adaptivity.md` | Partial | §3 Press, hover and focus |
| 31 | Changing digits sit over a hidden copy of the widest value and snap to device pixels, so they never shimmer. | web-craft `typography.md` | Partial | §3 Small component fixes |
| 32 | A sticky element centred with `translate: -50%` blurs on odd heights; use a measured `calc()` offset. | animation-rules `transforms-and-clip-path.md` | Partial | §3 Small component fixes |
| 33 | A popover placed once must close or re-place on scroll (capture, passive) and take its `transform-origin` from the trigger. | web-craft `dom-input.md` | Partial | §5 |
| 34 | When visual order differs from DOM order, change the DOM; `reading-flow` is Chromium only. | page-layout | Covered (add the `reading-flow` note) | §3 The player |
| 35 | Slow server work answers at once on the device (hide the deleted item, land on the list) while the job runs. | feedback-and-copy (new) | New | §3 Reading pages and the Library |
| 36 | Generative art is approved on a contact sheet at real size before it is wired: one gesture, one accent, no template repeated next to itself. | build-design (process) | New | §3 Covers, §4 |

### Gaps in the audit skill
`web-craft-audit` has no checks for layout shift, `[hidden]` overrides, unseen open states, or a duplicated timeline. Add them to its signals once rules 2, 6, 10 and 17 land.
