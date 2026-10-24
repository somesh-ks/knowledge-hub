# Sharing

A briefing or an episode is shared as a public listen link that plays its stored audio to anyone who has it, without the app. Reasons: D153 (the plan: [engagement-and-share-plan.md](../engineering/engagement-and-share-plan.md), sections 4 to 6), D150 (the caps), D154 (the counts), D160 (no passphrase).

## Requirements

### Making and stopping a link
- Share in the hero menu and in a Library row's menu calls `POST /api/share` with `{"item": "<id>"}` and sends `https://news.someshks.work/s/<token>?ref=share&g=1` through the share sheet, or copies it.
- An item has at most one working link; Share reuses it (one query, no Blob operation). A new link expires `SHARE_EXPIRY_DAYS` (30) after it is made.
- A new link is made only when every file the narration lookup names for the item is in Blob: one `head` each (a SIMPLE operation; 11 to 16 for a briefing). Otherwise the answer is 409 and the page says "Play it once to finish its audio, then share." A briefing with one whole file shares that file.
- Briefings and episodes alike (`SHAREABLE_KINDS`). An episode still being written cannot be shared.
- Stop sharing (`DELETE /api/share`, same body) ends every working link of the item; the CDN's copy of the page lasts up to five minutes. The menus show Stop sharing for the items this device shared (device storage `dispatch:shared-items`).
- Scenario: WHEN `SHARE_SECRET` is unset or shorter than 16 characters THEN the routes answer 503 `not_set_up`, the page says it cannot open, and Share sends the page's own address as before.
- Scenario: WHEN Neon is down or slow (4 s) THEN the routes answer 503 `unavailable` and Share sends the page's own address.

### The token
- A token is a random 128-bit link id, a dot and the first 128 bits of its HMAC-SHA-256 under `SHARE_SECRET`, both base64url. A token whose HMAC is not ours is refused (404) before the rate counter or the database is asked.
- The token is never sent to analytics, and the service worker never keeps a `/s/` page.

### The listen page, `/s/<token>`
- Rendered on the server, `Cache-Control: public, max-age=0, s-maxage=300`, `X-Robots-Tag: noindex, nofollow` and the `robots` meta. 410 for a stopped or expired link, 404 for an unknown one.
- Shows the cover, the title, the date (a briefing: Daily or Weekly briefing), the length from the stored files, "Shared by" `SHARE_DISPLAY_NAME` (Somesh), Play with a position slider, the stories with their outlets and a link to each original, and the transcript folded.
- No app bar, navigation, menus, manifest, service worker or link into the app but the Privacy line below. Its script stays under 8 KB gzipped (`LISTEN_PAGE_BUDGET_BYTES`, its own line in `checkBundle`).
- Card: `og:title`, `og:description` (160 characters at most), `og:image` (`/covers/<id>-1024.png`, 1024 square), `og:image:alt`, `og:site_name` Singularity, `twitter:card` summary. `robots.txt` allows `/s/` and `/covers/` so previewers can fetch them.
- Under the stories, the call to action (stage 3). Send it to someone shares the same `/s/<token>` with `?ref=share&g=` one past the page's own `g`, at most 9 (`sendOnUrl`, `MAX_GENERATION`), through the share sheet, or copies it and says "Link copied": no new token, nothing written on the server. Worth it or Not for me sends `react`; the chosen one stays pressed. Each event is sent once a page view ([analytics.md](analytics.md)). Under them, the one link into the app: "No cookies. Somesh sees how many people listened, not who." to `/settings/privacy`, which lists what the page counts.
- Play calls `POST /api/share-play` with the token and plays the answered files one after another in one audio element. It never calls `/api/narrate`; a file that will not play is skipped with one line.

### Caps
- A play start is granted only while the link works, has had under `SHARE_PLAYS_PER_LINK` (100) starts, and the month (UTC) has room for the item's bytes under `SHARE_MONTHLY_BYTES` (4 GB): each start adds the item's size to the month. Over a cap the answer is 429 `link_limit` or `month_limit` with a line the page shows; a stopped or expired link is 410.
- D150 buckets, after the origin, body and token checks: `share` (10 a minute, make and stop), `share-play` (30), `share-page` (60, renders that miss the CDN).
- Scenario: WHEN two plays of different links land at the very edge of the month THEN both may pass, by one item's bytes at most.

### Store
- Neon tables `share_links(id, item_id, created_at, expires_at, revoked_at, plays, bytes, segments)` (one working link per item, by a partial unique index) and `share_budget(month, bytes)`, created by their first query, as the vitals table is. Nothing about a listener is kept.

## Code
- `apps/web/src/lib/share.ts` (the owner's numbers), `apps/web/src/server/share.ts`, `apps/web/src/server/shareSite.ts`, `apps/web/src/server/listenView.ts`
- `apps/web/src/pages/api/share.ts`, `apps/web/src/pages/api/share-play.ts`, `apps/web/src/pages/s/[token].astro`, `apps/web/src/scripts/listenPage.ts`, `apps/web/src/styles/listen.css`
- `apps/web/src/scripts/shareLink.ts`, `packages/engine/src/store/shareStore.ts`
- Tests: `shareStore.test.ts` (the play gate), `server/share.test.ts` (HMAC before the database), `lib/listenAnalytics.test.ts` (no token in analytics; `g` grows by one and stops at 9), `e2e/share.spec.ts` (the journey)
