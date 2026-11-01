# Specs

What each capability does now, one file each. A spec states requirements in the present tense, adds a `Scenario:` only where behaviour has an edge, names the D-numbers it rests on and the code that implements it. History lives in [history/](../history/README.md); the reasons live in [decisions](../decisions/README.md). Read on demand; the code and tests win where they differ, so fix a spec you find wrong. Budget: 8 KB a spec (`scripts/docsCheck.mjs`).

| Capability | Spec | Code |
| :--- | :--- | :--- |
| Player | [player.md](player.md) | `apps/web/src/player` |
| Library | [library.md](library.md) | `apps/web/src/scripts/libraryPage.ts` |
| Create | [create.md](create.md) | `apps/web/src/sheets` |
| Settings | [settings.md](settings.md) | `apps/web/src/pages/settings` |
| Health page | [health.md](health.md) | `apps/web/src/server/health.ts` |
| Admin overview | [admin-overview.md](admin-overview.md) | `apps/admin/src/pages/index.astro` |
| Admin analytics | [admin-analytics.md](admin-analytics.md) | `apps/admin/src/pages/analytics.astro` |
| Experiments page | [experiments.md](experiments.md) | `apps/admin/src/scripts/experiments.ts` |
| Engine | [engine.md](engine.md) | `packages/engine/src` |
| Narration | [narration.md](narration.md) | `apps/web/src/narration` |
| Trusted publishers list | [trusted-publishers.md](trusted-publishers.md) | `packages/engine/src/trustedPublishers` |
| Community signal | [community.md](community.md) | `packages/engine/src/community` |
| Costs | [costs.md](costs.md) | `packages/core/src/costs.ts` |
| Analytics and privacy | [analytics.md](analytics.md) | `apps/web/src/lib/analytics.ts` |
| Sharing | [sharing.md](sharing.md) | `apps/web/src/server/share.ts` |
| Notifications | [notifications.md](notifications.md) | `apps/web/src/server/pushWatch.ts` |
| Navigation and offline | [navigation-and-offline.md](navigation-and-offline.md) | `apps/web/public/sw.js` |
| Look and sound | [look-and-sound.md](look-and-sound.md) | `apps/web/src/styles` |
| Motion | [motion.md](motion.md) | `tokens/tokens.json` |
| Style guide | [style-guide.md](style-guide.md) | `apps/design` |
