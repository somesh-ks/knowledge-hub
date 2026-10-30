#!/bin/sh
# Vercel's ignoreCommand: exit 0 skips the build, exit 1 runs it. The admin app draws with the
# reader's stylesheets, components and tokens, so a change there rebuilds it too. config/ is left
# out on purpose: a flag file changing in git need not cost a deploy, since the Experiments page
# lays the store's switches over the build's (2026-10-30, the owner). The switch function (api/experiments.ts) bundles
# the store module that writes the flags, so that file rebuilds it.
# VERCEL_GIT_PREVIOUS_SHA is the last deployed commit; with none (first deploy) build.
[ -z "$VERCEL_GIT_PREVIOUS_SHA" ] && exit 1
git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null || exit 1
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- \
  . \
  ../../tokens \
  ../web/src/styles \
  ../web/src/components \
  ../web/src/design-system \
  ../web/src/assets \
  ../web/src/lib/icons.ts \
  ../web/src/lib/brandMarks.ts \
  ../web/src/lib/healthRows.ts \
  ../web/src/scripts/segmentedNav.ts \
  ../web/src/scripts/themeInit.js \
  ../../packages/engine/src/store/experimentFlags.ts \
  ../../package.json \
  ../../package-lock.json
