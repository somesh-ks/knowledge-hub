# Hardening round 4, and landing the finished branches

2026-10-22. D155 (amended in review), D157; the map is [engineering/hardening.md](../engineering/hardening.md).

## Asked

The standing goal: harden the app in every aspect, with systems that spot faults in reliability, performance, quality and security and heal where safe, through a dedicated Opus subagent. Then, after many Vercel deployments failed: stop it happening again and keep at most two preview branches; then put the finished branches, other sessions' included, online.

## What changed

- Failed deployments were previews, not production: the Neon integration made a database branch per preview and hit the free limit. `vercel.json` now deploys only `main` and `preview/*`, and `branches.yml` deletes closed branches and trims Neon previews to two (#215).
- Landed #205 (knobs that grow while held), #206 (cost charts), #216 (Software Engineering, from #209) and #218 (the Settings round, from #213). #209 and #213 conflicted with main and this session pushes to one branch, so each landed as a merge onto main in its own PR.
- #216's review put back the 6% cap on judged tool launches, which #209 had lifted as a "judgment call" against the owner's asks of 2026-10-15 and 2026-10-18. It also let engineering sources through the prefilter, kept the 2026-10-18 weekly valid, and let an old preferences row parse.
- CI: the `browser` job gets 45 minutes (#216 needed 33.7; #213 was cut off at 30 with every test passing). The eval's rewrite skips a story the model left empty.
- D157 (a dedicated Opus audit, then an Opus worker over three review rounds): Neon and stored-config faults and warnings, a deploy-behind warning, the site's narration in the month budget, one weekly `health-warnings` issue, and one newest-first order for site, status and health.

## What review caught

- Three rounds on the health batch, each finding false faults: a waking Neon, an edit made during a run, a site newer than the checkout, Dependabot merges Hobby never deploys, a regenerate read as a late run. The rule that came out of it: a fault is what the owner can act on and what holds for a day; the rest are warnings, read weekly. `run_late` was built and removed.

## Left open

- The passphrase-cap holes on `claude/lock-actions` (another session's branch) are with the owner to pass on.
- `ignoreCommand` diffs only `HEAD^..HEAD`; `site_behind` reports a skipped deploy, nothing prevents one.
- Function 5xx rates still need a log drain.
