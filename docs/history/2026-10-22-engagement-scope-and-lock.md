# 2026-10-22: engagement and sharing scoped, actions locked

Reasons: D153. The plan and its stages: [engagement-and-share-plan.md](../engineering/engagement-and-share-plan.md).

## What was asked

A User engagement item under Settings, Analytics, with a lightweight tool or a better one, and a first growth loop: share an episode with anyone. Scope first, build after approval.

## What was decided

No analytics vendor: Vercel Web Analytics has no custom events on Hobby, and Plausible and Umami keep the read API a Settings page needs on paid plans. Events go into Neon beside the D150 counters. Sharing is an owner-made, expiring link to a listen page that plays stored audio only. The owner approved the plan as written; stage 0 came first, because Share copied the app's own address and, with D41, a recipient could narrate, generate, delete and edit.

## Stage 0

- `PASSPHRASE_REQUIRED` is true again. The prompts kept since D41 still worked; three gaps were closed: Create showed its dialog even with a remembered passphrase, the briefing Regenerate sheet never read or saved one, and Remember was unticked by default.
- Wrong guesses are capped across the four routes (`server/access.ts`, `refusePassphrase`): past the cap a 429 `cooldown`, never a 401, because a 401 makes a page forget the owner's remembered passphrase.
- A "Stop hearing from" on a device with no passphrase now says what to do, and a refused remembered passphrase is forgotten there too.
- Tests: the browser fixtures start from an unlocked device (`unlocked`, on by default), and two journeys start from a fresh one (Create in the site suite, Play in the player suite).

## What got in the way

- Another session's cleanup removed this session's first worktree mid-task: it was clean and its branch sat on `main`, so it read as merged. Work moved to a new worktree.
- The installed Playwright (1.64.1) wants Chromium 1248; the machine had 1243. The suites ran on 1243 through an untracked config that sets `executablePath`.
- `learnings.md` and the read-first budget are both full, so these lines live here, not there.
