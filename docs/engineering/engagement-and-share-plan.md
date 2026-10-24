# User engagement and sharing: the plan

Approved by the owner on 2026-10-22 ([D153](../decisions.md)), with the passphrase skipped (D160); aligned with Simple Analytics (D154) on 2026-10-24 so the two do not overlap. Built one stage per PR, link previews first.

What counts behaviour is D154's: Simple Analytics on the production host, its nine events, `?ref=share`, the loops and their numbers in [specs/analytics.md](../specs/analytics.md), and `/settings/privacy`. This plan adds the share link and its listen page on top, and keeps first-party only what a vendor cannot do. Vendor facts were read from each vendor's page (sources at the end); anything not confirmed there is marked unverified.

## 1. Bottom line

- **Counting:** Simple Analytics (D154) is the one counter. The listen page sends D154's events with three more metadata keys and one new event; there is no first-party event table, beacon route or second dashboard.
- **User engagement:** the row under Settings, Analytics opens the Simple Analytics dashboard (the owner's call, 2026-10-24). Numbers inside the app are decided later (section 3).
- **Share:** a link per item opens a public listen page (`/s/<token>`) with the cover, Play, the stories with their sources, the transcript and one call to action. It plays stored audio only, so a stranger never starts narration. Neon keeps the links and their play counts, which enforce the caps and the Blob budget.
- **First:** link previews (stage 0), which D154 also names its cheapest lift: Share can only send a page's address today, so the card a chat app shows is the first thing a recipient sees. There is no passphrase (D160); the owner will gate actions with OAuth later and hide them from logged-out users.
- **Order:** 0 link previews, 1 the User engagement row, 2 share links and the listen page, 3 the call to action, 4 only on evidence.

## 2. The analytics tool

Simple Analytics, chosen and live (D154). The 2026-10-22 comparison argued for first-party events in Neon because every vendor seemed to keep its read API on a paid plan; Simple Analytics' Stats API answers without a key for a site whose stats are public, and the owner set it up. Two counters for one question would split the numbers, so the first-party table is dropped.

| Option considered (2026-10-22) | Cookies or storage | Events with properties | Read API for our page |
| :--- | :--- | :--- | :--- |
| Vercel Web Analytics | None; a daily request hash | Pro only | REST API, Vercel token |
| Plausible Cloud | None; daily-salted hash | Properties on Business only | Stats API, Business only |
| Umami Cloud | None | Yes, free Hobby plan | Pro only ($20/month) |
| **Simple Analytics (chosen, D154)** | **None, no IP used** | **Yes, with metadata** | **Stats API: no key for a public site; else a plan with API access** |
| PostHog | `localStorage+cookie` by default | Yes | Yes (rate limited) |
| First-party in Neon (dropped) | None | Any, our schema | SQL in our own route |

First-party stays for what is not analytics: the share links, their expiry and revocation, and the play count each Play checks against a link's cap and the month's Blob budget.

Consent is D154's: nothing stored on the device, no identifier, no script for Do Not Track or Global Privacy Control, and `/settings/privacy` says what is counted. Not legal advice.

## 3. The User engagement page

Stage 1 is a row under Settings, Analytics, beside Costs, that opens the Simple Analytics dashboard for news.someshks.work. It needs no route, no key and no copy of the data, and the dashboard already shows the loops of [specs/analytics.md](../specs/analytics.md): visits, referrer `share`, and the events with their metadata.

Numbers inside the app (listens a week, listen-through by kind, visits per share, shares per visitor, generations reached) need the Stats API, read by a server route and cached. Two ways, the owner's choice:

| Way | Cost | Trade |
| :--- | :--- | :--- |
| Make the site's stats public in Simple Analytics | Free (the Free plan needs its badge, or the API answers 423) | Anyone can see the aggregate counts and top pages; nothing about a reader |
| A plan with API access and a key in Vercel | A monthly fee (unverified) | Stats stay private |

The owner chose on 2026-10-24 to keep the dashboard link and decide on in-app numbers later, so the in-app page is not built. A device-only view from local storage was considered and dropped: it shows one browser's listening, which the dashboard already counts across all.

## 4. Events

D154's events stay as they are. The listen page adds:

| Event | Sent when | Metadata |
| :--- | :--- | :--- |
| page view `/s` | The listen page loads | the path without the token (see below) |
| `listen_start`, `listen_half`, `listen_complete` | As in the app, once per item per page | `kind`, plus `surface` listen, `generation`, `item` |
| `share` | The listener sends it on | `outcome` shared or copied, plus `surface` listen, `generation`, `item` |
| `react` (new) | Worth it or Not for me | `value` up or down, `surface` listen, `item` |

- `item` is the briefing or episode id, never anything about a person; the app's own `listen_*` and `share` gain it too, so a link's travel can be read per item.
- `generation` is the link's `g` (1 for the owner's link, one higher each time it is sent on, at most 9).
- The token never reaches Simple Analytics: a public dashboard would publish working links. The page reports its path as `/s` (Simple Analytics' path override, unverified; if it has none, the page sends events only and no page view).
- Attribution stays D154's: every link carries `?ref=share`, and the listen page's links carry `g`.

## 5. Share an episode with anyone

**Who makes a link.** Anyone today, since nothing signs in (D160); the owner alone once OAuth lands. One active link per item, reused if it exists; it expires after 30 days (Blob drops audio after 120) and can be revoked from the item's menu (Stop sharing). Only an item whose every segment is stored can be shared: `POST /api/share` checks each with a head and otherwise answers "Play it once to finish its audio, then share."

**What it opens.** `/s/<token>`, rendered on the server and cached at the CDN for five minutes, so a revoke takes effect within that. The token is a random link id plus an HMAC of it under a new `SHARE_SECRET`, so a made-up token is refused before any database call.

| A listener can | A listener cannot |
| :--- | :--- |
| See the cover, title, date, length and "Shared by" with the owner's display name | Reach the app bar, navigation, Library, other items or Settings from the page |
| Play, pause and scrub the stored audio | Start narration: the page never calls `/api/narrate`; a missing segment is skipped with a line |
| Read the stories, each with its outlet and a link to the original | Download, queue, regenerate, delete or edit anything |
| Read the transcript (static text, folded) | Install the app: no service worker, manifest or install prompt on `/s/` |
| Send the link on, or react | Be found by search: `noindex` in the page and an `X-Robots-Tag` header |

Play asks `POST /api/share-play` (built as `share-play`: the static test build cannot hold a file and a folder both named `share`), which checks the link, its play cap and the month's budget, adds one to the link's plays and returns the segment addresses; the page chains them in one audio element. The listen page's script stays under 8 KB gzipped, on its own `checkBundle` line, with Simple Analytics loaded as on every page (D154: production only, never for Do Not Track or Global Privacy Control).

**The card.** `og:title` (the title), `og:description` (the summary, 160 characters at most), `og:image` (the 1024 px PNG cover, which the build already makes), `og:image:alt`, `og:site_name` Singularity, `twitter:card` summary. `robots.txt` now disallows everything, which hides the card from previewers that honour it, so it allows the shared pages and `/covers/` while the meta tag and header keep pages out of search. A 1200 by 630 card is stage 4.

**The call to action.** Primary: Send it to someone, a Web Share of the same link with `g` one higher, so generations are counted with no new token and no write by a stranger. Secondary: Worth it or Not for me, sent as `react`. Under them, one line that links to `/settings/privacy`: "No cookies. Somesh sees how many people listened, not who." Not yet: a note with the reaction (it needs a store and an owner-only view, so it waits for the in-app page), and Get your own (a waitlist), which needs consent, a delete route and, for anything commercial, a plan above Vercel Hobby.

**The loop.** D154's share loop, measured by its numbers: shares per visitor times visits per share, now readable per item and per generation. The owner learns which episodes travel and makes more of them.

**Risks.**

| Risk | How it happens | Answer |
| :--- | :--- | :--- |
| Blob transfer | Hobby includes 10 GB a month; past it Blob is locked for 30 days, which stops the owner's own playback. A 15 minute episode at 128 kbps is about 14 MB, so about 700 full plays | Shared plays stop at 4 GB a month (play starts times item size, counted in Neon) and 100 plays a link; the page says the limit is reached. Stage 4 adds a 64 kbps rendition, half the bytes |
| Narration spend | A stranger's Play narrating missing segments | Never from the listen page: stored audio only, links only for fully stored items. The app itself narrates for anyone, inside the daily cap and the monthly budget, until OAuth (D160) |
| Functions and Neon | Scanners, bursts | HMAC before the database, CDN cache, D150 buckets on every new route |
| The app behind the domain | The page names news.someshks.work | Open to anyone until OAuth (D160): the owner will hide actions from logged-out users. The listen page links nowhere into the app meanwhile |
| Leaked links | A public dashboard lists paths | The token never reaches Simple Analytics (section 4) |
| Undercounting | Ad blockers stop the script; an offline listen sends nothing | Counts are a floor (D154); the play count in Neon is exact for shared plays |
| Copyright | Episodes are narrated summaries of others' reporting; a public link publishes them past D9's "one reader" | Every story credited and linked, no article text, unlisted, expiring links. The owner accepts this or keeps sharing to friends. Not legal advice |

## 6. Stages and test points

One PR per stage, labelled `review` (D143); site PRs run both browser suites first.

**Stage 0, link previews on today's pages** (D154's opportunity 1). Every briefing and episode page gets the card section 5 describes. `robots.txt` lets previewers fetch pages and covers while `noindex` keeps them out of search. Tests: one build test that every page in the build carries a card naming its own title and an existing cover file. Done when: a link pasted into WhatsApp, iMessage and Slack shows its card (which previewers honour `robots.txt` is unverified, so check each).

