#!/bin/sh
# Vercel's ignoreCommand: exit 0 skips the build, exit 1 runs it. The admin app draws with the
# reader's stylesheets, components and tokens, so a change there rebuilds it too. config/ is left
# out on purpose: the Experiments page shows a switch as of the last deploy rather than cost a
# deploy for a flag change (2026-10-30, the owner).
# VERCEL_GIT_PREVIOUS_SHA is the last deployed commit; with none (first deploy) build.
[ -z "$VERCEL_GIT_PREVIOUS_SHA" ] && exit 1
git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null || exit 1
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- \
  . \
  ../../tokens \
  ../web/src/styles \
  ../web/src/components \
  ../web/src/assets \
  ../web/src/lib/icons.ts \
  ../web/src/scripts/themeInit.js \
  ../../package.json \
  ../../package-lock.json
