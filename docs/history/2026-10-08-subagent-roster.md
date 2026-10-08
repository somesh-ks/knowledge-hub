# 2026-10-08: a smaller, enforced subagent roster

## Question

Which subagents fit the owner's work, and how to keep them fast and cheap.

## Findings

- The six existing agents set only `name`, `description`, `model` and `tools`. `deep` and `motion-reviewer` inherited every tool, `reviewer` had open Bash, `researcher` named MCP tools that do not exist here, and none knew the Dispatch rules in `docs/learnings.md`.
- Anthropic's own figures: agents use about 4x chat tokens, multi-agent about 15x. Subagent descriptions share a 15,000 token budget and sit in context each turn. Haiku at low effort skips searches.
- The owner asked for no skills added for their own sake, so no agent preloads one.

## Changes

- Decision D38. Agent files, hook, settings and the global CLAUDE.md roster; `.claude/agents/dispatch-verify.md`, `dispatch-worker.md`, `.claude/skills/close-session/`.
- Deviation from the plan: `Explore` runs at medium effort and 30 turns with read-only Bash, because plan mode sends it multi-file sweeps.

## Open

- Verified in a fresh session (see state.md). `scout` was retired at the owner's word; `general-purpose` lost its MCP tools after one probe cost about 289k tokens.
- The past-chat mining report arrived after the roster was written. Of 214 agent calls, 118 were `general-purpose` on the main model (D38 does not change that), 12 were `deep` used for implementation, and the owner complained on 2026-10-07 that build agents ran on the large model. Candidate follow-ups: a lean default for `general-purpose`, a cap on Composio `max_results` in `researcher`, a sonnet fact verifier.
