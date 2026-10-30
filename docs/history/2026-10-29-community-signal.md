# Community signal (D240)

Date: 2026-10-29. Thread "Rank stories by trusted sources", after the authority list (D234, #439).

## Why

The owner read the authority list and turned it around: GitHub releases and changelogs are low signal; community discussion, Hacker News, Reddit, blogs and YouTube are the highest, and the aim is to cut through noise with real data. The list lifted announcements by publisher. The score model ignored engagement entirely: `hn_points` only ranked the prefilter's pool, and only Show HN and Lobsters were fetched.

## What was built

- `config/community.json` and `withCommunity`: community votes floor the craft depth, on a log scale, flags still counting. Shipped off, with a shadow log.
- `hn-ai` and `hn-design` (Algolia `query` with `optionalWords`); a `reddit` source type and six subreddits, off.
- Dedupe keeps each platform's votes; the prefilter reads Reddit's score.
- The GitHub release feeds and the shadcn changelog lost `high_signal`.

## Found

- Reddit answered the cloud container with 403 (JSON) and 429 (RSS). Runners are untested.
- Algolia's `query` needs `optionalWords`, or every word must match. Over 3 days and above 50 points the AI query returned 45 stories, the design query 3, so design runs at 30 points.
- Firecrawl's Alexandria catalogue has no Reddit provider.

## Not done

- YouTube view counts as votes: the thread "Get YouTube videos into briefings" adds them, normalised per channel.
- A replay for the community lift: no pools survive, so the shadow log is the evidence.
- Reddit OAuth credentials, if runners are refused.
- Reddit in the ingest source types (D233 shadow week) and in `apps/web/src/lib/episodeHighlights.ts`'s aggregator pattern: both wait until a Reddit source is switched on.
