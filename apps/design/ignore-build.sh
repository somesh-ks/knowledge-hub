#!/bin/sh
# Vercel's ignoreCommand: exit 0 skips the build, exit 1 runs it. The batch rule (five merges, three
# hours, [deploy]) and the doubts that build live in ../../scripts/deploy-batch.sh (D375); this file
# is the list of what the style guide draws with. The style guide draws with the
# reader's stylesheets, components, specs and tokens, so a change in apps/web/src rebuilds it too.
exec sh ../../scripts/deploy-batch.sh -- \
  . \
  ../../tokens \
  ../web/src \
  ../../package.json \
  ../../package-lock.json
