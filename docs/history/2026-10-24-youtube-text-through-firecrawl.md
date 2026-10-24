# YouTube text through Firecrawl

The owner asked for yt-dlp to make YouTube transcript extraction reliable, then for workarounds that make it reliable. [D165](../decisions.md#d165-youtube-captions-come-through-firecrawl-when-youtube-refuses-the-runner) records the outcome; this note keeps the evidence.

## What was measured

- From this sandbox, a datacenter address like GitHub's runners: yt-dlp 2026.10.21 against a public video got HTTP 429 on the watch page and "Sign in to confirm you're not a bot" from the player with the default, `tv`, `mweb` and `web_embedded` clients. The engine's own InnerTube call (`extract/youtubeText.ts`) fails the same way, which is why no live run has recorded captions.
- yt-dlp's maintainers, on the same error (#15865, February 2026): change the address or pass cookies; a PO-token provider does not help once that message appears.
- Firecrawl's Alexandria catalogue lists `youtube-com/videos/video_transcript` (5 credits; InnerTube ANDROID player, then timedtext json3, the path our code takes) and it answered a live call with the full transcript.

## What was built

`fetchTranscriptViaFirecrawl` in `extract/youtubeText.ts`, between the free youtube.com read and the Gemini transcription: one scrape request a video through `FirecrawlGuard.relay` (so the run's ceiling and rate-limit stop apply and a repeated video is free), credits into the ledger under firecrawl/alexandria, English when the video has it. Wired in `curate/apiRuntime.ts` behind `FIRECRAWL_API_KEY`. One test blocks youtube.com with a 429 and shows the captions arriving through Firecrawl, the budget spent after one video, and Gemini taking the next.

## Not built

yt-dlp with a throwaway account's cookies, the next step if Firecrawl's provider ever goes (D165 says why not first).
