# Sharing

A briefing or an episode is shared as a public listen link that plays its stored audio to anyone who has it, without the app. Reasons: D153 (the plan: [engagement-and-share-plan.md](../engineering/engagement-and-share-plan.md), sections 4 to 6), D150 (the caps), D154 (the counts), D160 (no passphrase).

## Requirements

### Making and stopping a link
- Share beside Play and in a Library row's menu sends `https://news.someshks.work/s/<token>?ref=share&g=1` through the share sheet, or copies it. It asks `POST /api/share` with `{"item": "<id>"}` as a finger lands on Share or the menu opens, so the sheet opens inside the tap: iOS refuses one opened after an awaited request. An answer is trusted 30 s; a later menu asks again, so a stopped or replaced link is not shared on.
- An item has at most one working link; Share reuses it (one query, no Blob operation) while the item is what the link was made from: the link keeps a fingerprint (`source`) of the files the lookup named. A Regenerate changes them, and Share then stops the old link and makes a new one, or refuses until the new audio is stored. A new link expires `SHARE_EXPIRY_DAYS` (30) after it is made.
- A new link is made only when every file the narration lookup names for the item is in Blob: one `head` each (a SIMPLE operation; 11 to 16 for a briefing), stopping at the first missing one. Otherwise the answer is 409 and the page says "Play it once to finish its audio, then share.", and for 2 minutes (`NOT_STORED_MEMO_MS`, per function instance) a retried Share for the same files is refused with no Blob operation. A briefing with one whole file shares that file.
- Briefings and episodes alike (`SHAREABLE_KINDS`). An episode still being written cannot be shared.
- Stop sharing (`DELETE /api/share`, same body) ends every working link of the item; the CDN's copy of the page lasts up to five minutes. The menus show Stop sharing only for the items this device shared (device storage `singularity:shared-items`): a link made on the phone has no Stop sharing on the laptop.
- Nothing to set up beyond `DATABASE_URL`, which production has.
- Scenario: WHEN Neon is down or slow (4 s) THEN the routes answer 503 `unavailable` and Share sends the page's own address.

### The token
- A token is the link's random 128-bit id in base64url (22 characters), looked up in Neon; there is no secret. A token of another shape, or a non-canonical spelling of one, is refused (404) before the rate counter or the database is asked; a well-formed unknown one is 404 after one indexed read, behind the D150 bucket, and the CDN's five-minute copy absorbs repeat page hits.
- A listener never signs in or enters anything. A sign-in after the first play arrives with OAuth later and is not built now.
- The token is never sent to analytics, and the service worker never keeps a `/s/` page.

### The shared page, `/s/<token>`
- The app's own briefing or episode page for the link's item (DigestView, EpisodeView with `shareToken`), with the app around it: no More menu (Regenerate, Delete, Stop sharing) and no Regenerate or Delete panels. The owner asked for "a simple addition", not a page of its own (2026-10-24).
- Rendered on the server, `Cache-Control: public, max-age=0, s-maxage=300` and `X-Robots-Tag: noindex, nofollow`. 410 for a stopped or expired link and for one whose item was deleted or regenerated, 404 for an unknown one, each an empty state. The page, the routes and narration read the same content: the repository's (D173).
- Card: the item's own (`briefingCard`, `episodeCard`, linkCard.ts). `robots.txt` allows `/s/` and `/covers/` so previewers can fetch them.
- Play is the app's player. On a shared page its lookup is `POST /api/share-play` with the token from the address (narrationApi.ts), which answers the item's narration lookup with the link's stored files, each confirmed, so the player never calls `/api/narrate`. The page's own file is dropped from its player data (`sharedPlayer`), and it never prewarms: a lookup is a counted play. A refused play says so (`link_limit`, `month_limit`, `link_gone`).
- Share sits beside Play as the tonal button on every briefing and episode page (PlayCta.astro). On the owner's page it makes the item's listen link (the More menu keeps Stop sharing); on a shared page it sends the address it was opened at on, counted by the item (`data-share-of`).

### Caps
- A play start is granted only while the link works, has had under `SHARE_PLAYS_PER_LINK` (100) starts, and the month (UTC) has room for the item's bytes under `SHARE_MONTHLY_BYTES` (4 GB): each start adds the item's size to the month. A play whose item was deleted or regenerated since is refused 410, its link stopped and its count and bytes handed back. Over a cap the answer is 429 `link_limit` or `month_limit` with a line the page shows; a stopped or expired link is 410.
- D150 buckets, after the origin, body and token checks: `share` (10 a minute, make and stop), `share-play` (30), `share-page` (60, renders that miss the CDN).
- Scenario: WHEN plays land together at the edge of the month THEN the month's row is charged by a conditional UPDATE that locks it, so they never pass the budget together; one that then loses the race for a link's last play has charged the month for nothing (the budget errs low). A granted play is one round trip (the month's first play makes its row, one more).

### Store
- Neon tables `share_links(id, item_id, created_at, expires_at, revoked_at, plays, bytes, segments, source)` (one working link per item, by a partial unique index) and `share_budget(month, bytes)`, created by their first query, as the vitals table is. Nothing about a listener is kept.

## Code
- `apps/web/src/lib/share.ts` (the owner's numbers), `apps/web/src/server/share.ts`, `apps/web/src/server/shareSite.ts`
- `apps/web/src/pages/api/share.ts`, `apps/web/src/pages/api/share-play.ts`, `apps/web/src/pages/s/[token].astro`, `apps/web/src/narration/narrationApi.ts`, `apps/web/src/components/PlayCta.astro`
- `apps/web/src/scripts/shareLink.ts`, `packages/engine/src/store/shareStore.ts`
- Tests: `shareStore.test.ts` (the play gate), `server/share.test.ts` (a malformed token never reaches the database, an unknown one is 404; a regenerated or deleted item stops its link; a retried Share heads nothing), `lib/listenAnalytics.test.ts` (no token in analytics), `e2e/share.spec.ts` (the journey: the app's page in a fresh browser plays the stored files and never narrates)
