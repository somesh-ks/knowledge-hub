Frozen copies of `config/preferences.json` and `config/voice.md` for tests, so a weight the owner
saves in Settings never breaks the suite. `committed-data.test.ts` checks that the live files
still parse. Refresh a copy only when a test needs a new field.
