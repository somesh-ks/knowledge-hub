# Data off the deploy path: episodes and settings as data, not code

A design for the owner's ask of 2026-10-24: make the app feel like a professional one, where a setting or a new episode shows at once and nothing rebuilds. Nothing here is built; D167 records it as proposed. Code and tests win where they differ once it is built.

## Where the deploys come from today

Vercel builds `main` on every push that touches a watched path (`apps/web/vercel.json`, `ignoreCommand`). The pushes:

| Push | By | Per | Deploys | Why it deploys |
| :--- | :--- | :--- | :--- | :--- |
| A digest (`Digests/`, `state/`) | `run.yml` | run, every second day | 1 | Pages are built from the digests |
| Its narration metadata | `audio.yml` after the run | run | 1 | The player reads the audio fields from the build |
| An episode (`Podcasts/`) | `podcast.yml` | episode | 1 | The Library and the episode page are built from the file |
| Its narration | `audio.yml` | episode | 1 | As above |
| A settings save | `config.yml` | save | 1 | Settings pages are built from `config/`; with the store on (D149), none |
| Code | a PR merge | merge | 1 | Code |

So an episode costs two deploys and a settings save one, until the store is on. Neon (D149) removes the settings deploy only; D166 makes the settings page show the device's copy when the store is slow or away.

## What the big apps do, and what carries over

Spotify and YouTube ship code a few times a week and keep the user's data in a database and a store, read while the app runs; a save changes a row, a new episode is an upload plus a row, and the screen updates first and syncs behind. Dispatch treats data as code, so every change is a build.

For one user with pre-built pages, the whole pattern is not worth copying: static pages on a CDN are the fastest and cheapest pages there are, and a database read on every page load would make them slower (Neon's free tier sleeps). What carries over is the split: **the page shell and the digests stay built; what changes between builds is read as data, with a copy on the device.**

## The model

Two kinds of thing change between builds: settings (D149, done) and episodes (this design). Digests stay built: a run deploys anyway, and a briefing page is the product.

### Episodes

- **The file stays the record**, written by `dispatch podcast` as today, but to Vercel Blob (`episodes/<id>.md`, the narration beside it under `audio/<id>/`) instead of `Podcasts/` in git. One Blob write, no commit, no deploy. A monthly `chore(podcasts)` commit copies the month's files into `Podcasts/` for the git record and the offline copy, as the config store's snapshot does.
- **An index**, `episodes/index.json` in Blob (id, title, kind, length, cover, published_at, narrated), rewritten by the engine after each write and after narration. One small file, fetched with `no-cache`, the way `/latest.json` is fetched today.
- **The Library and the episode page** are built as today from `Podcasts/` (the monthly copy), and on load lay the index over themselves as the settings pages lay the store (savedView.ts): episodes the build lacks are drawn from the index, the newest first; an episode in the index and not in the build opens `/podcast/?id=` as the topic shell does (D142), reading its file from Blob. The device keeps the last index (D166's pattern), so a reload or an offline open shows what it last saw.
- **Playback** already streams from Blob (D127, D128); nothing changes in the player.
- **Deletion and regeneration** (D108) delete or rewrite the Blob file and the index entry; the monthly copy follows.

### Settings

Done in D149 and D166. What remains is the snapshot: a run copies the store into `config/` and commits it, so git stays the record and the offline copy. Nothing else deploys.

### What still deploys

A run (digest and narration, two deploys every second day) and code. Episodes and settings never.

## Gaps this closes, and how

1. **Two deploys an episode.** None: a write and an index.
2. **An episode takes a build to show.** The index is read on load; the Create sheet's "it is live" check (`/latest.json` today) reads the index too.
3. **Offline.** The device keeps the index and the service worker keeps the episode files it has played (D127); an episode never opened is not offline, as today.
4. **The git record.** The monthly copy keeps every episode in git, a month late at most. `config/` is already snapshotted by each run.
5. **site_behind and the smoke check (D159).** They watch code deploys; an episode write is not a deploy, so neither fires. The health check gains one row: the index names an episode whose file is missing, or the reverse.
6. **Cost.** Blob writes are free on Hobby below the storage line; two fewer deploys an episode; the build no longer bundles every episode file (`episodeSource.ts` globs `Podcasts/`), so a build gets smaller as episodes grow, instead of larger.
7. **The narrate function** (`/api/narrate`) reads the episode text from Blob instead of its bundle. One Blob read a request, cached by the function for the deploy.

## What does not change

Digests, the briefing pages, the player, the service worker's shell, the engine's run and audio jobs, the config store.

## Open questions for the owner

1. Is a month-late git copy of episodes enough, or should every episode still be committed (then one deploy an episode remains, the narration's goes)?
2. The Library page: built from the monthly copy and overlaid (as designed), or rendered at request time from the index (always current, a function call a visit, no static page)?
3. Should digests follow later (a run writes to Blob, no deploy), or stay as code for good? The design says stay.

## Found while building phase 1

- **Covers are built too.** `/covers/<id>-512.webp` is drawn at build time (`pages/covers/`), so an episode that is not in the build has no cover. The engine draws the episode's cover sizes and writes them to Blob beside the file, or the card shows a plain plate until the build.
- **A card needs a page to open.** Phase 1 as written lists an episode the build lacks, but `/e/<id>` does not exist until the build. The shell page (phase 2) has to land with the overlay, not after it.
- **Each episode can stay in git without a deploy.** Taking `../../Podcasts` out of `ignoreCommand` in `apps/web/vercel.json` keeps the per-episode commit and drops its deploy; the next code or digest deploy builds it. This answers question 1 without a monthly copy.

## Phasing

1. The index (the engine side is built, `publish/episodeIndex.ts`): the engine writes `episodes/index.json` after each episode and narration; the Library lays it over itself; the Create sheet reads it. Episodes still committed. No deploy saved yet, but the "it is live" wait goes from a build to a second.
2. Episodes to Blob, the monthly copy, the shell page for an unbuilt episode, the narrate function reading Blob. The episode deploys go.
3. The health row and the runbook.
