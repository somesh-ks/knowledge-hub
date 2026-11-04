# Guardrails

2026-11-04. Thread: errors, costs and metrics kept in check without asking. Decision D360.

## The ask

- The owner wanted cost, speed, tests, bugs, security and keys watched by a system, with few impactful tests and the numbers on the admin portal.

## What changed

- #665: the Vercel cron reads a copy of the run schedule (the `RUN_SCHEDULE` Actions variable) and skips the config store in hours with nothing scheduled; 03 UTC always reads the store and rewrites the copy. Neon wakes about 15 fewer CU-hours a month.
- #671: `health` reads Neon compute hours, GitHub runs, the nightly browser suite, old issues, Dependabot alerts and the free key checks, builds a six-area card, and with `--save` keeps it in `health_reports`. The admin Health page shows six Budgets rows, Stale after 36 h, and counts them in its attention total.
- #673 (workflows, his hand merge): `health.yml` saves daily with the Neon and key env, Mondays' warnings issue starts with the card, `browser.yml` keeps the site suite's report, `smoke.yml` opens the `health` issue when no health run finished in 36 h.

## Left out

- No coverage target and no Sentry (owner's rules). Vercel CLI 65.11.0 for the dev-only alerts was not bumped.
