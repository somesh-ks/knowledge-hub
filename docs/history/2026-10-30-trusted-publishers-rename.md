# Trusted publishers list gets a name that says what it is

2026-10-30 (D250). The owner read `config/authority.json` and asked for a name that says what the file is, and for Reddit to go because Reddit blocks bot scraping.

## What changed

- `config/authority.json` became `config/trusted-publishers.json`. Same shape, same `enabled: false`, same behaviour. The owner then asked to rename everything, so the module (`trustedPublishers/`), its identifiers, the command (`singularity publishers replay`, was `authority replay`), the spec (`docs/specs/trusted-publishers.md`) and the score breakdown flag (`trusted_publisher`, was `authority`) follow. Notes written before 2026-10-30 keep the old word; the score flag appears in no stored file.
- The six Reddit seeds left the seed list and `config/sources.json` (173 sources, 167 after). The `reddit` fetcher, its vote fields and the prefilter term stay as dormant code. The runtime source list lives in the config store (D149), where the six disabled rows may remain; they fetch nothing.

## How the lists are organised

Sources stay grouped by topic category. The trusted publishers list is a separate small list keyed by domain, each with the categories the owner vetted it for; it is not a second taxonomy of sources. `config/community.json` is a setting. No new store.

## Not done

- Reddit through OAuth credentials, if the owner wants it back (D240).
