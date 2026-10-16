# Clearer error messages

2026-10-15. After Delete and Regenerate both said "not available right now. Try again in a few minutes." (the live functions were crashing, PR #152), the owner asked for every error message to be simple, understandable and debuggable.

- Why the old words misled: every page mapped any status it did not know (a 503 the server logged, a 500 from a function that never started) to one "not available right now, try again in a few minutes", so a broken deploy read as a passing outage, and nothing tied the message to a log line.
- What changed: the action routes (`/api/podcast`, `/api/generate`, `/api/config`) run under `answerWithRef` (`server/http.ts`): every log line carries `[ref xxxxxx]`, a thrown error becomes a logged JSON 500, and a 5xx answer carries `ref`, which the page shows as "Error ref xxxxxx" (`lib/errorRef.ts`). A 5xx that is not the site's own JSON reads "The server crashed before it could answer". The handlers' silent 503s now log which variable is missing or that GitHub never listed the run. A failed episode run links to its GitHub log (Details). Messages lead with what failed; the runbook table (8.6) maps each one to its fix.
- Left alone: the player's audio errors and narration's per-reason messages were already specific; narration's 503 is reworded but carries no reference (its route is not wrapped).
