# Sources and weights

Design agreed with the owner on 2026-10-19, not yet built. Three sub-projects, built in this order; each is one branch and one PR. When one ships, its requirements move into [specs/settings.md](../specs/settings.md) and [specs/engine.md](../specs/engine.md), a decision is recorded, and its section here is deleted.

## 1. Weights that mean something

The topic weights (judge categories) read as academic fields and set a number nobody can hear the difference in (0.88 vs 0.85).

- **Names.** Only the display `name` and a one-line hint change; ids stay, because the judge, old digests and votes point at them.

| Id | Name | Hint |
| :--- | :--- | :--- |
| design_engineering_craft | Build breakdowns | How a detail was made, with code |
| hci_empirical_research | User studies | Research with a method and results |
| ui_component_primitives | Components | Dialogs, popovers, component libraries |
| css_canvas_motion_techniques | Motion and CSS | Techniques with a demo |
| developer_tool_launches | Tool launches | New frameworks, editors, CLIs |
| taste_and_design_philosophy | Design essays | Taste, principles, how to think |
| ai_ux_interaction_patterns | AI interface patterns | Chat, agents, streaming UI |
| frontier_model_releases | Model releases | Model cards, benchmarks, reports |
| consumer_tech_releases | Device launches | Phones, laptops, chips, OS updates |
| venture_capital_and_gossip | Funding and gossip | Rounds, valuations, acquisitions |
| generic_ai_hype_listicles | AI hype lists | Top-10 tools, no technique |

- **Slider with fixed stops.** A native range input with five stops drawn as ticks; the stop's name sits beside it and is its accessible value ("Build breakdowns, More").

| Stop | Weight | Means |
| :--- | :--- | :--- |
| Off | 0 | Never in a briefing |
| Less | 0.5 | Only a strong story |
| Normal | 0.7 | Competes on merit |
| More | 0.85 | Preferred at equal quality |
| Most | 0.95 | First pick in its topic |

- **Off replaces `NEVER_PUBLISH`.** Weight 0 is never published; Funding and gossip and AI hype lists start at Off and can be turned on.
- **Migration.** `config/preferences.json` weights snap to the nearest stop: User studies 0.92 to 0.95, Motion and CSS 0.88 to 0.85, Tool launches and Device launches to 0.85. Expect a small ranking shift.
- **Learn.** `dispatch learn` moves a weight one whole stop, never between stops.
- **Tests.** One unit test in scoring: weight 0 never publishes, and a stored in-between value snaps to its stop. Rewrite the tests that pin `NEVER_PUBLISH` in the same commit.

## 2. Source library

- **Format.** Every source gets a required `format`: `blog`, `news`, `forum`, `video`, `research`, `releases` or `podcast`. Company and lab announcements are `blog`.
- **Rule fallback.** Derived from `type` where it decides: `youtube` video; `github`, `producthunt` releases; `arxiv`, `crossref` research; `hn`, `lobsters` forum. Anything else is `blog`. Used when Jev is unavailable.
- **Backfill all sources.** `npm run dispatch -- classify-formats` asks Jev for the format of every source (164) and writes a review table; the owner reviews it before it is committed through the write guard. A row where Jev contradicts the rule is flagged, never silently overridden.
- **New source.** On URL entry the Format select fills at once with the rule guess; `/api/source-preview` asks Jev in the same request and its answer replaces the guess unless the owner has already picked one. After 3 s the rule guess stands; the field never blocks (D75). The add panel and the source editor carry the select; a change is `source.update`.
- **Search and filters.** One component on Topics & Sources (all sources) and on each topic page (its sources): a search field, format chips with counts, a separator, status chips (Off, Failing, Not scored). Chips within a group OR, groups and the query AND; a chip with 0 matches is disabled.
- Search matches name, address and topic name, case and accent blind, as you type.
- **Index.** An empty query with no chips shows the topic list as now; otherwise a flat list of matching rows labelled "Blog · Design", which open and edit as on topic pages.
- **Topic page.** A filter lifts the fold after seven.
- Scenario: WHEN nothing matches THEN "No sources match" with Clear.
- Scenario: WHEN the page is reloaded or Back returns to it THEN the query and chips hold (`?q=&format=&status=`).
- **Tests.** One phone journey: search, chip, open a source, Back, filter still applied. One unit test: format derivation by `type`.

## 3. Mix and lean

- **Format mix.** A topic's page gets a Formats group: one fixed-stop slider per format its sources use, same stop names as the weights, acting as multipliers: Off excludes, Less ×0.85, Normal ×1, More ×1.1, Most ×1.2. Default Normal. Stored as `format_mix` on the topic in `config/topics.json`, Normal omitted; edited through `topic.update` and autosave. Applied in `scoreTopics` after weight × fit, then clamped to 0 to 1.
- **Lean rating.** Each general-topic source gets `lean`: -2 (Left) to 2 (Right), or `null` for unrated. Jev rates them once in a review table like formats; editable in the source panel.
- **Perspective slider.** World, Business, Science, Culture and Sports each get one: Left, Centre-left, Even, Centre-right, Right; default Even. It multiplies a story's score by up to ±15% by its outlets' lean (Centre and unrated neutral); Even changes nothing.
- The two-outlet rule and Science's one-outlet exception (D120) stay; the slider re-ranks qualifying stories and removes none.
- **Outlet cap.** At most two stories from one outlet per briefing, in `selectItems`. A constant until a briefing shows it needs tuning.
- **Tests.** Unit, where the logic lives: format Off excludes; lean at Even changes no score; the outlet cap holds. One browser journey: move a format slider, reload, it holds.

## Later, not designed

Original over coverage, freshness window per topic, follow-ups only on new developments, a discovery share, region and language for general topics, paywall tolerance, stories per general topic, and a page for keywords, authors and disliked patterns.
