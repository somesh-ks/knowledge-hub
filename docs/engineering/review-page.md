# Review pages

How a thread shows the owner a visual change. One page per PR, built from `scripts/reviewPage/`, published as an Artifact and updated in place for each new version. The owner found the old stills pages hard to use: every version stacked on one page, loose grouping, and no way to comment on a picture (2026-11-03).

## The rule

- **One artifact per PR.** A new version republishes to the same URL (keep it in `artifact_url` in `review.json`). Never start a second page for the same PR, and never put two PRs on one page.
- **Only the current version's stills.** Earlier versions are one line each in `history`. A still that did not change keeps its `id` and its `new_in`, so its comments stay on it and it reads "Same since vN".
- **The top says what to look at.** `new` lists what changed since the last version, and `check` lists what the owner should check, in his words, each item pointing at still ids.
- **Group stills by change, never by device.** Each change gets a title and one line. The page numbers the stills in page order, and the filters (theme, device, mood, hue) come from the tags.
- **Full-length stills of every page and sub-page** the change touches: phone and desktop, light and dark, Firefox (see the owner's stills rule in project memory). A clip is a still with `"kind": "clip"`: an animated WebP, or an MP4 or WebM.
- **Comments come back by themselves.** The page declares `comments` with custom anchors. A comment the owner drops on a still is a thread named `<still id>@<x>,<y>` in percent, so it stays on its spot at any size. Send to Claude wakes the session that published the page, which reads it with `ArtifactComments` and replies, fixes or resolves it there. Where comments are off, the page keeps numbered notes and a Copy notes button.

## Steps

1. Put the stills and a `review.json` in `/mnt/project-files/reviews/pr-<n>/` (not in git; stills are per PR and heavy). Start from the example below.
2. `node scripts/reviewPage/build.mjs /mnt/project-files/reviews/pr-<n>` writes `index.html` and prints the publish call.
3. Publish with the Artifact tool: `file_path` the built `index.html`, `root` the folder, `files` as printed, `capabilities: {comments: {customAnchors: true}}`, and `icon: "review"` on the first publish. On a later version pass `url` (read the artifact first if another session published it) and leave `capabilities` out.
4. Post the link once, saying the version and what to check. On a comment wake, read the thread, act, reply and resolve.

## review.json

```json
{
  "pr": 635,
  "pr_url": "https://github.com/somesh-ks/knowledge-hub/pull/635",
  "short_title": "Up next review",
  "title": "Up next: drag the playing row, Suggested stays, clocks read forward",
  "area": "Queue and player",
  "status": "ready",
  "version": 2,
  "updated": "2026-11-03T14:00:00Z",
  "new": ["Suggested stays after you tap + and refills."],
  "check": [{ "text": "Tap + on a suggestion. Suggested should still be there.", "stills": ["suggested.phone-light"] }],
  "changes": [
    {
      "id": "suggested",
      "title": "Suggested stays after an add",
      "what": "Before, Suggested vanished after one +.",
      "stills": [
        { "id": "suggested.phone-light", "file": "stills/suggested-phone-light.webp", "caption": "After tapping + on a suggestion.", "tags": { "device": "Phone", "browser": "Chrome", "theme": "Light" }, "new_in": 2 }
      ]
    }
  ],
  "history": [{ "version": 1, "date": "3 Nov", "summary": "Drag the playing row; clocks read forward." }],
  "artifact_url": "https://claude.ai/artifact/..."
}
```

`status` is `ready` or `changes`. Tags are `device`, `browser`, `theme`, `mood`, `hue` and `state` (Before or After). Still ids are lowercase letters, digits, dots and dashes; keep them stable across versions. `new_in` defaults to the current version. The builder checks every field and file.

## Why it is built this way

- The builder inlines the app's tokens, font, icons and the Button, Badge, Banner and Icon rules from `apps/web/src`, so the page looks like the app and follows the design system as it changes. The template's own rules read semantic tokens only.
- Stills are files published beside the page, not `data:` URIs, so the page stays near 200 KB and a session that reads it back does not pull megabytes of base64.
- Pins at a point on the picture, threads that can be resolved, and pins that survive a new version are what screenshot-review tools share (Figma comments, Pinhub). Percent positions keep a pin on its spot at any width and in the zoom viewer.
- Agentation (the dev toolbar in `npm run dev`) annotates the live app on a desktop browser. It does not run on phones or on pictures, so it is the tool for reviewing the running app, not stills.
