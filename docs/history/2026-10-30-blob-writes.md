# 2026-10-30: Blob writes cut to what cannot be derived

The Blob store was blocked at Hobby's 2,000 advanced operations because ingest wrote one object a story (D251, #466). The Pro trial brought the site back. Two writers were left that spent the allowance on work the site can redo: covers (nine puts for each new briefing or episode) and stage results (one put a stage).

Covers are now drawn when asked for and kept by the CDN; a podcast run writes its stages to Blob only when it fails, as one object (D256). The function was checked in a Vercel-adapter build on Linux: the four fonts, resvg and sharp are in `_render.func`, and a cover drew with its date. What no local run shows is the CDN keeping the answer and `vercel.json`'s `/covers/` header rules against the function's own headers; see the unverified line in `docs/state.md`.

Not done: audio segments and live script copies still write to Blob, and a run killed by the job timeout leaves no stages to resume from.

The live check of #482 (23:13Z) found the CDN keys a cover by path and ignores the query and the function's CDN header; a 404 and a `?v=zzzzzz` address were both served from another entry's cache. D257 moves the version into the rewrite's path and reads the store again before answering missing.
