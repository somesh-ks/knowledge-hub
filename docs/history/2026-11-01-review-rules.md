# Review rules

2026-11-01. The owner: "are we smartly using code rabbit? I like it"; "if the agent can smartly decide when to review a pr, when not to, when to use additional reviewers like coderabbit - all working well is just great."; "I find using local /code-review commands to be a bit useless and waste of tokens. you are welcome to use coderabbit locally before pushing to github."

## What happened

The rolling design-system PR #525 took 44 commits from four threads. CodeRabbit reviewed the first five pushes (7 of the hour's 10 reviews), then paused itself and said so in its summary comment, which nobody read; 40 commits sat unreviewed until this session asked for a review by hand. On every PR the same findings fought the house rules: tests that pin markup, docstrings, generated unit tests, a page rule where the design system already decides.

## What changed

D292: the review follows the tier of the riskiest changed file (none, one review, full review); the CodeRabbit CLI reviews the branch before each push from its own allowance, replacing `/code-review`; and a PR review is asked for when the PR is ready, never fired by a push. `.coderabbit.yaml` turns off incremental reviews, the finishing touches and the docstring check, and carries the test, motion, token and decision-record rules as path instructions. The procedure is [engineering/code-review.md](../engineering/code-review.md); `AGENTS.md`, the PR template (a Review section) and the feature skill point at it.
