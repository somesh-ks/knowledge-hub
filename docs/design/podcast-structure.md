# Podcast structure: a modular script for every kind of episode

A design for the owner's ask of 2026-10-23: "In preferences page there must be a segmented selector, one for source types, another for podcast structure (making it modular, able to add and delete new sections). This will enable dynamic podcast structure for script generation. The scope is set for all kinds of podcasts. Evolve this idea to address all gaps before building it." Nothing here is built; D163 records it as proposed. Code and tests win where they differ once it is built.

## What exists today

Two shapes, in two places, neither editable:

- **A briefing's sections.** `packages/core/src/categories.ts` holds the built-in section order (`SECTIONS`: Top picks, Design, Design Engineering, Software Engineering, AI Products, Tech Product Launches, Trending, Research, Launches, Watch and listen) and each custom topic adds a section of its own. The curate step fills them with allowances and caps (release news 6%, Trending and Tech with their own allowances, Science one outlet, D120, D155). The digest records `section_titles` in reading order, so an old briefing keeps its headings when a topic is renamed or removed (`digestSections`). The site's briefing page draws the sections as tabs; narration on Play reads them in that order.
- **An episode's shape.** `packages/engine/src/podcast/plan.ts` derives an `EpisodeStructure` from the length and the story count: a one-line hello, a rundown that teases the lead stories, deep dives from the top of the ranking, nuggets for the rest, a close and a sign-off, each with a character budget per format (readout, discussion, headlines). `prompt.ts` turns it into "STRUCTURE, in this order" lines for the writer; `fit.ts` cuts whole blocks from the end when the script runs long; `check.ts` rewrites turns that invent numbers.
- **Preferences** (`/settings/preferences`) holds one thing: the source type mix (`format_mix`, D124), sliders in a card.

The owner's ask is to make the second shape, and by extension the first, a list the owner edits.

## The model

One **structure** per podcast kind: `daily`, `weekly`, `catch_up`. A structure is an ordered list of **blocks**. The engine reads it to order a briefing's sections and to plan an episode's script, so the two shapes become one.

| Block | What it does | Fields | How many |
| :--- | :--- | :--- | :--- |
| `hello` | The one-line opening that names the show | none | one, always first |
| `rundown` | Teases the lead stories | `stories` (1 to 6) | at most one |
| `section` | A briefing section: a topic's stories | `id` (a built-in section or a topic id), `depth` (`deep` or `brief`), `max_stories` (1 to 8) | any number, each id once |
| `top_picks` | The judge's best stories across topics | `stories`, `depth` | at most one |
| `trending` | Stories several outlets cover | `stories` | at most one |
| `release_news` | Library, framework and changelog stories | `stories` | at most one |
| `close` | The reflective close before the sign-off | `length` (`short`, `long`) | at most one |
| `sign_off` | The last words | none | one, always last |

Rules the schema holds:

- `hello` and `sign_off` are the frame: present in every structure, never moved or removed. Everything between them is the body: reordered, added, removed.
- Each section id appears once; an id of a topic that no longer exists is dropped when read (as `digestSections` already tolerates), never an error.
- At most twelve blocks. A structure with no body block is refused: an episode of only a hello and a sign-off is a mistake, not a request.
- Depth and counts are hints to the budget, not promises: the length still rules (`fit.ts`), and a block whose stories did not show up that day is skipped and the writer is told so, so the hello and rundown never name what is not there.

Defaults reproduce today exactly. Daily: hello, rundown (4), top_picks (deep), one `section` per built-in section in today's order (brief), trending, release_news, close (short), sign_off. Weekly: the same with `close` long and rundown 5. Catch up: hello, rundown, top_picks deep, sections brief, close, sign_off; the Catch up form's topic chips still choose which sections run. A missing structure file means the defaults, so nothing changes until the owner edits.

## Where it lives and how it travels

- **Config:** `config/structure.json`, zod-typed in `packages/core/src/structure.ts` (`StructureFile`: `{ version, kinds: { daily, weekly, catch_up } }`). A new document in `CONFIG_DOCUMENT_PATHS` (D149), in the `config` write-guard list, seeded by `dispatch config seed`.
- **Op:** one `structure.set` `{ kind, blocks }` replacing the kind's whole list, as `weights.set` replaces weights: idempotent, one request per change, no index arithmetic on the wire. `applyConfigOp` validates with the schema and writes the file. The site's `parseConfigOp` rebuilds it from validated parts, as every op is.
- **Engine:** the gate copies the stored document as it copies the others. `curate` orders and caps sections from the kind's blocks (a `section` block's `max_stories` is its allowance; a missing block means the section is left out of the briefing, which is how a topic's "Listen in" scope works today, so the two must agree: the structure is the one place, and `topic.scope` writes through to it). `podcast/plan.ts` derives `EpisodeStructure` from the blocks and the budget (deep dives = `top_picks.stories` plus the `deep` sections' stories, nuggets the rest, teased = `rundown.stories`); `prompt.ts` writes the order from the blocks, naming each section; `fit.ts` cuts the body blocks from the end, never the frame, and the `close` before any section. Narration of a briefing reads sections in structure order, which the digest's `section_titles` already records at write time, so a later edit never reorders an old briefing.
- **Costs:** none new. The writer's call is the same size; a longer structure is bounded by the same length budget.

