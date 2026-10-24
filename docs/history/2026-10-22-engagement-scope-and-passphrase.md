# 2026-10-22: engagement and sharing scoped, the passphrase removed

Reasons: D153, D160. The plan and its stages: [engagement-and-share-plan.md](../engineering/engagement-and-share-plan.md). Why checks and deploys failed: `docs/engineering/delivery-failures.md` (#217).

## What was asked

A User engagement item under Settings, Analytics, with a lightweight tool or a better one, and a first growth loop: share an episode with anyone. Scope first, build after approval. Later the same day: why PRs, builds and deploys keep failing, written down so it stops.

## What was decided

- Counting: the first draft put events in Neon, since Vercel has no custom events on Hobby and Plausible and Umami keep their read APIs on paid plans. Simple Analytics, set up in another session the same day (D154), already counted the loops, so on 2026-10-24 the owner had D153 aligned with it: one counter, the listen page sending D154's events with more metadata, and Neon keeping only the share links' play counts.
- Sharing: an expiring link to a listen page that plays stored audio only, with link previews first, because Share can only send a page's address today.
- The passphrase: stage 0 first turned it back on with a cap on wrong guesses. The owner then asked to remove it completely, and to gate actions with OAuth later by hiding them from logged-out users. Stage 0 was dropped unmerged (branch `claude/lock-actions`), and #221 removes the passphrase everywhere (D160).

## What got in the way

- Another session's cleanup removed this session's first worktree mid-task: it was clean and its branch sat on `main`, so it looked merged. The same happened to `settings-ui-refinements-676801`. Rule 5 in the failures doc.
- The installed Playwright (1.64.1) wants Chromium 1248, and the machine had 1243. The suites ran on 1243 through an untracked config that sets `executablePath`.
- The read-first docs budget is full (40.0 of 40 KB): every new decision row needed a trim elsewhere.
- Decision numbers moved under parallel work: this record's numbers were checked against `main` and open PRs just before each PR.
