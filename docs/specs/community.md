# Community signal

What practitioners vote up and argue over lifts a story; where the engine reads it. Reasons: D240.

## Requirements

- Votes: every Hacker News, Lobsters or Reddit source puts the story's counts in `item.signals` (`hn_points`, `hn_comments`, `lobsters_score`, `reddit_score`, `reddit_comments`). Dedupe keeps the larger count of each when two sources carry one story, so a blog post discussed on two platforms counts on both. Community votes are HN points plus comments, Lobsters score x 5, and Reddit score plus comments, summed (`communityVotes`).
- Lift: `config/community.json` (`enabled`, `min_votes`, `full_votes`, `max_depth`; git-only, hand-edited) makes a built-in category read at craft depth `max_depth` x (0.5 + 0.5 x strength) at least, where strength runs 0 to 1 on a log scale from `min_votes` to `full_votes`. Under `min_votes` nothing changes. Hype, sponsored and funding flags still count. Consumer tech (launch scale), the `none` category and a custom topic that won keep their score. The score never goes down (`withCommunity`). It runs after the authority lift and before the type mix, source adjustment and taste check.
- Shipped `enabled: false`: nothing above changes a score. With it off, the write stage logs the pool stories the lift would add (after the type mix and source adjustment, muted categories applied). A page only a new source would fetch is not in the pool.
- Prefilter: a Reddit score over 200 keeps a story with no keyword match, as HN points over 100 do; Reddit's score joins the vote term that ranks the pool.
- Hacker News sources: `hn-show` reads Show HN. `hn-ai` and `hn-design` set `options.query`: Algolia returns stories above `min_points` that match any of the words (`optionalWords`), so the topic's discussions reach the pool.
- Reddit: a `reddit` source reads `options.subreddit`'s top listing for the fetch window's period (day, week or month) at `options.min_score` or higher, asking for unescaped JSON (`raw_json=1`) and starting a day early so a post that crossed the floor since the last fetch is seen. It skips stickied and adult posts, keeps the more voted of two posts of one link, and takes a text post's full text as its content; a text post links to its thread. Reddit refuses many datacenter addresses, so a failing fetch shows in source health like any source. The six shipped subreddits are off until a run shows one gets through.
- `high_signal` is held by the sources the owner names favorites. The GitHub release feeds and the shadcn changelog do not carry it: releases are low signal.

Scenario: a lab's launch post (frontier_model_releases, depth 0) with 400 HN points and 180 comments has 580 votes, strength about 0.6, and scores about 0.48: over the 0.4 bar, under a technique piece at 0.7. The same post with 20 points and no comments has 20 votes, stays at 0.38 and drops.

## Code

- `packages/engine/src/community`
- `packages/engine/src/fetch/reddit.ts`
- `packages/engine/src/fetch/hn.ts`