**Stage 1, the User engagement row.** A row under Settings, Analytics that opens the Simple Analytics dashboard, and `item` added to the app's `listen_*` and `share` metadata. Tests: the existing analytics unit tests extended for `item`, nothing new for a link. Done when: the row opens the dashboard and a listen on production shows its item.

**Stage 2, share links and the listen page.** `share_links(id, item_id, created_at, expires_at, revoked_at, plays)`, `POST /api/share`, `/s/<token>`, `POST /api/share-play`, Share in the hero and Library menus making the link, Stop sharing, robots and card, and the listen page's events. Tests: a token with a bad HMAC never reaches the database; the play gate refuses an expired, revoked, over-cap or over-budget link; no event carries the token; one e2e journey across contexts: a link is made, a fresh context opens it, Play plays stored audio with no request to `/api/narrate` and no service worker, then a revoked link answers 410. Done when: a link opened on a second phone plays and its listen shows in Simple Analytics with `surface` listen.

**Stage 3, the call to action.** Send it on with `g`, `react`, their caps, and the line to the Privacy page, which gains the listen page's counts. Tests: `g` grows by one and stops at 9. Done when: a second-generation listen is counted.

**Stage 4, only on evidence.** The in-app engagement page from the Stats API, once the owner picks section 3's way; a note with the reaction; a 64 kbps single-file share MP3 from `audio.yml` (lock screen, `og:audio`, half the bytes) if shared plays near the budget or a phone stops between segments; a 1200 by 630 card; a gate on every page if the owner wants briefings private; the waitlist if the owner opens sign-ups. D154's other opportunities (a first-visit line, share at a moment, a podcast feed, a prompt at "Episode ready") stay on its list.

