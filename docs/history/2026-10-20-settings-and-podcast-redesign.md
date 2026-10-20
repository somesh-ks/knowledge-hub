# Settings and Podcast redesign

2026-10-20. The owner's brief for Settings, the Daily and Weekly pages, Topics and sources, a topic's page and the source panel (D125).

## What changed

- Headings are never bold: the title and lead roles went to regular in `tokens/tokens.json`, and the medium left on headings in `library.css`, `empty.css`, `aside.css`, `create.css` and `topics.css` went too.
- Settings: group heads are 22px regular H2s; Intelligence holds the model select and is now the model editor's root (`data-manage="podcast"`); Daily Podcast and Weekly Podcast titles.
- Topics and sources: search only; `AddFab.astro` below 64rem, routed through `fabFor` (`add`) so the page keeps its foot room and the toast clears it; Add beside the search from 64rem.
- A topic's page: Listen in in the card under a full-width line, On Demand for Custom; `Accordion.astro` for Topic weightage (now on every weighted topic), Formats and Perspective (World and Business only); format tabs from the briefing's tab primitive (`aria-selected` added to its selectors), sticky with the search below 64rem inside `.topic-sources-block`.
- Status filters are gone from `lib/sourceFilter.ts`, the rows and the script; the state is `{ q, format }`.
- `pullDismiss.ts`: touch events, not pointer events, so the drag can take the gesture from the body's scroll; the exit slide adds to the pulled offset; a short pull springs back with the Web Animations API, which the panel's close does not wait on.

## Calls made without asking

- Desktop add: no floating button from 64rem, where none exists elsewhere; Add at the end of the search row on the index and beside the Sources heading on a topic.
- Desktop tabs: the same tab bar as on a phone, not sticky.
- Formats stays at two formats or more; Technology and the general topics have one.
- Perspective on World and Business; Science, Culture and Sports lost it.

## Verified

The gate; the topics, podcast, settings, hidden, rhythm, layout and a11y browser specs (one Linux-only snapshot miss, below); screenshots at 390x844 and 1526x782; a scripted CDP touch pull that closed the panel and a short one that did not.

## Not verified

The pull on a real phone (iOS rubber-banding in a full-screen dialog), the sticky search and tabs under a hiding app bar on a real phone, and the dark theme of the card's line.
