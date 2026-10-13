# 2026-10-13: regenerate and delete a briefing

The owner asked that every kind of podcast can be shared, regenerated and deleted. Episodes could; a briefing had Share, and the latest one a Regenerate that published a second digest. D104 records the change: `--replace` and `--delete` in the engine, `replace` and `delete` inputs on run.yml, the same two in /api/generate, and one More menu on every briefing page. The seen list is the trap: a replacement over the same window finds nothing unless the old digest's stories are freed first, so the gate frees them and a test pins it (red without it).
