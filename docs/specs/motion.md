# Motion

How things move, as rules an agent can apply without asking. The values live in `tokens/tokens.json` (built to `apps/web/src/styles/tokens.css`); the design site's Motion page runs them live. Rests on D94, D95, D230 and the owner's taste in [the ledger](../design-engineering-ledger.md) (section 1).

## The one rule

Nothing moves that the reader did not move, or that does not tell the reader something changed. Motion confirms a press, shows where something went, or says work is going on. It never decorates. A control holds one box across hover, press, checked and played; a state that changes the content gets a hidden copy that holds the room.

## Choosing a token

Ask in this order and stop at the first yes.

1. **Does a fade, a colour or an opacity change?** Use an effects token, never a spring that passes its target.
2. **Does something travel, resize or change shape?** Use a spatial spring; it may overshoot a little. Use the fast one only when a finger is on the thing.
3. **Does it leave or enter the page?** Use `--duration-enter` or `--duration-exit` with `--ease-out`.
4. **Is it a press or hover?** Use `--duration-press-in` (100 ms), `--duration-press-out` (160 ms) and `--duration-hover` (150 ms). In is faster than out.
5. **Nothing above fits?** The motion is probably not needed. Ask before adding a token.

| Job | Duration | Easing |
| :--- | :--- | :--- |
| Press, hover | `--duration-press-in`, `-press-out`, `-hover` | `--ease-out`, `--ease-hover` |
| Fade or recolour | `--duration-state` (200), `-enter`, `-exit`, or `--duration-spring-effects-*` | `--ease-out`, `--ease-spring-effects-{fast,default,slow}` |
| Small move or reshape | `--duration-spring-spatial-fast` (350) | `--ease-spring-spatial-fast` |
| Larger move | `--duration-spring-spatial-default` (420), `-slow` (570) | `--ease-spring-spatial-default`, `-slow` |
| Travel: a thing that stays and moves from where it was to where it is (the nav pill between tabs, a cover between its card and the page's hero) | `--duration-enter` (250) | `--ease-out` |
| Sheet in, out | `--duration-sheet-in` (300), `-sheet-out` (220) | `--ease-drawer` |
| Full-height drawer | `--duration-drawer-full` (500), the one exception to 300 | `--ease-drawer` |

For a generated CSS spring token, the duration is the total curve time until it stays within 0.2% of its target, not how long it feels. A gesture-driven JS spring takes `singularity.perceptualMs` instead; its settling tail runs on after that value. Most of the travel is done in the first 40%, which is why a 420 ms spring still reads as quick. Older springs (`settle`, `release`, `pop`) stay for what already uses them; new work takes the spatial and effects springs.

## Spatial and effects

Material 3 Expressive splits springs in two, and so does this app. A **spatial** spring moves things (position, size, shape) and may pass its target: 9.5% for fast (damping 0.6), 1.5% for default and slow (damping 0.8). An **effects** spring changes opacity or colour and never passes its target (damping 1), because a colour that overshoots flickers. A test fails an effects token that peaks above 1.

The model uses unit mass; each token records stiffness and damping in its `singularity.spring` extension. `scripts/springCurve.ts` draws the `linear()` curve from them; `buildTokens.test.ts` re-derives every curve from its recorded values. The reader's JS integrator (`player/core/spring.ts`) takes a duration and bounce for finger-driven motion; the mapping is duration = 2π/√stiffness and bounce = 1 − damping.

## Reduced motion

Fewer and gentler, never none (D94). Travel collapses: spatial spring and sheet durations become 0.01 ms, distances become 0, the enter scale becomes 1. Fades and effects keep their time, so every state change stays visible. A move written as a raw value needs its own `prefers-reduced-motion` rule; sweep the CSS with the tokens. Anything that loops (a wave, a loader) holds one shape and gives one finite pulse instead. Check with `document.getAnimations()` under emulated reduced motion.

## Calm by default

The owner asked for a conservative start. Where a component has a choice, take the lower bounce: the default and slow spatial springs (1.5%) over fast (9.5%). Use the fast spatial spring only where a finger is on the thing and the reader will feel it, such as a pressed button reshaping.

## Hero moments (proposed, not in the app)

Shown on the design site's Motion page beside what the app does today. Each lands in its own design-system PR the owner merges by hand.

- **Play and pause:** the button is round while paused and a rounded square while playing, squarer under a finger; the glyph morphs from triangle to bars on a spatial spring.
- **Wavy progress:** the played part ripples while audio plays and flattens on pause; the thumb is a pill that narrows when held. It moves only while playback runs.
- **Loading shape:** one shape that keeps changing form while a podcast is made, beside the queue's stage words. Under reduced motion it holds one shape and gives one finite pulse.

## Never

- A spring that passes its target on a fade or a colour.
- A duration over 300 ms, or a plain ease-in (tests fail both). The drawer (500 ms) is the one exception. A spring token's settle time may pass 300 ms; the ceiling measures its own `singularity.perceptualMs` (80 to 240 ms for the six expressive springs).
- `transition: all`, a literal duration, a private easing, a raw length (`styles.test.ts`).
- Animating `width`, `height`, `max-width` or `margin` when `transform`, `opacity` or `clip-path` does the job.
- A control that grows, shakes or shifts its neighbours when its state changes.
- A page that opens with motion: sliding thumbs and underlines move only while used.
- A loop that runs when off screen, when the tab is hidden or under reduced motion.

## Code

`tokens/tokens.json`, `scripts/springCurve.ts`, `scripts/buildTokens.test.ts`, `apps/web/src/player/core/spring.ts`, `apps/web/src/styles/player.css`, and the design site's Motion page.
