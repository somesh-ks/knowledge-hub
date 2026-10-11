# 2026-10-11 Streamlined Topics and Timezone

## Why

1. **Add topic flow friction:** Previously, creating a topic asked for keywords and took the user through an intermediate sources selection modal. Dropping the keywords field and moving source discovery to the topic detail page simplifies creation to: Name, Description, and Scope. Creating immediately navigates to the topic page.
2. **Lively topic source discovery:** Showing 5 dynamic suggested sources on each topic detail page, scored by TypeSafe Jev quality metrics with an inline plus action, makes curating sources interactive without leaving the topic view.
3. **Podcast topic scope clarity:** In Daily and Weekly settings, listing in-scope topics as read-only chips alongside a Configure button keeps the current podcast scope clear while centralizing topic management under Topics & Sources.
4. **Timezone configuration:** Adding a timezone selector to the schedule When row allows explicit configuration of briefing timezones across global regions, persisted in `config/schedule.json` with fallback to `Europe/Stockholm`.
