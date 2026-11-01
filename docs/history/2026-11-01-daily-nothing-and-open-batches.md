# 2026-11-01: the 31 Oct daily published nothing; batches left open

Two follow-ups of the half-built audit (H3, C6).

## The daily (D297, #549)

The 31 Oct daily fetched 6 hours (an on-demand briefing had moved the shared `last_fetch_at`), found 11 Tech stories over the Tech allowance, lost two of four in writing, and the refill wrote three more Tech stories that validation cut again. Two survivors against a floor of 3 published nothing after holding the lane 1 h 53 min.

Fixed: the daily's window starts at its own last window (`fetched_through` on the run record), and a section with its own allowance may stand over it only as far as the floor needs (selection, validation and the refill agree on it). Somesh chose this on a decision card. Left to him: the floor itself and a rewrite pass for a 29 against 28 word sentence.

CodeRabbit found real defects in each round (a failed record moving the window, a window end that could move back, the refill ignoring the allowance); each was fixed with a failing test first. The browser suites take about 8 minutes; the gate catches the logic faster.

## Open batches (C6)

D294 cancelled a batch at the cutoff and when status reads failed, but a batch the wait gave up on (cancel not ended, results unreadable) or that a cancelled job left running was billed with no record in the ledger. The write stage now lists each batch it sends in `.cache/run/open-batches.json` and removes it once the results are read; run.yml's `Settle batches` step (before Commit, `always()`, so a cancel runs it too) cancels what is left, waits, and adds its tokens to `.cache/run/spend.json` for the ledger and the run log. The workflow change needs a manual merge.

## Covers header (C8)

Probed production: the `/covers/(.*)` rule in `vercel.json` replaces the handler's own `Cache-Control` on a drawn cover (an hour instead of a year under the current version and a minute otherwise). D293 knew this for the CDN and kept the rule for the covers the build draws. Not changed: dropping it would make every built cover revalidate, and the cost of the hour is a regenerated cover showing old for up to an hour. Revisit if a regenerated cover shows old.
