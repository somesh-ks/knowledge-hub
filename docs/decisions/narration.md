# Decisions: narration

Audio: voices, hosts, transcripts and word marks, pre-narration, Opus and the audio job. Rules and the Index are in [README.md](README.md).

## D5: One MP3 per digest with word marks, from Speechify

- Date: 2026-10-05
- Status: Decided. Free-tier availability of marks is confirmed in the spike.
- Decision: Each digest has one MP3 made with Speechify `simba-3.2` and its word-level marks, plus a timeline file with an item start time for each item.
- Reason: The lock screen shows one track with a working scrubber, and every item becomes a seek target.
- Rejected: One audio file per section (breaks the lock-screen scrubber). A timeline estimated from character share as the default (kept only as the fallback).

## D26: Audio uploads use Vercel Blob OIDC credentials

- Decision: The Audio step links the project with `VERCEL_TOKEN`, runs `vercel env pull`, and the engine uploads with `VERCEL_OIDC_TOKEN` and `BLOB_STORE_ID`. `BLOB_READ_WRITE_TOKEN` still wins when set.
- Why: Vercel marks the long-lived Blob token sensitive and never shows it again; new stores default to OIDC.
- Rejected: Cloudflare R2 (more code and a new CSP rule); an upload route on the site (more code, one more secret).
- Status: unverified until the first audio run.

## D28: The audio job runs the Vercel CLI outside the checkout, and its failure is not a failed run

- Decision: `audio.yml` runs `vercel link` and `vercel env pull` in a scratch directory, takes only `VERCEL_OIDC_TOKEN` and `BLOB_STORE_ID` from the pulled file, and fails loudly when either is missing. `loadEnv` treats the `[SENSITIVE]` placeholder as unset. The Generate status endpoint reads the run record when the only failing step is the nested `Audio` step. The site build also runs when `state/last-run.json` changes.
- Why: the CLI edits `.gitignore`, which the write guard refuses; sourcing the whole pulled file lets it override secrets and mangles values with a dollar sign; the digest is already live when narration fails, so reporting "failed" invites a wasted retry; the site reads `last-run.json` for the "nothing cleared the bar" banner. This refines D25, which skipped every `state/` push.
- Rejected: `continue-on-error` on the audio job (not allowed on a reusable-workflow call and it would hide failures); exiting non-zero from `publish` on missing credentials (D23 and its tests keep narration non-fatal).
- Status: unverified until the first audio run succeeds.

## D29: Narration is hosted: a spoken version per story and a code-built host frame

- Decision: The writer returns an optional `spoken` telling (3 to 5 sentences, 40 to 95 words, 700 characters at most) beside the summary, stored on the digest item and never shown on the page. A digest item whose `spoken` fails lint, or states a number the headline and summary do not, loses `spoken` and narration reads the headline and summary as before. Around the stories, `audio/hostFrame.ts` adds an opening that names the product, the day and the count, a bridge into each later section, light connectives between stories and a sign-off (the `outro` segment). All of it is deterministic, chosen by hashing the digest and item ids, and none of it needs a model call, so old briefings gain it too. Headlines are asked to read like a person wrote them; a changelog shape ("X 2.0 released with Y") only warns.
- Why: the briefing is listened to, and a headline read as a title followed by a summary sounded transactional. Telling the story aloud and framing it fixes that without lowering the factual bar, because the summary stays the grounded text.
- Rejected: grounding the spoken text with Jev (more spend for a retelling of text already grounded; a number check is cheap); a model-written host frame (cost, and the same phrases would drift between runs); a clock-based greeting (a digest is written once and heard at any hour).
- Cost: the narration text of every briefing changes, so audio already stored for the old text is not reused. The sign-off adds one segment, so a story-by-story narration of 18 stories is 21 advanced Blob operations.
- Status: unverified against live Speechify.

## D33: Narration is made on Play, story by story

