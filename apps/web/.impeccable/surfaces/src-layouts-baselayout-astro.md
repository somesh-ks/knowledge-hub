---
version: 1
slug: "src-layouts-baselayout-astro"
primary_target: "src/layouts/BaseLayout.astro"
related_targets: ["src/pages/index.astro","src/pages/d/[id].astro","src/pages/archive.astro","src/player/PlayerRoot.tsx"]
---

# Surface brief: the reader (shell, briefing, archive, player)

## Scope and mode

Every reader-facing screen of the web app: the shell, today's briefing, a dated briefing, the archive, settings, the docked player and its full page. Mode: Read for the briefing and archive, Operate for the player and settings.

## Audience and job

A reader on a phone, one hand, three minutes to scan or eight to listen. They must understand each story without background, play from any story, and reach any source in one tap. Not only the owner: no owner-only dead end on a main path.

## Content and constraints

Real briefings of 8 to 23 stories in up to seven sections; three or four sentences per story; one recording per briefing with a start time per story. Self-hosted assets only. First-load JavaScript under 100 KB. WCAG 2.2 AA.

## Direction contract

THESIS: A briefing is a show and each story is a chapter you can read or play. The surface refuses both the editorial timeline with serif body it had before and the news-site grid of cards.

OWN-WORLD: Flat white or near-black surfaces with no cards. Full-bleed one-pixel hairlines between rows. One blue accent on every interactive element, green only for done. Google Sans Flex at two weights. Material Symbols, outlined. The outlined pill play chip with a ringed glyph is the single signature component. Square covers with small radius.

STORY: The reader sees today's briefing, follows each story in four sentences, plays from any story, and opens a source in one tap.

FIRST VIEWPORT: Phone, 390 wide. Top app bar with the centred wordmark. Briefing header: an 88 pixel cover, the date as a 28 pixel regular title, one meta line, then the play chip and share. Sticky section tabs. The first story row starts above the fold. Once audio has started, a docked player bar sits on a three-tab bottom navigation.

SIGNATURE INTERACTION: The docked bar grows into a full page under the finger, the cover and title travelling with it, interruptible at any point.

FORM: The category standard, played straight: Google Podcasts' language with YouTube Music's expanding player. Pinned by the owner in words (the standing exit), so there was no roll and there is no seed key. Build path is code-led; no image generation is available in this session, and the Mobbin reference screens are the critique reference.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Open decisions

- Who may trigger a first narration once readers other than the owner exist.
- Whether back-button dismissal of the player ships (it depends on WebKit behaviour).
