# 2026-10-09: Snappy navigation and model choice

## Question

The owner said moving between the navigation's pages had a delay and asked for the app to feel instant, for the interface to be refined, for a mild shader somewhere clever, and for the writer's provider and model to be chosen in Settings. One night, several cheaper agents, and a second session working in the main checkout at the same time.

## How the work ran

The main thread measured production first, fixed navigation itself, and briefed three `dispatch-worker` agents in separate worktrees with disjoint files: the Model page, the polish list, and the ambient light. Each branch was rebased onto the others in turn and gated as a stack (fast checks, the whole site suite, the player suite's site projects) before its pull request. The other session's branch was never based on, pushed or included; the two sessions agreed on ports and on who owned which files by message.

## Findings worth keeping

- The delay was not the network. The page arrived in 26 ms and was ready after 70; the remaining 330 ms was a view transition, and not the designed one. Astro 7 drops `data-astro-nav` in the swap, so the stylesheet's rules for a move had never matched and the browser's default cross-fade ran instead.
- With that fixed the floor was still two frames, which a view transition spends on snapshots. A move now skips the transition and the incoming page fades up by itself (D47).
- A service worker that waits for the network on every move costs a round trip per press. In-app moves are now answered from a ten-minute copy and checked behind it.
- A worker's own tests are evidence about what it tested, not about the feature. The ambient light's browser test pressed the navigation from script and filtered out the error its overflow caused; its contrast proof left out the only accent-coloured text. Both were found by comparing with a build that lacked the change.
- My own fix for the software-renderer warning did not work and my test for it passed anyway. It was caught only because the player suite, which fails on warnings, was run again.
- The ambient light passed its whole gate after the rebase and was still wrong to look at: the polish branch had moved the header's top spacing, and the light was cut in a line by the phone's app bar. Screenshots in a real window found it; pixel values found a second, one-row artefact.
- The first press of a session still blocks in `new AudioContext()`. A measurement that seemed to show a cheap remedy was an order effect.

## Decisions

D46 (model choice), D47 (navigation), D48 (ambient light).

## Open

- Owner steps and unverified paths are listed in state.md.
- The other session's branch `ship/progress-sounds` is not pushed. It will meet this night's changes in `AppNav.astro`, `scripts/app.ts`, `styles/view-transitions.css` and `public/sw.js`.
- Six player-suite tests fail on `main` and were not investigated.
