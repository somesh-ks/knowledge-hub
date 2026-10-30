# Short dailies: Step 0 of the pipeline plan

2026-10-29. The daily aired about 3.8 of 5 minutes. Step 0 of the pipeline plan was to make it air within 10% of its length (about 15 stories) before any ingest work.

## What the dry runs found, in order

- Selection dropped stories the structure had no place for (a preset that listed no World, Business or Science) and capped each general section at a flat 2. Fixed by #413 and #415 (D216).
- The block's story count read as a hard number, so the length could not govern it. Now a proportion, the length is the limit (#418, D218).
- A fifth summary sentence or a headline two words over cost 4 of 15 stories, each after a rewrite that missed the limit again. The summary now loses its trailing sentences and the headline its trailing clause, kept only if the text then lints clean (#422, D220).
- A headline with no clause break still dropped its story. A Haiku call now shortens it, and a shortening that fails, still fails lint after the clause cut, or drops or adds a number falls back to the full rewrite (#426, D225). Each fallback guard came from a review finding and has a case in one test.
- Extraction failures: the Firecrawl week was spent by Tuesday, so the dailies of 28 and 29 Oct fetched no listings and scraped no articles. The 100 a week was our own cap, not the plan's; it is now 300 a week and 60 a run (#424, D222), with a Health warning at 150 (#425, D223).

## The last dry run before the Firecrawl change

Selected 16, written 11, lost 3 at extraction and 2 at the voice check, validation dropped 2, the refill kept 2, so 11 items against about 15 wanted. The 24 Oct Firecrawl entries age out of the 7-day window on 31 Oct, so the first full-budget daily is that morning.

## Open

The exit check is two real dailies in a row within 10% of their length (about 31 Oct and 2 Nov); `docs/state.md` holds it as "Short podcasts". Three of the five PRs took a decision number another PR had just taken; re-check main for the number right before merging.
