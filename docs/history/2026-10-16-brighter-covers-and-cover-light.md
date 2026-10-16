# Brighter covers, a light read from the cover, a clean theme switch

2026-10-16. Over a dark Library grid the owner said the covers were too dull in both themes, the header light should be natural, round, moving and always in the cover's colours, and switching the theme glitched (D122).

- The glitch, seen in a CDP screencast of a switch on Library: the other theme's cover images are lazy and `display: none`, so they had never been fetched and showed as empty boxes after the fade; the app bar and navigation, each its own view-transition group, turned dark at 100 ms while the page took 200 ms, so for a frame they sat as dark boxes on a light page and the floating button vanished. `changeTheme` now decodes the covers on screen first and marks the root with `data-theme-change`, which takes the bars' group names away for the fade.
- The light: `coverSwatches` renders the cover at 64 px and counts its flat colours. The first cut loaded no fonts, and a cover whose art is a big red-shadowed numeral read as bare paper; the fonts are loaded and a test keeps it. Reading costs about 8 ms per theme per page at build.
- The covers: paper a step lighter per series and theme, dark-theme chroma back to full, and the progress scrim cut to the bottom quarter. The series keep their order and spacing.
- Not verified: the light on a real GPU (the browser suites run SwiftShader, which the page declines; screenshots were taken with the renderer name faked), and the switch on a slow network beyond the 400 ms wait, where a cover still fills in late.
