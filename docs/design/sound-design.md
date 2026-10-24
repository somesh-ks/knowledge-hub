# Singularity sound design

> The engine lives in `packages/sound`. Hear every sound in [sound-lab.html](../prototype/sound-lab.html); see them in context in [ui-prototype.html](../prototype/ui-prototype.html).

Singularity is a quiet reading and listening app. Its sounds exist to confirm, never to decorate. Fourteen sounds, one instrument, all synthesized in the browser with no audio files.

## Principles

| Principle | What it means here | Rule that drove it |
| --- | --- | --- |
| Frequency decides weight | The more often an action happens, the quieter and shorter its sound, or no sound at all. Scroll, link taps, hover, theme changes and keyboard navigation are silent | DESIGN.md delight-impact curve; `appropriate-no-high-frequency`, `appropriate-no-decorative` |
| Sound confirms an event | Every sound marks a state change the person caused or is waiting for: play, skip, commit, done, failed | `appropriate-confirmations-only`, `weight-match-action` |
| Every sound has a visual twin | No sound carries information alone. The table below pairs each with what the screen shows | `a11y-visual-equivalent` |
| Errors inform, never punish | The error is a muted low thud, quieter than the success chime | `appropriate-errors-warnings`, `appropriate-no-punishing` |
| Narration is sacred | UI sounds skip or duck while narration plays, and the engine never touches the narration element or its audio session | Build plan section 8.4 |
| Off means off | A Sounds switch, a volume slider, reduced-motion default off, and silence while the page is hidden | `a11y-toggle-setting`, `a11y-volume-control`, `a11y-reduced-motion-check` |
| Subtle by default | Peaks at or below -13 dBFS at full volume, and the default volume is 0.8 | `impl-default-subtle` |
| Short | Everything under 150 ms except one signature chime | `weight-duration-matches-action` |

## The family

All fourteen sounds are one voice: a felt-hammered wooden bar, like a marimba or kalimba under a soft mallet. A family has to be recognizable after three sounds, so every choice is shared.

### Timbre

- **Tone.** A sine fundamental plus a quiet second partial at 4 times the frequency that decays in 45 percent of the time. That overtone ratio is what a tuned marimba bar has, and it is the difference between a wooden "tock" and a synthesizer beep.
- **Touch.** A short burst of seeded noise through a low-pass between 420 and 900 Hz, the felt meeting the bar. It sits well below the 3 to 6 kHz band a plastic click would use. The noise is the same samples every time, so repeated presses read as one physical object.
- **Space.** One shared low-pass at 3.6 kHz sits at the end of the chain, so nothing above about 4 kHz reaches the speaker. Measured energy above 4 kHz is under 0.1 percent on every sound.

### Tuning

Every resting pitch comes from D major pentatonic: D, E, F sharp, A, B. A pentatonic set contains no semitone or tritone clashes, so any two sounds that overlap, and any run of scrub ticks, stay consonant. The pitches run from A3 to F#5 for events and D4 to A5 for the scrub ladder.

### Direction carries meaning

| Motion | Meaning | Examples |
| --- | --- | --- |
| Rising into the note | Forward, on, open, start | Play, switch on, sheet open, Generate started |
| Falling onto the note | Back, off, close, stop | Pause, switch off, sheet close |
| Two notes up | Next | Next item climbs B4 to E5 |
| Two notes down | Previous | Previous item falls E5 to B4 |
| Three notes stepping down | Settled, finished | End of digest: F#5, D5, A4 |
| Two sustained notes up a fourth | Resolved, arrived | Generate finished: A4 to D5 |

### Weight

Level, length and note count rise with importance. Taps are one note under 110 ms. Skips are two grace notes. The end of a digest is three. Only the finished Generate run is sustained, and it is the one sound over 150 ms. Errors are the lowest sound in the family and quieter than the signature.

## Sound map

Numbers come from the offline renderer that the tests also use, at master volume 1.0, position 0.5 and rate 1.25. The audible figure is the time of the last sample above -60 dBFS.

