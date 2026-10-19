# Specs

What each capability does now, one file each. A spec states requirements in the present tense, adds a `Scenario:` only where behaviour has an edge, names the D-numbers it rests on and the code that implements it. History lives in [history/](../history/README.md); the reasons live in [decisions.md](../decisions.md). Update a spec in the same PR as the behaviour. Budget: 8 KB a spec (`scripts/docsCheck.mjs`).

| Capability | Spec | Code |
| :--- | :--- | :--- |
| Player | [player.md](player.md) | `apps/web/src/player` |
| Library | [library.md](library.md) | `apps/web/src/scripts/libraryPage.ts` |
| Create | [create.md](create.md) | `apps/web/src/sheets` |
| Settings | [settings.md](settings.md) | `apps/web/src/pages/settings` |
| Engine | [engine.md](engine.md) | `packages/engine/src` |
| Narration | [narration.md](narration.md) | `apps/web/src/narration` |
| Navigation and offline | [navigation-and-offline.md](navigation-and-offline.md) | `apps/web/public/sw.js` |
| Look and sound | [look-and-sound.md](look-and-sound.md) | `apps/web/src/styles` |
