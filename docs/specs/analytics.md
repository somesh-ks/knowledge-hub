# Analytics

Cookieless counts of visits and a few named events on news.someshks.work, through Simple Analytics (D154), so the owner can see which loops turn visitors into listeners and listeners into sharers. Nothing identifies a reader: no cookie, no storage, no IP, no user id. What a visitor is told is at `/settings/privacy`.

## Loading

- `apps/web/src/lib/analytics.ts` loads `https://scripts.simpleanalyticscdn.com/latest.js` once per session from `apps/web/src/scripts/app.ts`, on `news.someshks.work` alone: a preview, a local build and the browser suites load nothing.
- A browser that sends Do Not Track or Global Privacy Control never loads it.
- The script follows the client router's `pushState` moves as page views. Every page view carries `installed` (the app opened from the Home Screen).
- `track()` queues an event until the script arrives, does nothing off production or with the script blocked, and never throws into the action that called it.
- The page policy (`apps/web/astro.config.mjs`) allows the script host in `script-src` and the queue host in `connect-src` and `img-src`; the header policy in `apps/web/vercel.json` repeats the last two (`apps/web/src/lib/analytics.test.ts` fails if it drops them). No inline script and no `'unsafe-inline'`: automated events and the `noscript` pixel are not used (the pixel mostly counts robots, by Simple Analytics' own advice).

## Events

| Event | When | Metadata |
| :--- | :--- | :--- |
| `share` | the share sheet completed, or the link was copied | `kind` briefing or episode, `outcome` shared or copied |
| `listen_start`, `listen_half`, `listen_complete` | an item starts, passes half its length while playing, ends; each once per item per session (`apps/web/src/player/core/listenEvents.ts`) | `kind` regular, weekly or on-demand |
| `story_open` | a story's source link is followed | `topic` |
| `vote` | a story is voted up or down (a press that clears a vote is not counted) | `value`, `topic` |
| `download` | a Library item is saved for offline listening | `kind` |
| `install` | the browser reports the app installed (`appinstalled`, Chromium only) | none |
| `create_episode` | New episode got an answer | `outcome` started, limited (429) or failed |

A shared link carries `?ref=share`, which Simple Analytics reports as the referrer `share`: messaging apps send no referrer of their own, so the tag is the attribution.

## The loops and their numbers

North star: **listens a week**, the count of `listen_half`. A start counts accidental taps; a completion undercounts listeners who stop at the sign-off.

1. **Share loop** (acquisition). Share, a visit from `ref=share`, a listen, another share. Shares per visitor = `share` / unique visits; visits per share = visits with referrer `share` / `share`. Their product is the loop's coefficient: above 1 it grows on its own. Visits per share well under 1 means the link lands badly where it is pasted (see Opportunities, 1).
2. **Habit loop** (retention). A new briefing every second day brings the reader back. Without an identifier, retention is read from proxies: the share of page views with `installed` true, `install` counts, and visits with no referrer in the two days after a briefing is published.
3. **Taste loop** (quality). Listen, vote or open a story, the judge learns (D118), a better briefing. Listen-through = `listen_half` / `listen_start` by kind; completion = `listen_complete` / `listen_start`; `story_open` and `vote` by topic, up to down.
4. **Create loop** (activation). A visitor asks for an episode, gets one, shares it. `create_episode` limited / all is the share of demand the caps (D150) turn away.

What would change a decision:
- Listen-through under 50% for a kind: shorten its default length or move Top picks first.
- Limited over 10% of `create_episode`: raise the caps, or add accounts before more growth (narration and writing are paid per request, D137).
- `installed` page views flat while visits grow: acquisition without retention; work on the habit loop before more sharing.

## Opportunities not built

1. Link previews: no page has Open Graph or Twitter tags, so a shared briefing pastes as a bare address in Messages, WhatsApp or Slack. Each briefing and episode already has a 1024 px cover. The cheapest lift to visits per share.
2. A first visit from `ref=share` that says in one line what Singularity is, next to Play.
3. Share at a moment: a link to a story or a time in the episode, from the player.
4. A podcast feed, which brings readers back through their own podcast app (its plays are not counted here: the audio comes from Blob).
5. A share prompt when "Episode ready" shows.

## Field Web Vitals

Real visits' LCP, INP and CLS (D156), first-party like the fault reports, so a page that turns slow on real phones reaches `dispatch health`. They take the opt-outs above (`counted()`: the production host, no Do Not Track, no Global Privacy Control).

- Where `counted()` allows, `apps/web/src/scripts/app.ts` loads `apps/web/src/scripts/vitals.ts` at idle or at the first visibility change. It reads the browser's PerformanceObserver (buffered) and sends one beacon to `/api/report` (kind `vitals`) when the page is first hidden, or at `pagehide`: the landing page's LCP (none painted after a hide), CLS and INP over the page's life to then (moves inside the app included), the route template (`vitalPage`: `/d/[id]`, `/e/[id]`, `/settings/topics/[id]`, a named page, else `other`), `device` (`mobile` for a coarse pointer) and `connection` (the effective type, Chromium only). Nothing else; a metric the browser does not measure is left out.
- The server applies the template and the bounds again, takes 30 a minute per instance apart from the faults' 30, and keeps one row per metric in Neon's `web_vitals` for 7 days, 600 rows an hour at most. A store that is down or slow drops the sample; the beacon always gets 204.
- `dispatch health` reads each metric's 7-day p75 per device class daily: `field_vitals` warns past Google's "needs improvement" line and faults past "poor"; `field_unmeasured` warns when phones gave a metric under 20 samples, or the store cannot be read.

Scenario: a reader opens a briefing in the installed app, taps Play and switches to another app. One report goes then; presses after returning to it are not sent.

## Limits

- Ad blockers often block the script host: counts are a floor. Simple Analytics' custom domain proxy would recover them.
- Every page sends `Referrer-Policy: no-referrer`, so a reload or a full page load inside the site arrives with no referrer and counts as a unique visit; moves through the client router do not.
- A listen offline (a download) sends nothing.
- The owner's own visits count unless excluded in the dashboard (Simple Analytics' "Block your visits" extension or IP exclusion).
- An event sent from the page a shared link opened carries that page's query (`ref=share`, seen in a local check of the real script), so a listen from a shared visit can be told apart; one after a move inside the site cannot.

## Code

- `apps/web/src/lib/analytics.ts`, `apps/web/src/player/core/listenEvents.ts`, `apps/web/src/scripts/shareLink.ts`
- `apps/web/astro.config.mjs` and `apps/web/vercel.json` (the policies)
- `apps/web/src/pages/settings/privacy.astro`
- Field Web Vitals: `apps/web/src/scripts/vitals.ts`, `apps/web/src/server/vitals.ts`, `packages/core/src/vitals.ts`, `packages/engine/src/store/vitalsStore.ts`, `checkFieldVitals` in `packages/engine/src/ops/healthChecks.ts`
