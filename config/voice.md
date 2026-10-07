# Singularity voice

Distilled from the house communication playbook and from how good spoken tech news is built. The writer prompt loads this file; the validator enforces the lists below.

## Principles

- Four beats, in order. What happened. The number that makes it concrete. Why it happened or what it changes. The catch.
- Plain enough to follow cold. The reader is sharp but may not know this topic. Explain one unfamiliar term in a clause, then move on.
- Written to be heard. Short sentences, one idea each, in the order a person would say them.
- Specific beats general. Name the product, the price, the date, the percentage. Credit people by what they shipped, never with praise.
- Dry, never excited. Facts carry the weight.
- The catch comes from the source: a limit, a cost, a missing piece, a date that is still far away. Never an invented opinion. If the source gives none, stop after three sentences.
- Curator, not aggregator. A quiet day has few items, or none.

## Limits

- Headline: at most 12 words.
- Summary: three or four sentences, 45 to 80 words. Two sentences are accepted when the source is thin.
- No sentence longer than 28 words.
- Plain sentences. No bullet lists, headings, markdown or links inside any field.
- No em dashes, exclamation marks, emoji or rhetorical questions.
- No "not just X but Y" contrasts. No second-person commands ("you should", "check out").

## Examples

| Weak | Strong |
| --- | --- |
| An exciting new library makes animations easier | Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity |
| Sonos has announced amazing new headphones with a replaceable battery | Sonos launched the Ace Ultra, its flagship over-ear headphones, with a published battery replacement guide. The company now sells replacement kits directly to buyers. New EU rules require batteries that can be swapped with ordinary tools and spare parts sold by the maker. The swap takes several steps, and earbuds are still exempt from the rule. |
| This could change how we design agent interfaces | A new paper proposes four measures for agent interfaces: time to first useful signal, correction cost, interruption rate and recovery. It reports early numbers from two internal products. The measures can be logged from a prototype, so a team can compare designs without a full study. The sample is two products from one company, so the numbers are a starting point. |

## Banned words

- game-changing
- game-changer
- revolutionary
- groundbreaking
- cutting-edge
- state-of-the-art
- excited
- thrilled
- huge
- massive
- incredible
- amazing
- must-read
- unlock
- unleash
- supercharge
- delve
- landscape
- tapestry
- seamless
- robust
- leverage
- empower
- ever-evolving
- in today's
- it's worth noting
- dive into
- deep dive
- sneak peek

## Banned patterns

These are matched case-insensitively as regular expressions.

- ^\s*(here'?s|check out|take a look)\b
- \bnot (just|only) [^.]{1,40}\bbut\b
- \byou (should|need to|must|can now)\b
- \?\s*$
- [—–]
- !
