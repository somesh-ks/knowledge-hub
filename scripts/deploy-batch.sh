#!/bin/sh
# Vercel's ignoreCommand for the reader, the admin and the style guide (D375). Exit 0 skips the
# build, exit 1 runs it. Usage, from a project's root: sh ../../scripts/deploy-batch.sh -- <paths>
# The paths are what the project draws with. `readWatchedHead` (engine, `site_behind`) reads them
# from apps/web/vercel.json after the ` -- `, so keep that command in this shape.
#
# A push to main builds only when the commits since the last deployed one that touch those paths
# number BATCH_SIZE, or the oldest has waited MAX_WAIT_SECONDS, or one of the commits since says
# [deploy] (a PR title does). Content and pipeline pushes touch none of the paths: they never build
# and never count. A branch other than main (preview/*) builds on every change, as before.
# VERCEL_GIT_PREVIOUS_SHA is the last deployed commit; a skipped build leaves it where it was, so
# the count keeps growing until a build runs.
# Any doubt builds: a skipped deploy that should have run is the failure nobody sees.
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
# commit titled [deploy] is how a merge already made is shipped.
git log "$prev"..HEAD --format=%B | grep -qF '[deploy]' && exit 1
oldest=$(git log "$prev"..HEAD --reverse --format=%ct -- "$@" | head -n 1)
case "$oldest" in '' | *[!0-9]*) exit 1 ;; esac
[ $(($(date +%s) - oldest)) -ge "$MAX_WAIT_SECONDS" ] && exit 1
exit 0
