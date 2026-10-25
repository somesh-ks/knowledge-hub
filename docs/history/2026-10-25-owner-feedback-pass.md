# The owner's feedback pass, and what was left out

2026-10-25. The owner sent 42 feedback items across ten pages as one plan, then added five more mid-session: voice pitch drift, a structure by listener profile, provider logos, Windows flags, and an internal topic-to-category rename. Ten parallel workers built them in worktrees; the main session integrated, audited and merged.

## What shipped

| PR | Scope |
| :--- | :--- |
| #308 | YouTube feeds keyed by `channel_id` (every channel read as "already a source"); the store's replay reads a channel's feed address; narration pins `language` to en-US and hashes it (the pitch drift); the voice default traced to an empty saved pair |
| #309 | Costs: stat pills, the companies' own marks, grow-in columns, a square compact tab on a 44px column, "Last updated" note. About the author, Privacy policy links, no Change log subtitle |
| #310 | Slider cap token, weight-row grid, card row end inset, full-bleed divider, "N sources active"; Blocked sources as a filter plus a catalogue sheet; one structure chosen by profile (D191); votes tune weights through a bounded, decaying adjustment (D190); `.text-link` |
| #311 | Create form (40px segmented choice, round More options, alphabetical, "Generate catch up", "Max length", Primary and Secondary voice); share dialog; `.source-link` as a link; the rail's reading line; Library press states; SVG voice flags from a Flagpack sprite |
| #312 | "Category" in every string the owner reads; `/settings/topics` redirects to `/settings/categories` |

Each UI PR had a design audit; its findings were fixed before merge (the Costs head overflowing at 1280, an oval More options panel, the Profile row off the text edge, the share dialog's styles in a page stylesheet, the Block sheet's field).

## Left out, for a later session

### The internal rename of topic to category

The owner wants every `topic` in code to read `category`. It touches about 6,500 occurrences in 300 files, and much of it is persisted or crosses a boundary, so a blind rename stops the engine reading existing data. Do it migration first, in this order:

1. Inventory every persisted or boundary use: `topic_ids` on each source in `config/sources.json`; `skip_topics`, `weekly.skip_topics`, `custom.skip_topics` and `general_scoped` in `config/schedule.json`; `config/topics.json`; the profile's `auto_adjust` keys (D190); the config store's saved `config.yml` rows (Neon, D149, D185); committed `Digests/` and `state/` (never edited by hand); the `topic.*` config ops and their API bodies (`/api/config`); the `topic_emoji` model step; browser storage keys (see `scripts/storageRename.js` for how a past rename moved them); `?topic=` URL parameters; analytics event fields; the CLI's `--topic` and the workflows' `topic_id` and `new_topic` outputs (`config.yml` workflow).
2. Write the compatibility rule: readers accept both names, writers write the new one, a saved document migrates on its next save, and digests and state are read in both forms forever. Record it as a decision.
3. Rename by script, not by hand, with the inventory as the exclusion and alias list; then the full gate, both browser suites and a review.
4. The workflow changes go in a PR of their own, merged by hand (the auto-merge token cannot merge `.github/workflows`).

### Other items not done or not verified

- **A 15 minute episode falls short.** The engine issue stays in [state](../state.md); only the label changed to "Max length".
- **The Library stack shrinking when a menu opens** was not reproduced at 390 or 1280 with real scrollbars. A `@both` guard now holds the stack's box to itself; the owner's device may differ (a touch device, a different scrollbar).
- **A video source vanishing after refresh** was not reproduced in a browser. The duplicate key and the store replay were fixed; a topic page is built at deploy time, so a fresh add can also look gone until the deploy lands.
- **Voice flags missing:** Saudi Arabia (136 KB of arms alone), Indonesia, Israel, Kenya and Taiwan show a letter badge to keep the sprite at 90 KB.
- **Firecrawl's logo** is a drawn flame; Firecrawl publishes no vector mark. Exa and TypeSafe show a letter form.
- **Story-block prompts** on the Structure view show the briefing's default until the owner saves one.
- **The "Adjusted" mark** on a weight row is text; a glyph was asked for. Its constants (0.02 a vote, plus or minus 0.2, a 30 day half-life) are first guesses.
- **Narration re-spends characters once:** the language joined the segment hash, so stored segments narrate again on first play. An episode turn skips `toSpeech`, so a `<` in a turn could reach Speechify as markup.
- **A blank `SPEECHIFY_VOICE_ID_B`** reads as one voice on the site and as the default second voice in the engine; it wastes pre-narrated files, never mixes voices.
- **The owner's action:** save the primary voice once on the Voice page; the saved pair is empty, so the engine falls back to its defaults and the weekly keeps an old "alicia".
- **Not seen in a browser:** dark theme at every width for the settings and Create pages, the Library tap flash on a real phone, the share dialog on iOS.

## Lessons

- Playwright wanted Chromium 1248 with 1243 cached; workers reported "no browser". An untracked override config pointing at the cached shell ran both suites ([learnings](../learnings.md)).
- A branch that merged other open branches before they were squash-merged conflicted in nine files with main; cherry-picking only its own commits onto main was clean.
- Adding the `review` label right after a push did not re-run the review; removing and re-adding it did.
- Biome's `noSvgWithoutTitle` is an error for a sprite in `public/`; the root lint fails in CI while `biome check <paths>` in a worktree passes at warning level.
