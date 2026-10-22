# User engagement and sharing: the plan

Approved by the owner as written on 2026-10-22 ([D153](../decisions.md)); built one stage per PR, stage 0 first. Vendor facts were read from each vendor's page on 2026-10-22 (sources at the end); anything not confirmed there is marked unverified.

## 1. Bottom line

- **Tool:** no vendor. Events go first-party into the Neon database the site already uses (D149, D150), through one beacon route, and the User engagement page reads them with SQL. Every vendor that could fill a Settings page puts its read API behind a paid plan, and a shared link's attribution comes from its token, not from referrers.
- **Events:** `play`, `finish`, `download` in the app; `share_created`, `share_open`, `share_play`, `share_finish`, `share_cta` around a shared link. No cookie, no identifier, no IP stored.
- **Share:** the owner makes one link per item; it opens a public listen page (`/s/<token>`) with the cover, Play, the stories with their sources, the transcript and one call to action. It plays stored audio only, so a stranger can never start narration.
- **First:** lock the actions (stage 0). Today Share copies the app's own address, and with the passphrase off (D41) whoever opens it can narrate, generate, regenerate, delete and edit config, inside the caps.
- **Order:** 0 lock actions, 1 engagement page from what exists, 2 first-party events, 3 share links and the listen page, 4 the call to action, 5 only on evidence.

## 2. The analytics tool

| Option | Cookies or storage | Events with properties | Read API for our page | Cost here |
| :--- | :--- | :--- | :--- | :--- |
| Vercel Web Analytics | None; a daily request hash | Pro only, 2 properties (8 with Plus, $10/month) | REST API, Vercel token | Hobby: pageviews only, 50k events/month; Pro $20/month plus $0.03 per 1k events |
| Plausible Cloud | None; daily-salted hash | Events on all plans; properties on Business only | Stats API, Business only | Starter $9/month (10k pageviews, no properties); Business price unverified |
| Umami Cloud | None | Yes, on the free Hobby plan | Pro only ($20/month) | Hobby $0, 100k events/month, 6 months kept |
| Simple Analytics | None, no IP used | Yes; plan limits unverified | Stats API with a key | Free with one month of history (a badge rule, unverified); paid from EUR 20/month |
| PostHog | `localStorage+cookie` by default; a memory mode exists | Yes | Yes (rate limited) | Free tier unverified; the heaviest script of the set |
| **First-party in Neon** | **None** | **Any, our schema** | **SQL in our own route** | **Free inside Neon Free (1 GB, 100 CU-hours) and Vercel Hobby (1M invocations)** |

Why first-party wins for this site:

1. The page must show the numbers: Vercel has no custom events on Hobby, and Plausible and Umami gate their read APIs on paid plans. Paying $9 to $20 a month to show one person their own listening is the wrong trade.
2. Shared links travel through messaging apps, which mostly send no referrer (interpretation), so a referrer dashboard would read "direct". The token in the link carries the attribution.
3. No third-party script: nothing for ad blockers to stop, nothing to proxy, and the 130 KB first-load budget (D141) is untouched; the beacon is a few hundred bytes inside code that already loads.
4. The data sits beside the config and the rate counters, under one credential.

What it gives up: traffic sources, browser and device breakdowns, and a ready dashboard. If referrers start to matter, Vercel Web Analytics on Hobby is free and cookieless for pageviews and can be added beside it.

**Consent.** The consent rule (ePrivacy Article 5(3); in Sweden, chapter 9 section 28 of the electronic communications act) is about storing or reading information on the visitor's device. This design stores nothing on the device for analytics and keeps no identifier. Cookieless vendors say no banner is needed; the EDPB's Guidelines 2/2023 (final 16 October 2024) read Article 5(3) more broadly than cookies, so "no banner" is a defensible position, not settled law. GDPR still covers the IP address in each request: it is used for nothing and never stored. Not legal advice.

## 3. What an engagement page can show from what exists

| Source | What it holds | Caveat |
| :--- | :--- | :--- |
| `dispatch:played:<id>` | Items heard to the end | One device and browser; gone when site data is cleared; Safari may clear script storage of a site unvisited for 7 days |
| `dispatch:resume:<id>` | Items started, and the second reached | Same |
| `dispatch:heard:<id>` | Stories heard in each item | Same |
| Cache `dispatch-audio-v1`, `/__downloads.json` | Downloads, at most 10 (D127) | Same |
| `dispatch:queue`, `dispatch:story-votes` | Queue length; votes and opens not yet sent | Same |
| `config/profiles/owner.json` | `votes`, `opens` (a story opened at its source) | Both empty on 2026-10-22; a build old |
| `Digests/`, episode files | What was made, when, how long | A build old |
| `state/costs-YYYY-MM.json` (D137) | Spend per run and per user | Prices unconfirmed |

From these alone the page can show: items finished and in progress on this device, the share finished (completion rate), estimated minutes heard, made against finished this month (are the briefings heard at all?), and cost per finished listen. D108 says a vote is never listed or counted on the site, so showing vote and open totals amends it; the plan shows totals only, never a story list.

