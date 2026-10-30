#!/bin/sh
# Vercel's ignoreCommand: exit 0 skips the build, exit 1 runs it. The admin app draws with the
# reader's stylesheets, components and tokens, so a change there rebuilds it too, and so does
# config/, where the Experiments page reads its switches.
# VERCEL_GIT_PREVIOUS_SHA is the last deployed commit; with none (first deploy) build.
[ -z "$VERCEL_GIT_PREVIOUS_SHA" ] && exit 1
git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null || exit 1
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- \
  . \
  ../../tokens \
  ../../config \
  ../web/src/styles \
  ../web/src/components \
  ../web/src/assets \
  ../web/src/lib/icons.ts \
  ../web/src/scripts/themeInit.js \
  ../../package.json \
  ../../package-lock.json
