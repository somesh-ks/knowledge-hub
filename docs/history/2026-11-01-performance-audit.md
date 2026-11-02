# 2026-11-01: performance audit

Somesh asked why the app takes a second or two to open on his phone and then shows everything at once, and whether it should draw the frame first and stream the content in. The audit covered load, bundle, caching and the service worker, data, rendering, images, fonts and Vercel cost. The report is at https://claude.ai/artifact/JptgEnhqCuHD3vH9L2Fgca.

## What it found

- The content is already in the HTML, so a skeleton would add a second paint and a layout shift. "All at once" is the first paint waiting on the HTML and its render-blocking stylesheets.
- The wait was the trip: in 7 days, 43% of his page loads missed the Stockholm edge and ran the function in Washington, often cold.
- Production never had the first-load work: skew protection's `?dpl=` query hid every import from the preload step and `checkBundle`, and linked player.css twice (D316).
- Every page loaded sharp and the Blob SDK at a cold start, though only covers encode and pages read the store by fetch.
- Vercel cost is builds (8 CPU minutes a web deploy); functions cost cents.

## What this change did (#574)

Skew protection off and a build check that keeps it off (D316). Pages stay at the edge for 30 days and are deleted by tag when the content changes, from `content.yml` after a sync and from `/api/podcast` on a delete (D318). sharp and the SDK load only where used: the home page's modules import in about 104 ms instead of 270 ms. CSP reports raised by extensions are dropped.

## Declined or later

Streaming the head saves about 30 ms and moves the preload links into the body: declined. Opening the installed app from the service worker's copy repeats the 21 Oct stale-layout problem: declined. The function region moves to Europe after Neon does (D304). The musl copies of sharp and resvg (about 23 MB of 58 MB) can be excluded from the function.