The page: `/analytics/engagement`, a sibling of Costs (`/analytics`), linked as User engagement under Settings, Analytics once the branch reworking Settings rows has merged (this plan does not touch `settings.astro`). A static shell whose numbers fill after first paint, as `scripts/costsPage.ts` does.

## 4. Events (stage 2)

| Event | Sent when | Properties |
| :--- | :--- | :--- |
| `play` | Playback first starts in a page | `item_id`, `kind` (daily, weekly, episode) |
| `finish` | An item ends, or the page closes past 90% | `item_id`, `seconds`, `duration` |
| `download` | A download completes | `item_id` |
| `share_created` | The owner makes a link | `share_id`, `item_id` |
| `share_open` | A listen page loads in a browser that runs script | `share_id`, `generation` |
| `share_play`, `share_finish` | As `play` and `finish`, on a listen page | `share_id`, `generation`, `seconds`, `duration` |
| `share_cta` | The listener sends it on or reacts | `share_id`, `action` (`send_on`, `up`, `down`), optional note |

Every row also carries `at`, `surface` (app or share), a `session` id made per page load and kept in memory only, and `country` from Vercel's `x-vercel-ip-country` header. Never stored: the IP, the user agent, anything that persists on the device.

- Table: `engagement_events(id bigserial, at timestamptz, name text, surface text, session text, item_id text, share_id text, generation smallint, seconds integer, duration integer, country text, note text)`, created by `dispatch config seed` like `rate_limit_counters`. Rows older than 13 months are dropped.
- In: `POST /api/events` takes a batch from `navigator.sendBeacon` at the end, or on `pagehide`: same origin, at most 2 KB, names from a fixed list, an `events` bucket in the D150 counter, and 204 whatever happens so a failure never retries in a loop.
- Out: `GET /api/engagement` returns aggregates for the owner only (it shows what the owner listens to).
- Load: a Neon compute that wakes stays up five minutes; at 0.25 CU (assumed minimum, unverified) that is about 0.02 CU-hours a wake, so 50 wakes a day is about 31 of the 100 free CU-hours, shared with D150's counter. Batching keeps it to one write per listen.

## 5. Share an episode with anyone

**Who makes a link.** The owner, from an unlocked device (stage 0). One active link per item, reused if it exists; it expires after 30 days (Blob drops audio after 120) and can be revoked from the engagement page. Only an item whose every segment is stored can be shared: `POST /api/share` checks each with a head and otherwise answers "Play it once to finish its audio, then share."

**What it opens.** `/s/<token>`, rendered on the server and cached at the CDN for five minutes, so a revoke takes effect within that. The token is a random link id plus an HMAC of it under a new `SHARE_SECRET`, so a made-up token is refused before any database call.

| A listener can | A listener cannot |
| :--- | :--- |
| See the cover, title, date, length and "Shared by" with the owner's display name | Reach the app bar, navigation, Library, other items or Settings from the page |
| Play, pause and scrub the stored audio | Start narration: the page never calls `/api/narrate`; a missing segment is skipped with a line |
| Read the stories, each with its outlet and a link to the original | Download, queue, regenerate, delete or edit anything |
| Read the transcript (static text, folded) | Install the app: no service worker, manifest or install prompt on `/s/` |
| Send the link on, or react | Be found by search: `noindex` in the page and an `X-Robots-Tag` header |

Play asks `POST /api/share/play`, which checks the link, its play cap and the month's budget, logs `share_play` and returns the segment addresses; the page chains them in one audio element. The listen page's script stays under 8 KB gzipped, on its own `checkBundle` line.

**The card.** `og:title` (the title), `og:description` (the summary, 160 characters at most), `og:image` (the 1024 px PNG cover, which the build already makes), `og:image:alt`, `og:site_name` Singularity, `twitter:card` summary. `robots.txt` now disallows everything, which hides the card from previewers that honour it, so it allows `/s/` and `/covers/` while the meta tag and header keep pages out of search. A 1200 by 630 card is stage 5.

**The call to action.** Primary: Send it to someone, a Web Share of the same link with `g` one higher, so generations are counted with no new token and no write by a stranger. Secondary: Worth it or Not for me, with an optional note of 280 characters, shown only to the owner. A one-line notice under them: "No cookies. Somesh sees how many people listened, not who." Not yet: Get your own (a waitlist), which needs a privacy notice, consent, a delete route and, for anything commercial, a plan above Vercel Hobby.

**The loop.** The owner shares, a listener plays, sends it on or reacts, and the engagement page shows per item: opens, open-to-play, finish rate, send-ons, generations reached and reactions. The owner learns which episodes travel and makes more of them. Its measure: k, roughly send-ons per listener times plays per send-on.

**Risks.**

