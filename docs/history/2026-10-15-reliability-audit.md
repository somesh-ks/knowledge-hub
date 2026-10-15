# Reliability audit and the stop that could not stop

2026-10-15. The owner reported "Could not stop reveneau.com yet. Try again." on a podcast page and asked for an evidence-backed reliability audit.

- Why the bug happened: the server takes one config edit every ten seconds; the story controls, unlike the settings pages, sent each vote batch and block on its own and took the 429 as final. Any edit in the ten seconds before a stop made it fail.
- Why tests missed it: the spec stubbed `/api/config` as 202 for every request, and no browser test reaches a real API handler. `e2e/configServer.ts` now runs the real handler with only GitHub faked.
- What was fixed and what was left, with evidence: [the audit](../engineering/reliability-audit-2026-10-15.md). The largest open risk is GitHub cancelling a pending `config.yml` run after the server answered 202 (shared concurrency group); it needs a workflow change merged by hand.
- Production was not reachable from the session; whether the owner's failure was the 429 or an expired dispatch token is unconfirmed (check the Vercel logs for `[api/config] config failed`).
