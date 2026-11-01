# 2026-11-01: the episode column and its contents list (D287)

The owner found the desktop episode page not optically centred: the column sat on the pane's middle, but the contents list hung off its right, so the pair read as right of centre.

- Measured first: the column was exactly centred in the pane (D229), so the fix was not a bug in the maths. The group of column and list was what sat right.
- Options laid over the real build at 1280 and 1920, light and dark, in `/mnt/project-files/episode-center/`: the column alone on the window (rejected, breaks the Library's left edge), the group on the pane (shipped). The owner approved the stills.
- What shipped: `shell.css` gives a page with a contents list four tracks, the width of `--column-wide`, and a wider step to the list. `designSystem.spec.ts` "same room on both sides" now measures the column and its list as one content box; it fails on the old rule and passes on the new.
- Trade-off recorded: Latest's column sits further left than Settings' column.