| Risk | How it happens | Answer |
| :--- | :--- | :--- |
| Blob transfer | Hobby includes 10 GB a month; past it Blob is locked for 30 days, which stops the owner's own playback. A 15 minute episode at 128 kbps is about 14 MB, so about 700 full plays | Shared plays stop at 4 GB a month (play starts times item size, counted in Neon) and 100 plays a link; the page says the limit is reached. Stage 5 adds a 64 kbps rendition, half the bytes |
| Narration spend | A stranger's Play narrating missing segments | Never: stored audio only, links only for fully stored items, actions locked in stage 0 |
| Functions and Neon | Scanners, bursts | HMAC before the database, CDN cache, D150 buckets on every new route |
| The app behind the domain | The page names news.someshks.work | Stage 0 locks actions; reading stays open by URL as today; a page gate is stage 5 |
| Listeners' privacy | Per-person tracking | One link per item, no per-recipient links, no identifier, the notice above |
| Copyright | Episodes are narrated summaries of others' reporting; a public link publishes them past D9's "one reader" | Every story credited and linked, no article text, unlisted, expiring links. The owner accepts this or keeps sharing to friends. Not legal advice |
| Reaction abuse | Spam notes | Caps per link and per minute, plain text, owner-only |

## 6. Stages and test points

One PR per stage, labelled `review` (D143); site PRs run both browser suites first.

**Stage 0, lock the actions.** `PASSPHRASE_REQUIRED` true (D41's kept code); each device is asked once and remembers it (`dispatch:narrate-passphrase`). D150 notes that with the passphrase on, wrong guesses are not capped, so add a `passphrase-fail` bucket. Tests: un-skip the kept passphrase tests; one e2e: a fresh browser that presses Play on an unnarrated briefing is asked and nothing is narrated. Done when: an unlocked phone acts without a prompt and a fresh browser cannot spend.

**Stage 1, the engagement page from what exists.** `/analytics/engagement`; a pure reducer from the device keys to counts; build-time counts of made items and profile totals. Tests: the reducer, named for the bug "a partly heard item counted as finished"; one e2e journey: play to the end, open the page, it reads one finished. Done when: the page shows this device's real numbers.

**Stage 2, first-party events.** The table, `POST /api/events`, `GET /api/engagement`, the app's `play`, `finish`, `download`. Tests: the handler refuses an unknown name or a long body and stores no IP or user agent; the batch sends once on `pagehide`, not per event. Done when: a play on the phone and one on the desktop both count on the page.

**Stage 3, share links and the listen page.** `share_links(id, item_id, created_at, expires_at, revoked_at, plays)`, `POST /api/share`, `/s/<token>`, `POST /api/share/play`, Share in the hero and Library menus making the link, robots and card. Tests: a token with a bad HMAC never reaches the database; the play gate refuses an expired, revoked, over-cap or over-budget link; one e2e journey across contexts: the owner shares, a fresh context opens the link, Play plays stored audio with no request to `/api/narrate` and no service worker, then a revoked link answers 410. Done when: a link opened on a second phone plays and shows on the engagement page.

**Stage 4, the call to action.** Send it on with `g`, the reaction and note, their caps, and the per-item numbers. Tests: `g` grows by one and stops at 9; a note is stored as text and shown only to the owner. Done when: a second-generation open is counted.

**Stage 5, only on evidence.** A 64 kbps single-file share MP3 from `audio.yml` (lock screen, `og:audio`, half the bytes) if shared plays near the budget or a phone stops between segments; a 1200 by 630 card; a gate on every page if the owner wants briefings private; the waitlist if the owner opens sign-ups.

## 7. Decisions for the owner

1. First-party events in Neon, no vendor (or add Vercel Web Analytics on Hobby for pageviews).
2. The passphrase back on for actions, asked once per device (reverses D41).
3. Vote and open totals on the engagement page (amends D108).
4. What can be shared (episodes only, or briefings too), the 30-day expiry and the 4 GB monthly budget.
5. Send it on and a reaction now; the waitlist later.
6. The display name on the listen page.

Unverified: Plausible's Business price, Umami's script size and EU hosting, whether Vercel's analytics API works on Hobby, the Neon project's region and minimum compute size, PostHog's free tier, and which previewers honour `robots.txt`.

## Sources

- Vercel Web Analytics pricing: https://vercel.com/docs/analytics/limits-and-pricing; custom events: https://vercel.com/docs/analytics/custom-events; privacy: https://vercel.com/docs/analytics/privacy-policy; API: https://vercel.com/docs/analytics/web-analytics-api
- Vercel Blob pricing and Hobby lockout: https://vercel.com/docs/vercel-blob/usage-and-pricing; Hobby limits: https://vercel.com/docs/limits/fair-use-guidelines
- Plausible plans: https://plausible.io/docs/subscription-plans; data policy: https://plausible.io/data-policy; properties: https://plausible.io/docs/custom-props/introduction; Stats API: https://plausible.io/docs/stats-api
- Umami pricing: https://umami.is/pricing; sending events: https://docs.umami.is/docs/api/sending-stats
- Simple Analytics: https://docs.simpleanalytics.com/what-we-collect, https://www.simpleanalytics.com/pricing
- PostHog persistence: https://posthog.com/docs/libraries/js/persistence
- Neon pricing: https://neon.com/pricing
- EDPB Guidelines 2/2023: https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy-directive_en
