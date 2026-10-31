# Notifications

A Catch up or a regeneration started on a device pings that device when it ends (D284). Daily and Weekly do not ping.

## Requirements

- Settings has a Notifications page (On or Off, per browser). Turning it On asks the browser's permission from that press and subscribes with the site's public key (`GET /api/push`). Off drops the subscription. The row says why it cannot be turned on: blocked in the browser's site settings, or (iOS) the app must be added to the Home Screen first.
- Starting a Catch up (`createPage.ts`) or a regeneration (`episodeActions.ts`) with it On sends the browser's address and keys with the run's cancel token (`POST /api/push`, `lib/pushClient.ts`). A run's token is held only by the device that started it (D242), so only that device can be pinged. The server accepts only https addresses at the Google, Mozilla, Apple and Windows push hosts, at most two browsers per run, kept six hours.
- After each content sync, `content.yml` runs `singularity push notify`. A watched run whose `pipeline_runs` row is published sends "ready" (a tap opens `/e/<episode>`); failed sends "did not finish" (a tap opens the Library); nothing or cancelled sends nothing. A sent, gone (404 or 410) or unsendable row is deleted; a push service that is down leaves the row for the next sync. With no keys the command warns and exits 0.
- The service worker always shows a notification for a push and opens or focuses a window on this site when it is tapped (`public/sw.js`).

## Setup (owner)

`npm run vapid:keys` writes `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` to `.env` without printing them; `npm run secrets:push` sends the keys to GitHub secrets, the public key to Vercel and the subject to a GitHub variable. Redeploy Vercel after, so the site reads the public key.

## Code

`packages/engine/src/store/pushStore.ts`, `packages/engine/src/commands/push.ts`, `apps/web/src/server/pushWatch.ts`, `apps/web/src/pages/api/push.ts`, `apps/web/src/lib/pushClient.ts`, `apps/web/src/scripts/notificationsSettings.ts`, `apps/web/src/pages/settings/notifications.astro`.
