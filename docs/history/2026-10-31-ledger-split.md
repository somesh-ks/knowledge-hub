# 2026-10-31: the design ledger split by surface, the Index made grep-only (D283)

A context audit of a session found three reads that most tasks did not need: the 116 KB design ledger (UI work was told to read it first), the 27 KB decisions Index (counted as read-first), and the state.md items nobody had touched for weeks. The owner asked for progressive disclosure: an agent reads what it needs when it needs it.

What moved, word for word (a script check found no line missing; only the intro and the surface headings were reworded):

- `docs/design-engineering-ledger.md` is the core: sections 1 (taste), 2 (how to work), 4 (reversals), 11 (the phone), a table of the surface files and the upkeep rule. About 20 KB.
- `docs/ledger/<surface>.md`: the nine surfaces of section 3, one file each (5 to 23 KB).
- `docs/ledger/code.md`: sections 5 to 8 (hacks and mechanisms, what the code does well, gaps, owner asks with no record of being done).
- `docs/ledger/ideas.md`: sections 9 and 10 (dreams, the skill enrichment queue). Not rules; read when planning.

Section numbers are kept, so "ledger section 8" in a decision still points somewhere. The read-first budget is now AGENTS.md and state.md (20 KB); the Index has a cap of its own (40 KB) and is searched with grep. UI work reads about 20 KB of core plus one surface instead of 116 KB.

Not done: the stale parts of the ledger (its 2026-10-14 sources list, the "checked against main at 8549f27" line) are history and stay. Deleting any row needs the owner, because the rows hold his reasons.
