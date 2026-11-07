#!/bin/sh
# Vercel's ignoreCommand: exit 0 skips the build, exit 1 runs it. The batch rule (five merges, three
# hours, [deploy]) and the doubts that build live in ../../scripts/deploy-batch.sh (D375); this file
# is the list of what the style guide draws with. The style guide draws with the design system and the
# reader's stylesheets, components and specs, so a change in either rebuilds it too.
exec sh ../../scripts/deploy-batch.sh -- \
  . \
  ../../packages/design-system \
  ../web/src \
  ../../package.json \
  ../../pnpm-lock.yaml