| Event | Sound | Length | Pitch | Level | While narration plays |
| --- | --- | --- | --- | --- | --- |
| Narration starts | `play` | 105 ms, audible 72 | D5, rising | -15.9 dBFS peak | Skipped |
| Narration stops | `pause` | 93 ms, audible 63 | A4, falling | -18.3 dBFS peak | Skipped |
| Skip to the next item | `itemNext` | 109 ms, audible 88 | B4 to E5 | -18.9 dBFS peak | Ducked 9 dB |
| Skip to the previous item | `itemPrev` | 109 ms, audible 88 | E5 to B4 | -18.7 dBFS peak | Ducked 9 dB |
| Scrubber crosses an item boundary | `scrubDetent` | 42 ms, audible 27 | D4 to A5 by position | -25.5 dBFS peak | Ducked 9 dB |
| Playback speed changes | `speedChange` | 103 ms, audible 70 | F#4 to F#5 by rate | -16.9 dBFS peak | Ducked 6 dB |
| A sheet opens | `sheetOpen` | 99 ms, audible 67 | D4, rising | -17.6 dBFS peak | Skipped |
| A sheet closes | `sheetClose` | 73 ms, audible 48 | D4, falling | -22.2 dBFS peak | Skipped |
| A Generate run starts | `generateStart` | 123 ms, audible 84 | A3, rising | -16.7 dBFS peak | Ducked 6 dB |
| A Generate run finishes | `generateDone` | 763 ms, audible 579 | A4 to D5 | -13.1 dBFS peak | Ducked 3 dB |
| Something failed | `error` | 133 ms, audible 88 | A3, sagging | -17.8 dBFS peak | Ducked 3 dB |
| A switch turns on | `toggleOn` | 65 ms, audible 44 | F#5, rising | -19.7 dBFS peak | Ducked 9 dB |
| A switch turns off | `toggleOff` | 59 ms, audible 40 | A4, falling | -20.6 dBFS peak | Ducked 9 dB |
| The last item finishes | `digestEnd` | 149 ms, audible 126 | F#5, D5, A4 | -20.0 dBFS peak | Ducked 6 dB |

At the default volume of 0.8 the master gain is 0.64 (-3.9 dB), so the signature peaks near -17 dBFS and a play tap near -20 dBFS.

### Visual twin of every sound

| Sound | What the screen shows at the same moment |
| --- | --- |
| `play`, `pause` | The play button swaps glyph with a scale and blur; the rail starts or stops filling |
| `itemNext`, `itemPrev` | The current item node moves and the page scrolls to the item |
| `scrubDetent` | A tick on the scrubber passes under the thumb and the bubble changes item number |
| `speedChange` | The segmented control selection moves |
| `sheetOpen`, `sheetClose` | The sheet slides, scrim fades |
| `generateStart`, `generateDone` | The progress list starts, then the success banner appears |
| `error` | An inline error with an icon and text |
| `toggleOn`, `toggleOff` | The switch thumb moves and its track changes color |
| `digestEnd` | The rail fills to the end and the button reads "Play again" |

### Deliberately silent

Scrolling, link taps, hover, theme changes, keyboard navigation (arrow-key seeking makes no scrub ticks), the 15-second skips, chapter list taps beyond the play cue they trigger, cancelled gestures, "Nothing cleared the bar." and any repeat inside a sound's retrigger window.

## Recipes

Each sound is a data object in `packages/sound/src/recipes.ts`. Envelopes are exponential: they start at -80 dBFS, rise to the peak over 2 to 4 ms, then fall back to -80 dBFS over the decay time. Peak is linear amplitude with full scale at 1. "Felt" is the noise layer; its raw level is before its low-pass, which removes most of it.

