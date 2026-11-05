#!/bin/sh
# Vercel's ignoreCommand for the reader, the admin and (once its design-system PR lands) the style
# guide (D375). Exit 0 skips the build, exit 1 runs it. Usage, from a project's root: sh ../../scripts/deploy-batch.sh -- <paths>
# The paths are what the project draws with. `readWatchedHead` (engine, `site_behind`) reads them
# from apps/web/vercel.json after the ` -- `, so keep that command in this shape.
#
# A push to main builds only when the commits since the last deployed one that touch those paths
# number BATCH_SIZE (a squash merge is one), or the oldest has waited MAX_WAIT_SECONDS, or a commit
# since ends its subject with [deploy] (the PR title does). Content and pipeline pushes touch none
# of the paths: they never build and never count. A branch other than main (preview/*) builds on
# every change, as before. The age is judged only when some push to main runs this script.
# VERCEL_GIT_PREVIOUS_SHA is the last deployed commit; a skipped build leaves it where it was, so
# the count keeps growing until a build runs.
# Any doubt builds: a skipped deploy that should have run is the failure nobody sees.
# shortcut: Vercel clones 10 commits deep, so a last deployed commit further back cannot be counted
# and builds; a batch is then at most 10 commits of any kind. Upgrade: `git fetch --deepen` first,
# if the 10-commit cap turns out to build more often than five merges would.
BATCH_SIZE=5
MAX_WAIT_SECONDS=10800
[ "$1" = "--" ] && shift
prev="$VERCEL_GIT_PREVIOUS_SHA"
[ -z "$prev" ] && exit 1
git cat-file -e "$prev" 2>/dev/null || exit 1
# A redeploy of the deployed commit is asked for by hand (an env change reaches a deploy only
# through a build), so it always builds (2026-11-04).
[ "$prev" = "$VERCEL_GIT_COMMIT_SHA" ] && exit 1
# Nothing the project draws with differs from the last deploy.
git diff --quiet "$prev" HEAD -- "$@" && exit 0
[ "$VERCEL_GIT_COMMIT_REF" = "main" ] || exit 1
count=$(git rev-list --count "$prev"..HEAD -- "$@") || exit 1
case "$count" in '' | *[!0-9]*) exit 1 ;; esac
[ "$count" -ge "$BATCH_SIZE" ] && exit 1
# The marker is read on every commit since, not only those that touch the paths: a docs-only
# commit titled [deploy] is how a merge already made is shipped. Only the end of a subject counts
# (GitHub adds " (#123)" after it), so prose that mentions the marker does not build.
git log "$prev"..HEAD --format=%s | grep -qE '\[deploy\]( \(#[0-9]+\))?$' && exit 1
oldest=$(git log "$prev"..HEAD --reverse --format=%ct -- "$@" | head -n 1)
case "$oldest" in '' | *[!0-9]*) exit 1 ;; esac
[ $(($(date +%s) - oldest)) -ge "$MAX_WAIT_SECONDS" ] && exit 1
exit 0
