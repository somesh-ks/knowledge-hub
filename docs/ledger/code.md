# The code, its gaps and open asks

Ledger sections 5 to 8. Read [the core](../design-engineering-ledger.md) first. Check section 8 before you build something the owner may already have asked for.

## 5. Hacks and mechanisms

Each answers a bug that cost real time here. Reuse them in any web app; the skill queue in section 10 says where each belongs.

| Problem | Mechanism | Where |
| :--- | :--- | :--- |
| A designed page transition never ran; a 330 ms default crossfade did | Astro's swap keeps only fixed root attributes. Copy custom `data-*` onto `event.newDocument.documentElement` in `astro:before-swap` | `scripts/navigation.ts:77` |
| A select's drawn list cannot have a styled backdrop (lightningcss fails the build on `::picker(select)::backdrop`), and a popover's backdrop lets taps through anyway | Draw the sheet's scrim as a second shadow layer, `0 0 0 100vmax var(--color-scrim)`; a list that is no popover (the multi-select) does the same and its card rises to `--z-sheet` while open | `primitives.css` (the phone `::picker` block), `multiselect.css`, `topics.css` |
| A list placed by script (left, top, width) must become a bottom sheet on a phone | The script sets `data-sheet`, clears its inline style and returns before measuring; CSS under 40rem places the sheet | `scripts/picker.ts` `place()`, `picker.css` |
| A toast must swipe away but never undo, and its buttons must keep their presses | Pointer capture on the toast, not on a mouse and not from a button; `translate` follows the finger with transitions off (`[data-dragging]`); past 35% or 0.6 px/ms it slides on and the store dismisses, else the inline translate is cleared and the transition springs it back | `sheets/Toaster.tsx`, `sheets.css` |
| View-transition snapshots cost two frames per move | A one-shot `startViewTransition` stand-in, WeakSet-branded, that swaps at once and marks the new document | `scripts/navigationBoost.ts:66` |
| First press froze 285 ms | `new AudioContext()` took 221 ms inside `pointerdown`. Create it on the first `pointerdown` or `keydown` and queue the first cue | `player/sound/soundController.ts:81` |
| iOS audio stayed locked | `pointerdown` is not an activation for audio; also listen to `pointerup`, `touchend` and `click` | `packages/sound/src/engine.ts:373` |
| Headless tests ran the WebGL effect on a software renderer | `failIfMajorPerformanceCaveat` lets SwiftShader through; read `WEBGL_debug_renderer_info` and match the renderer name | `scripts/ambientLight.ts:114` |
| A 30 fps cap ran at 20 fps | rAF jitter at 60 Hz; compare against `FRAME_MS - 4` | `scripts/ambientLight.ts:89` |
| The canvas blanked on rotation; the palette went stale while stopped | A resize clears the backing store, so draw inside the ResizeObserver; watch `data-theme` and the colour-scheme query and redraw once | `scripts/ambientLight.ts:196-235` |
| Offline pages missed lazy chunks | The service worker's import follower matched `'` and `"` but the bundler emits backtick imports; match backticks, follow six levels, bump the cache version | `public/sw.js:47`, `:214` |
| Hidden elements showed | Author `display` rules beat the UA `[hidden]` rule; add a global rule and test every page | `styles/foundations.css:158` |
| The CSP blocked page scripts | Inlined assets become inline scripts; `assetsInlineLimit: 0` keeps them files | `astro.config.mjs:150` |
| Favicons needed `img-src https:` | A same-origin icon proxy with a letter fallback | `pages/api/site-icon.ts` |
| The head script could not restore view choices | A 512-byte budget; restore anything beyond the theme one frame later from the page script | `scripts/themeInit.js` |
| Two theme keys fought | One preferences key, read by the head script | `player/core/preferences.ts:9` |
| A phone screenshot looked cropped | Headless Chrome has a minimum window width; emulate the device or render inside a 390px iframe | browser suites |
| A picker list drifted from its field | It was placed once; close on scroll (capture, passive) and set `transform-origin` from the trigger | `scripts/picker.ts:198`, `:315` |
| Specificity lint failed on picker rules | `:is()` takes its highest argument, `:where()` is zero; write `html:is([data-astro-nav="peer"], ...)` and order rules by specificity | `styles/view-transitions.css:49` |
| Time zone labels drift with daylight saving | Compute the offset at an instant with Intl, never store it | `packages/core/src/time.ts:78` |
| Cover fonts lost their weight; renders crashed | resvg ignores variable axes (commit static instances) and aborts on blur inside masks (use gradient masks) | `packages/cover/src/fonts.ts:5` |
| Dev pages shipped in the static build | A page flag still emits HTML. The lab pages went; dev tools load only under `import.meta.env.DEV`, and `checkBundle` fails a build that contains them | `src/dev/agentation.ts:12` |
| Throttled profiles measured the wrong bytes | The test server sends uncompressed files; put a gzip proxy in front | `engineering/first-load-js.md` |
| Browser suites failed to bind | Windows reserves ports 4524 to 4623; use 47xx or 48xx, never 4321 (the owner's dev server) | `AGENTS.md` |

## 6. What the code already does well

Worth keeping, and worth copying into new work:
- **Tests hold the craft.**
  - `styles.test.ts` bans raw colours and lengths, `transition: all`, literal durations, hover outside `(hover: hover)`, raw z-index, a third weight, press scale on word controls, and em dashes.
  - `buildTokens.test.ts` holds contrast, motion policy and the reduced-motion remap.
  - The browser suites hold 44px targets, rhythm, axe in both themes, and navigation speed.
- **Interruptible physics.** The spring carries velocity, there is one progress scalar, the state machine separates "committed open" from "position", and the document goes inert the moment an open is decided (`player/core/sheetController.ts`, `spring.ts`).
- **No-shift layout techniques.** Fixed-width chips, hidden sizer copies, checks that take no room, a stable scrollbar gutter, scroll-lock that re-applies the gutter, and reserved rooms for notices.
- **Perceived speed.**
  - Modulepreload links checked at build.
  - Idle loading only while online, because a failed import is remembered.
  - The early-tap capture.
  - A service worker answering moves from a 10-minute copy and swapping in the new page only if untouched.
- **Ambient light** degrades in four steps (WebGL, CSS, still, nothing) and comes with a contrast proof.

## 7. Gaps in the code

Each was found by the code read; the first five were checked by hand on 2026-10-14. None is visible to the owner today. Each is a place where the next change can drift.

1. **Raw values the tests miss.**
   - `scale(0.95)` at `buttons.css:190`, `player.css:166`, `primitives.css:394`.
   - `scale: 0.97` at `picker.css:134,164`, `multiselect.css:173,180`.
   - `scale: 0.6` at `primitives.css:679`.
   - Meanwhile the speed panel uses `--scale-enter` (0.96). Popovers enter at three different scales.
2. **A forced-colours blind spot.** Closed 2026-10-22: the check matches every system colour keyword whole and allows `HighlightText` and `ButtonBorder`.
3. **Stale references.**
   - Four comments cite `pressText.test.ts`, which no longer exists; the rule lives in `styles.test.ts`.
   - `sheets.css:46` says the phone sheet's top corners are round, but `:119` sets `border-radius: 0`, per D106.
4. **Unused tokens.** These are referenced nowhere outside `tokens.css`:
   - `--toast-radius`, `--duration-theme`, `--spring-pop-bounce`, `--player-tint-mix` and the `--breakpoint-*` set.
   - The code read counted 62 of 376 in all.
   - `tokens.json` still promises a per-digest cover accent that nothing implements.
5. **One value, two homes.**
   - Spring durations live in `spring.ts:32` and in `tokens.json`.
   - The hysteresis value lives in `Scrubber.tsx:56` and in its token.
   - State-layer percentages are hard-coded in `hero.css` and `settings.css`, outside the two files the test checks.
6. **Duplicated components.**
   - Two segmented controls (`player.css`, `settings.css`).
   - Two switches (`sheets.css`, `settings.css`).
   - Three sheet systems, each with its own transition list.
   - 36 button class signatures, against a census target of four primitives (`history/2026-10-11-design-systems-audit.md`); Button is now one component (D237), the rest in `designSystem.test.ts`.
7. **Breakpoints and timings written many ways.**
   - The same three breakpoints appeared as `min-width`, `max-width: 63.9375rem`, `not all and`, `width <` and range syntax; one spelling since 2026-10-25, held by a style rule.
   - Idle timeouts of 4000, 3000, 2000 and 200 ms.
   - Scroll thresholds of 64/12 px for the app bar and 48/8 px for the floating button.
8. **Layout properties animated.**
   - The floating button animates `max-width`, `margin` and `inset-block-end`; transforms would avoid layout per frame. The briefing tabs now glide by `translate`, and the scrubber thumb has `will-change` only while dragged (2026-10-22).
9. **Reduced motion is zero, not gentler.** Closed 2026-10-23: travel collapses and fades keep their time (section 3, Reduced motion).
10. **Found by the chat pass.**
    - A stale comment still describes the removed `.daily-listbox` combobox (`primitives.css:468`).
    - The 36px Topics & sources tab was dropped from the 44px check instead of fixed, and "Add source" measures 121x36 (2026-10-09, 2026-10-13).
11. **Four sheet mechanisms for one look** (2026-10-23). The More menu and the picker are popovers placed by CSS; a select's list is a `::picker(select)` popover; the multi-select is a fixed element inside its card, which must be lifted to `--z-sheet` while it is open and gets its scrim from a shadow. One `Sheet` primitive (gap 6, idea 3 in section 9) would retire the lift and the two scrim hacks. A tap on any sheet's scrim still reaches the page under it.

## 8. Owner asks with no record of being done

Each is a chat ask with no later record of being built or dropped. Check the code before building one; some may have been done without a note.

- The New episode button at the navigation items' size (owner list of 2026-10-12).
- Voice preview inside the New episode form (2026-10-12).
- "Narration is not available", reported 2026-10-12 and never diagnosed.
- Regenerate replacing the item in place while it runs, a menu for built-in topics, and Listen now switching itself on (2026-10-13). Then (owner, 2026-10-25): Listen now read as a link, sharing Details' slot; it is now the shared `.btn-primary` in its own grid row (`create-sheet.css .run-play`), Details the shared `.text-link` (`.run-details`), and neither carries the other's classes.
- General chips unticked by default, waiting on an answer from the owner (2026-10-13).
- From the PWA audit of 2026-10-16 (D123), each the owner's call: offline listening of the latest few recordings, iOS startup images in both themes, an iPhone check of the light theme's status bar, and a Gallery and List morph.
- QA defects from 2026-10-08: a Play tap before hydration lost on a phone, a 429 that shows no wait time, focus on opening the expanded player, and "5 min" repeated in an episode's meta. Status unknown.
- Word-level focus in the transcript beyond the spoken-word fill, and a live measurement of time to first sound on Play (2026-10-08).
- The Apple touch icon's alpha: iOS composites it on black (DD-006).
- The played chip growing 11px with a mouse (state.md).
- A real-phone check of the bottom stack, and Safari 27 and WebKit for everything; neither has run.
- An emoji picker on the three group pages (AI, Design, Technology), asked as "edit emojis with a picker" (2026-10-21). Not a rule: a group is not a stored topic, so the picker has no record to save to. It needs a group emoji in the config and its read path, which waits on the owner's group override question (`state.md` Next 1; audit, 2026-10-22).
- Settings changes reaching pages other than Settings instantly. Today they take about a minute through commit and redeploy (D79).
