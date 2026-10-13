# 2026-10-13: star ratings, Regenerate with feedback, and the missing Daily

The owner's second round of the day ([D103](../decisions.md)). Scores went back to 5 points as a star rating; topic pages fold long source lists and confirm deletes; Settings copy changed; Today's New briefing became Regenerate with feedback (built by a worker in a worktree, merged here); the bundle budget rose to 150 KB.

The Daily of 2026-10-13 never ran: a cheaper agent traced it to `CRON_SECRET` missing on Vercel production, so the cron route refused every call and GitHub's schedule was delayed as usual. No code change; the owner sets the secret ([state](../state.md)).

pnpm was weighed and not adopted: the slow parts (the gate, Git Bash spawns) do not depend on the package manager; its one gain would be cheap worktree installs.
