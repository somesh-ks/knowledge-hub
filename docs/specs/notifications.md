# Notifications

A Catch up or a regeneration started on a device pings that device when it ends (D284). Daily and Weekly do not ping.

## Requirements

- Settings has a Notifications section with one switch, per browser. Turning it on asks the browser's permission from that press and subscribes with the site's public key (`GET /api/push`). Off drops the subscription. A line under it says why it cannot be turned on: blocked in the browser's site settings, or (iOS) the app must be added to the Home Screen first.
- Starting a Catch up (`createPage.ts`) or a regeneration (`episodeActions.ts`) with it On sends the browser's address and keys with the run's cancel token (`POST /api/push`, `lib/pushClient.ts`). A run's token is held only by the device that started it (D242), so only that device can be pinged. The server accepts only https addresses at the Google, Mozilla, Apple and Windows push hosts, at most two browsers per run, kept six hours.
- After each content sync, `content.yml` runs `singularity push notify`. A watched run whose `pipeline_runs` row is published sends "ready" (a tap opens `/e/<episode>`); failed sends "did not finish" (a tap opens the Library); nothing or cancelled sends nothing. A sent, gone (404 or 410) or unsendable row is deleted; a push service that is down leaves the row for the next sync. With no keys the command warns and exits 0.
- The service worker always shows a notification for a push and opens or focuses a window on this site when it is tapped (`public/sw.js`).

## Keys

There is nothing to set up. The signing key pair (VAPID) is made by the site the first time a browser asks for the public key and is kept in Neon (`push_keys`); the workflow reads it from there. Losing the row makes a new pair and ends the subscriptions made with the old one.

## Code

`packages/engine/src/store/pushStore.ts`, `packages/engine/src/commands/push.ts`, `apps/web/src/server/pushWatch.ts`, `apps/web/src/pages/api/push.ts`, `apps/web/src/lib/pushClient.ts`, `apps/web/src/scripts/notificationsSettings.ts`, `apps/web/src/pages/settings.astro`.
