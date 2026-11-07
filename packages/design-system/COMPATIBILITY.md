# Compatibility policy

`@singularityfm/design-system` follows semantic versioning from its first release: a breaking change is a
major bump even while the version starts with 0 (0.4.0 goes to 1.0.0), so an app can tell a breaking bump
from its number alone. Each pull request that changes what the package ships adds a changeset that names
its bump.

## Breaking (major)

- An export removed or renamed: a component, a module path in the exports map, a named export.
- A token removed or renamed (a custom property in `styles/tokens.css` or a key in `tokens/*.json`), or its
  value's type changed (a colour becomes a length).
- A class removed or renamed that a consumer may write or select (the classes a part lists in
  `tokens/system.json`).
- A component prop removed, renamed, made required, or given a different meaning or type.
- The peer dependency range narrowed, or the Node floor raised.

## Not breaking

- New components, props with a default, tokens, classes or exports: minor.
- A visual change to an existing part (a colour, a size, a motion curve): minor, with a line in the changeset
  that says what looks different, so an app can check its screenshots.
- Fixes that restore the documented behaviour: patch.

## Deprecation

A deprecated export, token, class or prop keeps working for at least two minor releases, or four weeks,
whichever is longer. It is marked `@deprecated` with its replacement in the source, named in the changeset,
and listed in the style guide. The removal is a breaking release of its own.

## Announcing a breaking release

The changeset starts with `BREAKING:` and says what to change, with the before and after. The release's
CHANGELOG entry and GitHub release carry it. The app's bump pull request for a breaking release is merged by
the owner, never automatically; patch and minor bumps merge when green.
