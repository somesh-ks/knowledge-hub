# 2026-10-07: why the Play button is disabled

## Question

The reader's Play button was disabled and no audio existed. Was it a web bug?

## Findings

- Not a web bug. The first digest was committed with `audio: null`, and the reader shows "Audio is still being prepared" for that case (`audioModeOf` in `apps/web/src/lib/digests.ts`).
- `audio.yml` had never run. The first run (manual dispatch) failed at `vercel link` with "User not found (404)": the `VERCEL_TOKEN` secret was rejected.
- Tests, typecheck and lint were green, because nothing exercised the live Vercel, Speechify or Blob path.
- `dispatch doctor --online` reported the Speechify voice `geffen_32` as missing. That was a false failure: `GET /v1/voices` is cursor-paged (50 by default, 200 at most) and the check read only page one.

## Changes

- `doctor` checks `VERCEL_TOKEN` offline (set) and online (`GET /v2/user`), so a bad token shows before a workflow fails.
- `doctor` follows `next_cursor` through the voice catalogue.
- New `dispatch voices` command lists voices for a locale that work with `simba-3.2`, paging through the catalogue.

## Open

- The owner replaces `VERCEL_TOKEN` and reruns `audio.yml`. See [state.md](../state.md).
