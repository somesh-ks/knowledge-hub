# Authority list

The owner's vetted publishers, by category, and what the engine does for them. Reasons: D234.

## Requirements

- `config/authority.json` lists domains, each with the categories the owner vetted it for (`openai.com`: `frontier_model_releases`). A domain covers its subdomains, never a lookalike host. `enabled: false` (the shipped state) makes every live rule below a no-op; only the shadow log and `replay` still read the list. The file is hand-edited and git-only: the config store never holds it.
- Judge: a first-party announcement shows no technique, so craft depth sinks it (anthropic-blog passed 0 of 15). With the list on, an item from a vetted domain whose most probable category is one of that domain's is read at craft depth 0.25 at least, and its hype and sponsored flags no longer count (funding still does). It scores about 0.52, over the 0.4 bar and under real technique (`withAuthority`). A custom topic that outscored the category keeps its own score.
- Prefilter: a vetted domain's page counts as high signal, so an announcement that names none of the owner's keywords is not dropped.
- Exa: one query per vetted category, worded from its topic's name and description, restricted to that category's domains (`include_domains`). Open queries are unchanged. A category whose topic is off asks nothing.
- Shadow: with the list off and entries present, the write stage logs which stories already in the pool would pass the bar with it on, after the type mix and source adjustment and with muted categories applied (before the taste check and vote weight). A page only the list's Exa query or prefilter would admit is not in the pool, so the log is not the full effect.
- `singularity authority replay <pools-dir> [--days 14]` scores unpacked run pools from `state/judgments.json` with and without the list: new passers with their rank, each domain's pass share, and a flag over 30% for a domain with at least five judged items (the line to reassess at). It scores only items already in the pools, not pages the list would have admitted, so it is not the full effect. Built-in categories only (custom topics are not replayed); offline, no model call.
- A topic judged by fit may carry a `rubric` (at most 600 characters, in `config/topics.json`): "What counts: ..." follows its description in the question. Only that topic is asked again; a topic without one is asked as before.

Scenario: a lab's launch post (category frontier_model_releases, depth 0, hype 0.6) scores 0.38 and drops. With the list on it scores about 0.52 and airs below a worked example.

## Code

- `packages/engine/src/authority`
- `packages/engine/src/commands/authority.ts`
- `packages/engine/src/judge/topicQuestions.ts`
