# Admin sign-in

How the command center decides who is the owner, and how the owner leaves. The gate runs as Vercel Routing Middleware in front of every file (`apps/admin/middleware.ts`); the reader's `/api/costs` and `/api/health` read the same cookie ([D257](../decisions/design-system.md)).

## Requirements

- Two ways in: Continue with Google, and the owner password (the break-glass). Both issue one signed session cookie, `Path=/`, 30 days. The gate opens with either way in plus `ADMIN_SESSION_SECRET` (32 characters or more), and answers 503 to everything with neither.
- Google is the authorization code flow with PKCE (S256), a state and a nonce. They sit in a signed cookie for ten minutes that only `/admin/login/google` and its callback see. The id token's issuer, audience, expiry, nonce and `email_verified` are checked, and its email must be on `ADMIN_GOOGLE_EMAILS` (comma separated, any case). Anything else returns to the sign-in page with a message and sets no session.
- While `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` or `ADMIN_GOOGLE_EMAILS` is missing, Continue with Google returns to the sign-in page saying it is not set up. The page is static, so the button is always drawn.
- Sign out is a post to `/logout`: it clears the session on both paths and goes to the sign-in page. It is a text button at the end of the app bar on a phone and at the foot of the side column from 64rem.

## Scenarios

- WHEN the callback's state, nonce, audience or issuer is wrong, the token is expired, the sign-in is older than ten minutes, the cookie is missing or tampered with, the email is unverified or not on the list, or Google's token endpoint fails THEN the answer is `/admin/login?e=3` and no session is set.
- WHEN only Google is configured THEN a password post always fails.

## Code

`apps/admin/src/gate/gate.ts` (routes), `google.ts` (the flow), `session.ts` (the cookie), `apps/admin/src/pages/login.astro`, `components/SignOut.astro`. Tests: `gate.test.ts`. Setup steps for the Google client: [runbook](../runbook.md).