| Sound | Layers |
| --- | --- |
| `play` | Bar D5 peak 0.13, decay 102 ms, enters 3.5 percent flat and rises over 28 ms; wood partial 0.22; felt LP 700 Hz raw 0.38 decay 14 ms |
| `pause` | Bar A4 peak 0.11, decay 90 ms, enters 3.5 percent sharp and falls over 28 ms; wood partial 0.22; felt LP 700 Hz raw 0.34 decay 12 ms |
| `itemNext` | Bar B4 peak 0.095 decay 56 ms at 0 ms; bar E5 peak 0.11 decay 62 ms at 44 ms; wood partial 0.18; felt raw 0.27 decay 10 ms |
| `itemPrev` | The same, E5 then B4 |
| `scrubDetent` | One bar at the ladder pitch for the position (D4, E4, F#4, A4, B4, D5, E5, F#5, A5) peak 0.055, attack 2 ms, decay 40 ms; wood partial 0.12 |
| `speedChange` | Bar at the pitch for the rate (0.75x F#4, 1x A4, 1.25x B4, 1.5x D5, 1.75x E5, 2x F#5) peak 0.125, decay 100 ms, rising from 6 percent flat over 32 ms; wood partial 0.22; felt raw 0.37 decay 14 ms |
| `sheetOpen` | Bar D4 peak 0.105 decay 96 ms rising from 6 percent flat over 40 ms; wood 0.12; felt LP 520 Hz raw 0.51 decay 40 ms |
| `sheetClose` | Bar D4 peak 0.08 decay 70 ms falling from 6 percent sharp over 30 ms; wood 0.10; felt LP 440 Hz raw 0.51 decay 30 ms |
| `generateStart` | Bar A3 peak 0.125 decay 120 ms rising from 10 percent flat over 60 ms; wood 0.16; felt LP 600 Hz raw 0.45 decay 18 ms |
| `generateDone` | Bar A4 peak 0.135 decay 300 ms with 4x partial 0.2 and 2x partial 0.1, doubled by a unison at +5 cents peak 0.052; felt raw 0.30; at 120 ms bar D5 peak 0.15 decay 640 ms with the same partials, doubled at -5 cents peak 0.057 |
| `error` | Triangle A3 peak 0.115 decay 130 ms through LP 900 Hz, sagging from 8 percent sharp over 60 ms; felt LP 420 Hz raw 0.70 decay 45 ms |
| `toggleOn` | Bar F#5 peak 0.105 decay 62 ms rising from 4 percent flat over 18 ms; wood 0.14; felt LP 800 Hz raw 0.42 decay 12 ms |
| `toggleOff` | Bar A4 peak 0.09 decay 56 ms falling from 4 percent sharp over 18 ms; wood 0.14; felt LP 650 Hz raw 0.42 decay 12 ms |
| `digestEnd` | Bars F#5 at 0 ms, D5 at 38 ms, A4 at 76 ms, peaks 0.08, 0.09, 0.10, decays 58, 60, 70 ms; wood 0.14; felt raw 0.24 decay 10 ms |

The two detuned unisons in `generateDone` beat at about 1.3 Hz, which is the slow shimmer on the tail.

## Narration and ducking

Decision rule: a sound that brackets narration is silent while narration plays, because speech is the thing being confirmed. A sound that confirms something speech cannot tell you ducks. A sound that would otherwise sit on top of speech every time a sheet opens, which is the most common flow, stays silent.

| Sound | While narrating | Why |
| --- | --- | --- |
| `play`, `pause` | Skipped | They start and stop the speech. Call `play` before starting the audio element and `pause` after it has paused, so each plays into silence |
| `sheetOpen`, `sheetClose` | Skipped | Opening the full player while listening is the common case; a knock under every sheet would crowd the speech |
| `itemNext`, `itemPrev` | Ducked 9 dB | Speech cuts to a new item; the tick confirms the jump |
| `scrubDetent` | Ducked 9 dB | The player pauses narration during a scrub, so this usually plays at full level; the duck covers the rare overlap |
| `speedChange`, `generateStart`, `digestEnd` | Ducked 6 dB | Confirmations that matter but must not talk over the voice |
| `generateDone`, `error` | Ducked 3 dB | The two events a listener must not miss |
| `toggleOn`, `toggleOff` | Ducked 9 dB | Settings are touched while listening; the switch is quiet and brief |

## Engine rules

`createSoundEngine({ isEnabled, getVolume, isNarrationPlaying })` returns `{ play, unlock, dispose, activeVoices }`.

1. **Lazy context.** No `AudioContext` exists until `unlock()` runs inside a user gesture. `installGestureUnlock(engine)` hooks `pointerdown`, `touchend` and `keydown` on the document and stays installed, because iOS can interrupt a context (a call, an alarm) and a later gesture must resume it.
2. **One context.** The engine reuses a single context and a single master chain: input gain, a 3.6 kHz Butterworth low-pass, and a safety compressor whose threshold sits above every recipe's peak.
3. **No late bursts.** If the context is suspended or interrupted, the call is dropped and `resume()` is requested. Scheduling into a suspended context would replay as a burst on resume.
4. **Hidden means silent.** Nothing plays while `document.hidden`.
5. **Narration.** The engine only calls `isNarrationPlaying()`. It never touches the narration element or `navigator.audioSession`.
6. **Four voices.** The oldest voice fades out in 12 ms to make room for a fifth.
7. **Retrigger windows.** Each sound has a minimum interval, from 55 ms for the scrub tick to 1 second for the end of digest, so a fast tap cannot stack mush.
8. **Clean nodes.** Every layer disconnects when its source ends, and envelopes never target zero (they target -80 dBFS), so nothing clicks.
9. **iOS.** Web Audio on iOS follows the silent switch and is ambient. A silent phone plays no UI sound. That is correct and intended; narration through the `<audio>` element is unaffected.

### Settings and defaults

- Sounds are on by default and off by default for people who set `prefers-reduced-motion: reduce`, since the preference often signals sensitivity to stimulation in general. `defaultSoundsEnabled()` returns that. An explicit choice always wins.
- The volume slider maps 0 to 1 through a quadratic taper (half the slider is a quarter of the gain), so it feels even. Default 0.8.
- The Sounds switch plays `toggleOff` just before the engine goes quiet, a last confirmation, and `toggleOn` when it comes back. Moving the volume slider plays `toggleOn` on release so the level can be judged.

### Wiring

```ts
const sound = createSoundEngine({
  isEnabled: () => prefs.sounds,
  getVolume: () => prefs.volume,
  isNarrationPlaying: () => player.isPlaying(),
});
installGestureUnlock(sound);

// Cue first, so it lands in silence, then start the audio.
sound.play("play");
audio.play();

// Pause first, then the cue, for the same reason.
audio.pause();
sound.play("pause");

sound.play("scrubDetent", { position: boundaryTime / duration });
sound.play("speedChange", { rate: 1.5 });
```

## Test plan for real devices

Offline rendering proves level, length, pitch and spectrum. It cannot prove that the sounds are pleasant, balanced against each other, or well behaved around real audio sessions. Run this before shipping, and open [sound-lab.html](../prototype/sound-lab.html) on each device.

| Check | Device | Pass when |
| --- | --- | --- |
| Silent switch | iPhone, ringer off | No UI sound, narration still plays |
| Ringer on, lock screen | iPhone | Narration plays with the screen locked; UI sounds stop when the page is hidden |
| Narration is not disturbed | iPhone and iPad, installed to the Home Screen | A UI sound never pauses, ducks or restarts the narration, and never pauses another app's audio |
| Interruption | iPhone | After a call or alarm, the next tap resumes sounds without a burst |
| Speaker level | iPhone speaker, Android speaker | Taps are audible at 50 percent system volume in a quiet room and never startling; the signature is clearly the loudest |
| Headphones | AirPods or wired | No harshness, no click at the start or end of any sound |
| Bluetooth latency | A Bluetooth speaker | Note the lag; sounds that arrive after the visual are acceptable, sounds that lead are not |
| Ducking | Phone, with the lab's narration switch or the prototype's device voice | Skipped sounds are silent, ducked sounds are audible but clearly under the voice |
| Rapid taps | Any | Mashing next, the speed control and the switch never produces a stack of overlapping sounds or distortion |
| Volume | Any | The slider gives an even change from silent to full; zero is silent |
| Reduced motion | iOS and macOS with the setting on | The Sounds switch starts off |
| Desktop browsers | Safari, Chrome, Firefox | The first click unlocks audio; background tabs stay silent |
| Family check | Any, headphones | Play the lab's typical session. The sounds read as one instrument, the signature is unmistakable, the error is dull and low |

If a sound disappoints, change it in `recipes.ts`, run `npm test`, and listen again in the lab.

## Tuning guide

| If it sounds | Change |
| --- | --- |
| Too harsh or bright | Lower the wood partial gain, lower the master low-pass, or lower the felt filter frequency |
| Too muffled or dull | Raise the wood partial gain or the felt filter frequency |
| Too long | Shorten the decay |
| Cuts off abruptly | Lengthen the decay; keep exponential envelopes |
| Too mechanical | Lower the felt layer, add a 3 to 5 cent detuned unison |
| Too much like a beep | Raise the wood partial and the felt; shorten the attack to 2 ms |
| Too loud | Lower the peak, never the master filter; tests cap the peak at -12 dBFS |
| Two sounds too alike | Change direction, note count or register before changing timbre |

## What was verified, and what was not

Verified by tests in `packages/sound/src`:

- Every recipe has finite numbers, attacks of 2 to 8 ms, tone peaks at or below 0.25, and every resting pitch inside the pentatonic set.
- Every non-signature sound is under 150 ms; the signature is under 800 ms; exactly one sound is the signature.
- Rendered output never exceeds -12 dBFS at full volume across the parameter extremes, starts and ends at silence, has no DC offset, keeps under 0.1 percent of its energy above 4 kHz, and has a spectral centroid between 150 and 1800 Hz.
- The felt layer stays between 10 and 100 percent of the tone's peak.
- The signature is the loudest sound; the scrub tick is the quietest; the error is in the low register and quieter than the signature; every sound has a distinct fingerprint.
- The engine, run against a fake audio context, creates no context before `unlock`, drops calls when disabled, hidden, silent, suspended or inside a retrigger window, applies the per-sound narration policy, caps voices at four, and schedules envelopes that start and end at the floor.

Not verified, because it needs ears and devices: how pleasant and distinct the sounds are, the balance between them on a phone speaker, iOS audio-session behavior, and Bluetooth latency. The test plan above covers them.
