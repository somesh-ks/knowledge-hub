# Admin analytics

`/admin/analytics` in the command center: the week's visits and the four loops of [analytics](analytics.md), read from Simple Analytics' Stats API through `apps/admin/api/analytics.ts`, which holds the key (`SIMPLE_ANALYTICS_API_KEY` on the admin project; `npm run secrets:push` sends it). Behind the gate like the other admin pages.

## Requirements

- Four tiles for the last 7 days (today included, Stockholm's days): visitors, page views, listens (`listen_half`), shares (`share`).
- Four rows, each a ratio with its counts on its line: shares per visitor, visits per share (visitors whose utm_source is `share` (a link's `?ref=share`), per share), listen-through (`listen_half` over `listen_start`) and completion (`listen_complete` over `listen_start`).
- A ratio with nothing to divide by reads "No data", never NaN or Infinity.
- No key: the function answers 503 and the page says "Not connected". Any other failure: 502, "Unavailable". Neither draws a zero.
- Rows are Health's shape; no colour.

## Not built

Sentry: the owner set it aside on 2026-10-22 (errors already reach `/api/report`, and replay records individuals), so the plan's Sentry page is dropped. The habit and create loops need event metadata (`installed`, `outcome`) that the page does not ask for yet.

## Code

`apps/admin/src/pages/analytics.astro`, `src/scripts/analyticsPage.ts`, `src/lib/analyticsStats.ts` (the figures), `src/lib/analyticsApi.ts` (the handler).
