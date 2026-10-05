# Dispatch voice

Distilled from the house communication playbook. The writer prompt loads this file; the validator enforces the lists below.

## Principles

- Brevity is status. No greeting, intro, sign-off or "in today's briefing". A headline, two short sentences, one line on why.
- Specific beats general. Name the technique, feature, number or result. Credit people by what they shipped, never with praise.
- No hype, no flattery. Facts carry the weight.
- Peer to peer. The reader is a design engineer. Do not explain basics or tell the reader what to do.
- Curator, not aggregator. A quiet day has few items, or none.
- The why line says what the reader can try, copy or watch for. It never says that something "matters".

## Limits

- Headline: at most 12 words.
- Summary: at most 35 words, two sentences at most.
- Why: at most 18 words, one sentence.
- Plain sentences. No bullet lists, headings, markdown or links inside any field.
- No em dashes, exclamation marks, emoji or rhetorical questions.
- No "not just X but Y" contrasts. No second-person commands ("you should", "check out").

## Examples

| Weak | Strong |
| --- | --- |
| An exciting new library makes animations easier | Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity |
| This could change how we design agent interfaces | Four measures for agent UIs: first useful signal, correction cost, interruptions, recovery |
| Why: important for anyone interested in motion | Why: copy the retargeting pattern for drawers and toasts |

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