## The screen

`/settings/preferences` keeps its one card and gains the segmented switch the owner named, with the pattern the topic page uses (`?view=`, kept on reload):

- **Source types**: the sliders as today.
- **Structure**: a chip row for the kind (Daily, Weekly, Catch up: the shared filter chips, one chosen), then the blocks as rows in the card. A row is the block's name and its summary ("Design, 3 stories, in depth"; "Rundown, 4 stories"), a drag affordance by the row itself (the queue's gestures, D162: a long press or a mouse drag reorders, a swipe left removes a body block, the dots open Move up, Move down, Edit, Remove), and the frame rows at the ends drawn quieter with no menu. Under the list, one tonal button, Add, opens a bottom sheet (a popover on a desktop) listing the blocks not yet in the structure: each section the owner's topics offer, and the singletons not yet placed. Edit opens the same sheet filled in: depth as a segmented choice, stories as a slider on fixed stops. Every change autosaves as one `structure.set` (autosave.ts, D115: no toast while saving), and a removal leaves at once with Undo (D142).
- One quiet line under the card says what the structure fills at the kind's length: "About 5 minutes: 1 deep dive, 6 short stories" from the same arithmetic the planner uses, so an owner who adds eight deep sections to a 3-minute daily sees why the episode will cut them.

## Gaps this closes, and how

1. **Two shapes drift apart.** Today a briefing's reading order and an episode's story order are decided in different files. One structure feeds both, and the digest's `section_titles` snapshot keeps old briefings stable.
2. **Scope has two homes.** "Listen in" (`topic.scope`) and the structure both say whether a topic is in a kind. The structure is the record; `topic.scope` becomes a convenience that adds or removes that topic's `section` block, so the topic page keeps its control and nothing disagrees.
3. **Length against ambition.** The owner can list more than a length holds. The planner keeps the budget; the page says what fits; `fit.ts` cuts from the end of the body, so the owner also learns that order is priority.
4. **A day with nothing in a section.** The block is skipped and the writer is told, so the hello and rundown stay honest; the briefing page already omits empty sections.
5. **Regenerate and the Catch up form.** Regenerate (D108) uses the structure of the item's kind; the Catch up form's topic chips filter the `section` blocks for that request only and never write the structure.
6. **Old digests and old config.** A digest keeps its snapshot; a config without the file reads as the defaults; the config store seeds the new document from the committed file.
7. **Accessibility of reorder.** Every pointer gesture has a menu item (Move up, Move down) and the moves are announced, as the queue's are.
8. **Validation at the edge.** The site rebuilds the op from validated parts and the engine validates again with the same schema, as every op is treated (D149's write path).

## Tests, few and placed where the logic lives

- Core: the schema refuses a frame out of place, a duplicate section, an empty body (one table test).
- Engine: `structureFor` from blocks reproduces today's `EpisodeStructure` for the defaults (the golden), and a `fit` that cuts a body block never cuts the frame.
- Site: one journey in `topics.spec.ts`'s style: reorder two blocks, reload, the order holds and one `structure.set` was sent.

## Open questions for the owner

1. Should a briefing's section order follow the structure too, or only the episode's script? (The design says both; the briefing page's tabs would reorder on the next run.)
2. Is a `custom` block wanted: a free-text instruction the writer follows at that point ("a one-line weather note", "what to watch this week")? It is the most powerful block and the easiest to misuse; the design leaves it out of the first build.
3. Should Weekly get blocks of its own (a recap of the week's dailies, a long read) in the first build, or follow the daily vocabulary first?
4. Does the Catch up form need its own structure editor, or is per-kind enough?
5. Does the structure go in `preferences.json` (one file, one op family) or its own file? The design chooses its own file so a `structure.set` never races a `mix.set`.

## Phasing

1. Schema, file, op, engine reading the defaults: no visible change, every test green.
2. The Preferences switch and the Structure view with reorder, add, remove and edit.
3. Weekly's own blocks and the free-text block, if the owner wants them.
