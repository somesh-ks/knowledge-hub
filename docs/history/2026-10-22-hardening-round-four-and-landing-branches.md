# Hardening round 4, and landing the finished branches

2026-10-22. D155 (amended in review), D157, D158; the map is [engineering/hardening.md](../engineering/hardening.md).

## Asked

The standing goal: harden the app in every aspect, with systems that spot faults in reliability, performance, quality and security and heal where safe, through a dedicated Opus subagent. Then, after many Vercel deployments failed: stop it happening again and keep at most two preview branches; then put the finished branches, other sessions' included, online.

## What changed

- Failed deployments were previews, not production: the Neon integration made a database branch per preview and hit the free limit. `vercel.json` now deploys only `main` and `preview/*`, and `branches.yml` deletes closed branches and trims Neon previews to two (#215).
- Landed #205 (knobs that grow while held), #206 (cost charts), #216 (Software Engineering, from #209) and #218 (the Settings round, from #213). #209 and #213 conflicted with main and this session pushes to one branch, so each landed as a merge onto main in its own PR.
- #216's review put back the 6% cap on judged tool launches, which #209 had lifted as a "judgment call" against the owner's asks of 2026-10-15 and 2026-10-18. It also let engineering sources through the prefilter, kept the 2026-10-18 weekly valid, and let an old preferences row parse.
- CI: the `browser` job gets 45 minutes (#216 needed 33.7; #213 was cut off at 30 with every test passing). The eval's rewrite skips a story the model left empty.
- D157 (a dedicated Opus audit, then an Opus worker over three review rounds): Neon and stored-config faults and warnings, a deploy-behind warning, the site's narration in the month budget, one weekly `health-warnings` issue, and one newest-first order for site, status and health.
- #220 made `ignoreCommand` diff from the last deployed commit; at 341 characters it broke Vercel's 256 limit and no deploy passed validation until it was reverted.
- D158: client errors and CSP violations kept a week in Neon (the message's start only), judged as warnings over 24 hours; its first version leaked quoted text and faulted on one extension's blocked script, which review caught.
- #222 put `ignoreCommand` back to its 250-character form, with a unit test for Vercel's 256 limit; production deployed again at once.
- D158, second half (#223): a function Vercel kills never reaches the server's own recording, so the page reports Vercel's answer (a 5xx with its code) as a `platform` fault, once per route a load; 3 on one route in 24 hours warn.
- The owner asked for roomier list cards and one left text edge (#227): on every page of cards the title, the group heads and the notes start where the rows' words do, 24px into the card (the tokens' card padding 16 to 24, inset 8 to 16, radius 24 to 32).
- D159 (#229): `site_behind` faults once the oldest commit the live build lacks is a day old, and a failed smoke check opens a `smoke` issue; a run Vercel starts belongs to `vercel[bot]`, whose failure email reached no one.

## What review caught

- Three rounds on the health batch, each finding false faults: a waking Neon, an edit made during a run, a site newer than the checkout, Dependabot merges Hobby never deploys, a regenerate read as a late run. The rule that came out of it: a fault is what the owner can act on and what holds for a day; the rest are warnings, read weekly. `run_late` was built and removed.

- #223's local review: the HTML form of Vercel's error page never matched (the code sits inside tags), and the list of codes was narrower than the header's. Reporting every non-JSON 5xx was turned down: a route that throws gets Astro's HTML 500, already a `server` fault.
- The spacing change's design audit: Blocked sources got the indented title but kept its field on the gutter, two edges on one page. Its code review: the topic card's Listen in line, pulled out a fixed 16px, stopped 8px short of the edges once the padding grew.
- D159's first review: a clock counted from the newest commit restarts with every digest, so the fault never fires; reacting to Vercel's failed-deploy events was dropped, since how Vercel reports a skipped or superseded build is undocumented.

## Left open

- The passphrase (`claude/lock-actions`, D153 stage 0) is parked by the owner.
- Still unseen without a log drain: the cron call, any call no page made, a stream cut mid-body.
- The owner's call: Settings titles now sit 24px further in than Library's and Latest's, so a title moves when switching tabs.
