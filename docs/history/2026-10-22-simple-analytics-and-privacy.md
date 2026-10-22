# Simple Analytics and a Privacy page

2026-10-22. D154; behaviour in [specs/analytics.md](../specs/analytics.md).

## Asked

The owner pasted Simple Analytics' snippet and, once asked, said the site is for anyone with the link, the start of a product: track behaviour and growth loops, find the loop opportunities and the metrics, then add a privacy policy. Sentry came up and was set aside: it watches errors (which `/api/report` already collects), and its session replay records individuals.

## What changed

- The snippet would not have run: the page policy is `script-src 'self'` with hashes. `lib/analytics.ts` loads the script from our own module on the production host only (none on previews, local builds or the browser suites; none for Do Not Track or Global Privacy Control), and the policies name the two hosts. The `noscript` pixel and automated events were left out: the pixel counts robots, and automated events need `'unsafe-inline'`.
- Nine events on the share, habit, taste and create loops; shared links carry `?ref=share`. The two share paths became one (`briefingPage.ts` now calls `shareLink`).
- `/settings/privacy`, written from an inventory of everything the site stores, sends and shows; it says plainly that anyone with the link can change or delete shared topics and episodes, and that typed text goes to the AI services.

## How it was checked

The built site served locally under `news.someshks.work` in Chromium with the real script: no policy violation, a page view per router move with `installed`, the `share` event with its kind and outcome, `query=ref=share` on the landing and on events from that page, and no request at all with Do Not Track on. Unit tests: the header policy keeps the queue host; nothing loads off production or for a reader who opted out; an early event is queued and a broken script never throws into Share; each listen milestone counts once per item. Each was seen to fail without its fix.

## Open

- D153 (PR #207, proposed the same hour by another session) argues the opposite: no vendor, first-party events in Neon, a public listen page per shared item, and the passphrase back on. The owner chooses; see D154's Context.
- The owner adds the site in Simple Analytics, excludes their own visits, and gives the Privacy page a contact address (it points at GitHub).
- Link previews (no page has Open Graph tags) are the cheapest lift to the share loop.
