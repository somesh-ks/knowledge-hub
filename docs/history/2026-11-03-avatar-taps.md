# 2026-11-03: the avatar answers a tap

The owner asked that a tapped avatar make faces, morph into other shapes and come back, or do something small like waving or looking through binoculars, by mood and hue, kept lean but with variety (D353).

What was built. `avatar.ts` draws two hidden props in every avatar (a hand, binoculars placed on the shape's own eyes). `avatar.css` plays the shows on `data-play`: wink, wow, wave, scout, spin, boo, pop, and the existing hop; each mood lists its own in `--av-plays`. `avatarReactions.ts` holds the two pure choices (which show, which shapes a morph visits), `accountAvatar.ts` plays them: one tap plays the next show of the list from a start the hue's band sets, a morph swaps shapes with a pop and ends on the reader's own, and a tap in the app bar plays on the profile after arrival. Reduced motion and offline play nothing.

Choices. Ordered, not random: a repeat reads as a bug and a fixed order is testable. No new duration token (llms.txt was 7 bytes from its 14 KB cap); the shows reuse the avatar's look, hop and shake durations. The show rules sit after the state rules so they win over the bob while audio plays. The props are the body colour (the hand) and the face colour (the binoculars), so they follow every mood and hue by the tokens.

Checks. One unit test for the two choices, one browser journey (five taps give different shows, a morph visits other shapes and ends home, nothing plays for a calm reader). Clips per mood from the built site were sent for approval before any PR.
