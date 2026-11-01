# Notifications

A device can be pinged when the Daily or the Weekly is published, and when a Catch up or regeneration it started ends (D284).

## Requirements

- Settings has a Notifications section; its page has a global switch and one each for Daily, Weekly and Podcast ready, per browser. The global switch is mixed while only some are on (the Switch's `indeterminate`); pressing it turns all on, or off when all are on. The first switch turned on asks the browser's permission from that press and subscribes with the site's public key (`GET /api/push`); the last one turned off drops the subscription. A line says why they cannot be turned on: blocked in the browser's site settings, or (iOS) the app must be added to the Home Screen first.
- Daily and Weekly: the browser's address and keys go to `PUT /api/push-device` (`push_devices`), at most 20 devices. After each content sync `singularity push notify` claims the Daily and Weekly runs that just published (once each, in `push_announced`; a regeneration is not one) and messages the devices that asked; a tap opens the podcast.
- Podcast ready: starting a Catch up (`createPage.ts`) or a regeneration (`episodeActions.ts`) with it on sends the address and keys with the run's cancel token (`POST /api/push`, `lib/pushClient.ts`). Only the device that started a run holds its token (D242). At most two browsers per run, kept six hours. A published run sends "ready" (a tap opens `/e/<episode>`), a failed one "did not finish" (the Library); nothing or cancelled sends nothing.
- Only https addresses at the Google, Mozilla, Apple and Windows push hosts are accepted. A gone address (404 or 410) is dropped; with no keys or no database the command warns and exits 0.
- The service worker always shows a notification for a push and opens or focuses a window on this site when it is tapped (`public/sw.js`).

## Keys

There is nothing to set up. The signing key pair (VAPID) is made by the site the first time a browser asks for the public key and is kept in Neon (`push_keys`); the workflow reads it from there. Losing the row makes a new pair and ends the subscriptions made with the old one.

## Known limits

- At most 20 devices can keep Daily or Weekly (the site has no accounts, so no per-person cap).
- A slow device write (Neon waking, over the 4 s guard) answers 503 and the switch goes back, though the write may still commit. Pressing the switch again settles it. A reconcile read would need a device-identity check.

## Code

`packages/engine/src/store/pushStore.ts`, `packages/engine/src/commands/push.ts`, `apps/web/src/server/pushWatch.ts`, `apps/web/src/server/pushDevice.ts`, `apps/web/src/pages/api/push.ts`, `apps/web/src/lib/pushClient.ts`, `apps/web/src/scripts/notificationsSettings.ts`, `apps/web/src/pages/settings.astro`.
