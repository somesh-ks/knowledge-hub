# Changesets

Only `@singularityfm/design-system` (packages/design-system) is released; the apps and the other
workspace packages are ignored. A pull request that changes what the package ships adds one file here:

    pnpm exec changeset

Pick patch, minor or major by [COMPATIBILITY.md](../packages/design-system/COMPATIBILITY.md) and write one
line a consumer can act on. `release.yml` runs only in somesh-ks/singularityfm-design-system (in this repo
both publishing jobs skip). There it turns the pending files into a version pull request and publishes once
it merges. With no file pending it publishes only a version not yet on npm, so once a release is out it does nothing.