- Date: 2026-10-08
- Decision: A briefing has no audio until someone plays it. Play asks `GET /api/narrate` for the briefing's segments (an intro, one per story, a sign-off), which costs no store operation because each segment's address is computed. The player tries each address and `POST`s only for a file that is missing, which needs the passphrase. The client presents the files as one track on a fixed timeline (`narration/trackAudio.ts`) and makes the next few ahead of the playhead. A briefing is charged whole to the monthly budget the first time any part of it is narrated. This supersedes D5 for new narration; the whole-briefing path and `audio.yml` remain.
- Why: a whole briefing took too long to synthesize inside a function for the first Play to be audible, and narrating every run spent characters on briefings nobody played. A byte stream to the browser would have lost scrubbing, story jumps and resume.
- Rejected: streaming audio to the browser; a manifest file (read-modify-write races between segments); listing the store on lookup (an anonymous caller could exhaust the Hobby Blob quota of 2,000 advanced operations a month).
- Open: a reader without the passphrase cannot make audio. Decide whether the engine should narrate each new briefing once, so the Play path never dead-ends for a wider audience.
- Status: unverified against live Speechify and Blob.

## D74: A discussion's hosts are named after their voices; the transcript names a speaker only where the speaker changes

- Date: 2026-10-11
- Decision: The two hosts of a discussion take names that fit their voices (`hostNamesFor` in `@dispatch/core/hosts`): a voice keeps its own display name when that is one given name, otherwise a name from the female, male or neutral pool for its gender, chosen by a stable hash of the voice id, and the second host moves on when the two would match. The podcast workflow has no Speechify key, so `/api/podcast` resolves them when a discussion is requested (from the cached voice list, within two seconds) and stores `host_names` with the request; the writer is told them and the transcript shows them. A readout names nobody. A discussion made before names were stored keeps Ada and Leo. The transcript has no cards or badges: a small name over a turn where the speaker changes, and only in a discussion. Both voices are always on the Daily and Weekly pages, the second labelled as the discussion's.
- Why: the owner uses a male voice and Ada is not one; a name that disagrees with the voice breaks the illusion in the first line.
- Cost: a discussion requested while the voice list is unreachable carries no names and is written with the generic pair; a name pool is a small list, so two voices can share a name across episodes.
- Rejected: asking the owner to type the names (a second thing to keep in step with the voice); naming from the browser (a request could carry any text into the prompt).

## D85: The player's chapters are timed and play their story, a discussion without stored names is named from its voices, and one length rule runs through the app

- Date: 2026-10-12
- Decision:
  - An episode's Chapters tab lists its stories timed from its turns (`turnStorySpans`); a chapter is a button that starts that story, and previous and next step between story starts ("Previous story", "Next story"), narrated or not. A chapter with no place in the audio is a plain row. The lone section heading above an episode's chapters is gone.
  - A discussion made before names were stored is named in the transcript only when its script says Ada and Leo itself. Otherwise no name shows until `/api/voices` has loaded (once per page, `player/core/hostVoices.ts`), then `hostNamesFor` names the hosts from the episode's own voice ids, or the defaults; if the list cannot be fetched the pair is the neutral Alex and Sam. A stored name always wins.
  - One length rule: the chip, the floating Play, the bar and the page caption round the time and the length the same way (to the nearest minute, so 130 s reads "2 min" and "2 min left") and use the real duration once the recording's is known. The line under the title says the format's own word (Readout, Discussion), as the Library does.
  - On a wide screen with a mouse, Play sits between the two skips under the art, and the bar has a visible open and close button (a chevron). The timeline shows the time under the pointer on hover. The cover's slot grows from 100rem.
- Why: the owner said Ada does not work with a male voice, and the one real discussion (ep-20261008-1155) still said Ada and Leo although its script never does; its chapters tab was empty; one episode showed three lengths at once (the chip said "3 min left" a second in, the bar "2 min" and the page "-2:10", because the remaining time rounded up and the total to the nearest minute, and before play the chip quoted an estimate of 5 min); the player called a readout "Episode" where the Library says "Readout"; and the way to close the player was hidden until a key was pressed.
- Cost: a legacy discussion's transcript shows no names for the moment the voice list takes; the format labels moved to `lib/formatLabels.ts` so the browser does not import `node:fs` through `episodes.ts`; the bar's close button duplicates the keyboard-only "Close the player" pill's name.
- Rejected: keeping Ada and Leo for anything made before D74 (the case the owner reported); naming from the browser's own guess (a request or a stored script could carry any text into the page).
- Amends: D74, for episodes made before names were stored.

