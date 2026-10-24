# YouTube through Firecrawl, the refill, and Firecrawl's week

2026-10-24. The owner's urgent ask, "fix all issues, especially the youtube ones", then "change firecrawl budget to 100 per week". A second session took YouTube video text (#238) in parallel.

## What the owner asked

- Fix the YouTube sources and the short briefings (`episode_short`, #197).
- Whether YouTube uses the Gemini API or yt-dlp. Answer: captions from youtube.com, then Gemini transcribing by video URL (Google fetches the video). yt-dlp would hit the same block from the runner.
- Firecrawl at 100 requests a week.

## What landed

- **YouTube feeds through Firecrawl (#235).** Five sources had failed with HTTP 404 on every run for about ten days. YouTube refuses `feeds/videos.xml` to GitHub's runners and serves it to other hosts; Firecrawl fetched it with this week's videos. A source YouTube refuses (403, 404 or 429) is fetched again after the first pass, through Firecrawl's raw scrape, under its limiter, deadline and budget, one request a feed. The fetch report lists `relayed_sources`. The same PR fixed the CI audit (undici, and zod held by an override under `@vercel/cli-config`).
- **The refill (#237).** The 10-24 daily wrote 14 stories for five minutes, and grounding and validation cut 7, so it aired 3.0 minutes. The write stage keeps a reserve (the stories a doubled selection adds, best first by score), and validation writes replacements once when it leaves a sized pass short, best effort. Grounding now sees the source's title and outlet, as the writer does. The Validate step got `FIRECRAWL_API_KEY`.
- **Firecrawl's week (#239, D166).** Each stage reads the cost ledger for the 7 days before the run and holds it to what is left of 100, at most 50 a run. A failed run's spend goes to the ledger with its failure record.

## What went wrong

- The first relay sat inside `loadFeed`, outside Firecrawl's limiter, 429 count and deadline; review moved it to a second pass in `fetchAll`.
- Review found 9, 10, 10 and 10 issues across the four rounds on #237 and #239. The ones that mattered: a refill failure would have failed a briefing that had validated; a re-run of validate marked a refilled pass "nothing" while commit published it; the reserve in section order would have refilled from the leading sections only; failed runs never reached the ledger.
- `recipes.test.ts` (master volume) failed once on #237 with a ratio of exactly 1, as on 10-14; the re-run passed. A suggested task holds the root cause.
- Four open PRs claimed D160 and #234 took D161 while #239 was open; the sessions agreed on numbers (D166 here, D174 up next). #234 and #237 each fit `learnings.md`'s budget alone and overran it together; #239 trimmed it.

## Not done

- Alexandria credits (about 5 a video once #238 lands) stay outside the 100. The owner's call.
- None of the three changes has run live; the 2026-10-26 run is the first, with a check-in set for it.
