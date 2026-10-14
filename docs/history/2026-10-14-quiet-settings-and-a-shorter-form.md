# 2026-10-14: the bottom stack, the Model list, a shorter form and quiet saves

The same cloud session as [the first-load cuts](2026-10-14-first-load-cuts.md), after it. The owner sent feedback in rounds while the first-load work merged; D113 to D115 record the decisions, #118 to #125 carry the work.

- The bottom stack (#120, #124). A screen recording showed the player bar, the navigation and the floating button drifting apart while Chrome's address bar slid, then snapping back. The bar was held by both edges and the other two by their bottom; on mobile Chrome only a bottom-held element follows the address bar in the same frame. The player is now held by its bottom and is `100dvh` tall. The browser suites cannot see this (headless has no address bar), so the owner was asked to record it again on a phone.
- The Model list (#121, D113). The headings sit on the left, the Default row is gone, Claude Sonnet 5.5 is the default writer, and Nebius starts on GLM-5.3. The review (#124) found that the engine still treated a missing `config/writer.json` as Nebius. Core now holds the one default.
- The edit source panel (#122). Spacing comes from the tokens, and the scorecard has one title on the left and the rating on the right. A source with no score gets a short empty state.
- The New episode form (#123, D114). The General audience and its preset line are retired. The form is Title, Topics, Length, Look back, with Format, Voice and Tone under More options. Four create specs were deleted with the feature.
- Quiet saves (#125, D115). The owner wanted settings to feel live. The Saving and Saved toast and the "Saved. Live in about a minute." line are gone, and a screen reader still hears "Saved.". The specs now wait for the spoken word, and the tests that pinned the Saving state were deleted. The list headings are regular weight.
- Process (#114, #118, AGENTS.md). There are two ways to get a code review: the `review` label, or the `/code-review` skill. After large work: clean up, review and confirm production. Tests are streamlined with every feature change.

What the review of #119 to #123 accepted without a change: `NEBIUS_DEFAULT_ID` is the owner's setting, and the retry logic duplicated between the page-content loader and the player sheet facade waits for a third caller.

What could not be checked here: the bottom stack on a real Android phone, and whether "almost instantly" is met beyond the settings pages. Other pages update after the config commit and redeploy, about a minute (D79), and quiet saves do not change that.