## D105: Listen while it is written; mobile sounds; word light; sticky switch

- Date: 2026-10-13 (owner: "start playing as soon as something is playable", transcript lag, sticky tabs, no sounds on mobile)
- Decision:
  - podcast.yml made no audio already (the site narrates on Play, D82); the wait was the writer (about 60 s) and Vercel's deploy (about 33 s). The engine now allocates the episode id first, writes a short opening (`writeOpening`, 4 to 6 turns) before the full script, and copies the turns to Blob (`streams/run-<run_id>.json` and `streams/<episode-id>.json`: writing, done or failed; pruned after a day). `GET /api/stream?run=` answers the copy, or `{ status: "waiting" }` (a 200, so polling logs no console error). The run card offers Listen now once turns exist; the player narrates them through `/api/narrate` and waits at the last turn while more is coming. Expected first turn about 35 to 45 s after the request (estimate, not measured live). The page does not switch itself to the committed episode; the Open link appears as before.
  - Sounds: `unlock()` sets `navigator.audioSession.type = "playback"` (the iOS silent switch muted Web Audio) and the unlock listens to click and pointerup as well (pointerdown is no activation on iOS). The first tap may stay silent while the engine loads.
  - The spoken word's fill appears at once (it faded in over 100 ms) and the light reads 90 ms ahead of the element clock (`spokenWordIndex`). The Stories / Transcript switch sticks to the top of the open player below 64rem.
- Why: the owner's list. Pnpm and the faster-writer option were weighed; the owner chose the Blob stream.

## D107: The highlight pauses during words the page does not show

- Date: 2026-10-14 (owner: "the text highlight hops on to the next section causing a mismatch"; #98)
- Decision: a story's narration segment opens with the host's unseen words (a section announcement, the link between stories). The build gives each story of a briefing the exact number of those words (`lead_words`, page data only, from `leadInWords` in the engine's `spokenSegments.ts`). The marks are shifted by that count, the estimate gives the lead-in its share of the segment's time, and a story becomes current at its first own word (`spokenPosition`): during a lead-in the story before stays put and no word is lit, and nothing is lit during the sign-off. An episode's turn is its text alone and is unchanged.
- Why: the page treated the segment's start as the story's start and applied marks that index the whole segment to the story's words from zero.
- Rejected: showing the host's words as muted lines (the owner asked for a pause), and inferring the lead-in's length from the marks (the first attempt: a guess with a cap, and no help before marks arrive).

## D128: episodes are pre-narrated

- Date: 2026-10-21
- Decision: `dispatch publish` also narrates recent `Podcasts/` episodes that lack stored turns (`packages/engine/src/publish/publishEpisodes.ts`). Segments are named `audio/<ep-id>/seg/t<idx>.<sha256(voice\nmodel\ntext)[:12]>.mp3` with a `.marks.json` beside each; the naming is shared by `audio/segmentStore.ts` and `core/episodeScript.ts`. `podcast.yml` calls `audio.yml` after an episode commit (a workflow change, shipped in a separate PR the owner merges by hand). It counts against the monthly Speechify budget, not the site's three a day. Briefings were already pre-narrated by `audio.yml` after each run.
- Why: Download and offline Play need every turn stored; a first Play should not wait on synthesis.
- Check: engine unit tests for the naming and the skip of stored turns. Owner action: set the GitHub variable `SPEECHIFY_VOICE_ID_B` to match Vercel if Vercel sets it, or the hash differs and the page narrates again.

## D198: narration ships as Opus in MP4 with the MP3 kept as fallback

- Date: 2026-10-26 (#339, #357, #361, #381).
- Decision: a briefing's narration and an episode's turns also publish one Opus-in-MP4 file (`m4a_url`, mono 32 kbps); the player picks it per browser and falls back to the MP3 on an error or a stall. WebM is not published. A failed transcode skips the Opus copy and the MP3 plays alone. The audio, podcast and ci workflows install ffmpeg (the runner image has no libopus). An episode's turn offsets are measured by decoding, not by ffprobe's duration, which counts MP3 padding on ffmpeg 6.
- Why: about a third of the bytes for speech at the same quality.
- Revisit if: an iPhone fails to play the Opus file; the backfilled MP3s stay until the owner plays one there.
