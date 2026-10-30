# 2026-10-29: the Cancel route gets a key

The queue (D231) put an X on `/api/cancel`, which merged in #391 with no auth (D201). The owner, away, asked for it to be gated without a login for readers.

## What was found

- The route's same-origin check is not auth: no `Origin` header passes, and a forged one does. A plain `curl` with a run id cancelled a real dry run of `run.yml` (conclusion `cancelled`), which also settled that the site's GitHub token has Actions write.
- Run ids are public (`/api/generations`, the repository's run list), so the id cannot be the key.

## What was built (D242)

- `server/cancelToken.ts`: HMAC-SHA256 of the run id, keyed by the site's GitHub token. `/api/generate` and `/api/podcast` return it as `cancel_token`; `/api/cancel` answers 403 without the match, before the cap or GitHub.
- `lib/cancelTokens.ts` keeps the latest 20 in localStorage; `lib/cancelRun.ts` sends one; `queue.ts` shows the X only where a token is held.
- Tests: the cancel unit tests take the token, one refuses missing, wrong and another run's; `queue.spec.ts` seeds tokens and checks another device's row has no X.

## Left

Cancel from another device needs the admin session as a second key (cookie path and secret live in the other app).
