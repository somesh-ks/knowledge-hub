# Changesets

Only `@singularityfm/design-system` (packages/design-system) is released; the apps and the other
workspace packages are ignored. A pull request that changes what the package ships adds one file here:

    pnpm exec changeset

Pick patch, minor or major by [COMPATIBILITY.md](../packages/design-system/COMPATIBILITY.md) and write one
line a consumer can act on. `release.yml` turns the pending files into a version pull request and publishes
once it merges; with no file pending it does nothing.
