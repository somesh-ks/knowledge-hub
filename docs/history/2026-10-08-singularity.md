# 2026-10-08: Singularity

## Question

The owner asked for a real podcast app: a new name, the look of Google Podcasts, a player that grows from the bottom bar, longer plain-spoken stories with a source link, a consumer tech section, then control of topics and sources from the app, and a way to generate their own episode.

## How the work ran

One foundation pass in the main thread (tokens, type, icons, shell, primitives), then parallel agents in git worktrees, each owning a disjoint set of files: engine voice and tech section, narrate backend, player, reader, settings; later podcast voice, topics engine, podcast engine, cover art, Topics and Sources pages, Create page. Independent reviewers read the narrate server twice and the playback adapter once; each review found real defects that were fixed.

## Findings worth keeping

- The old player's "stuck" was a navigation while the sheet was open: the portal was destroyed and the controller kept stale state.
- The live Play control never changed state, because the page and the script disagreed on hooks and every player test ran against a lab page. Contracts between markup and script are now tested on built pages.
- A lookup that listed the Blob store let any caller spend the monthly operation quota. Lookups now compute addresses and cost nothing.
- Custom sections needed the reader, the player data and the narration to stop assuming the seven built-in sections; `digestSections` in core is the one source of order and titles.

## Decisions

D30 to D37. D5 and D12 are superseded.

## Open

- Nothing has run against live services. See state.md for the list.
- `docs/design/design-spec.md` still describes the old look and should be rewritten from the built site.
