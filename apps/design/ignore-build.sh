#!/bin/sh
# Vercel's ignoreCommand: exit 0 skips the build, exit 1 runs it. The style guide draws with the
# reader's stylesheets, components, specs and tokens, so a change in apps/web/src rebuilds it too.
# VERCEL_GIT_PREVIOUS_SHA is the last deployed commit; with none (first deploy) build.
[ -z "$VERCEL_GIT_PREVIOUS_SHA" ] && exit 1
git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null || exit 1
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- \
  . \
  ../../tokens \
  ../web/src \
  ../../package.json \
  ../../package-lock.json