## 7. Decisions for the owner

1. Decided 2026-10-24: the row opens the dashboard. Open for later: numbers inside the app from public Simple Analytics stats (free) or a plan with API access.
2. No passphrase (D160): actions stay open until OAuth, which will hide them from logged-out users.
3. What can be shared (episodes only, or briefings too), the 30-day expiry and the 4 GB monthly budget.
4. Send it on and a reaction now; the note and the waitlist later.
5. The display name on the listen page.

Unverified: Simple Analytics' price for API access, its path override, and its event and metadata limits; Plausible's Business price; which previewers honour `robots.txt`.

## Sources

- Simple Analytics APIs: https://docs.simpleanalytics.com/api; Stats API (events, metadata filters, public sites without a key, the Free plan's badge): https://docs.simpleanalytics.com/api/stats; keys need a plan with API access: https://docs.simpleanalytics.com/api/authenticate; what it collects: https://docs.simpleanalytics.com/what-we-collect; pricing: https://www.simpleanalytics.com/pricing (read 2026-10-24)
- Vercel Web Analytics pricing: https://vercel.com/docs/analytics/limits-and-pricing; custom events: https://vercel.com/docs/analytics/custom-events
- Vercel Blob pricing and Hobby lockout: https://vercel.com/docs/vercel-blob/usage-and-pricing; Hobby limits: https://vercel.com/docs/limits/fair-use-guidelines
- Plausible plans: https://plausible.io/docs/subscription-plans; Umami pricing: https://umami.is/pricing; PostHog persistence: https://posthog.com/docs/libraries/js/persistence
- Neon pricing: https://neon.com/pricing
