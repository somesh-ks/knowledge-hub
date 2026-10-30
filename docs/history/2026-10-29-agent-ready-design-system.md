# Agent-ready design system

2026-10-29. The owner wanted an agent to find the right part for a use case without reading stylesheets, and to stay on the design system when it fixes or builds UI (D236).

## The baseline

19 tasks ("add a switcher between Stories and Transcript", "a sheet's slide-in duration", "link out from a story") given to a small model with only the repo and AGENTS.md: 88.9k tokens, 13 tool calls and 41 s on average, in a 570 KB corpus of stylesheets. Every answer was right. The cost was the search, and the controls guide was the only map; it said Cancel is `.btn-secondary` where every sheet in the code uses `.btn`.

## What was built

`scripts/system/` builds `tokens/system.json` and `tokens/llms.txt`, and `npm run ds` answers from them. Tokens come from `tokens.json`; parts are the owner's wording in `parts.ts` plus facts read from the code. The controls guide's matrix and the feature skill now point at it instead of repeating it.

## With the file

Tokens 71.1k (-20%), tool calls 7.3 (-44%), time 28 s (-31%), on the 14 tasks it was built against and 5 written after. Held-out alone: -25%, -49%, -17%. A token lookup gains less (-12%, -31%): the names carry less of the meaning than a part's use-when does. Floor: each tool call re-sends about 10k tokens of context, so calls are the lever. Four of the 19 runs sent no report and are unscored; the rest were all right.

## What the trial found

- The first `switch` entry named `.switch`, which no markup wears; the real one is `.settings-switch`. An agent saw both and ignored the tool. Class use is now read from markup, not from the word.
- `.player-source-link` copies `.source-link`; a search field is repeated as markup in two pages; `.sheet-actions` stacks Cancel under the primary while dialogs use `.confirm-actions`. These are family work for the design-system PRs.
- Subagents have the thread tools: one posted a stray message. Briefs should say the repo is read-only and to send nothing.

## Open

Serve both files at `/design/system.json` and `/design/llms.txt` once the guide (#423) merges, and move the entries of each family into the registry as its component PR lands. Closed when: both are live and `parts.ts` holds only the families that are not components.
