---
name: grill-me
description: "Conduct a relentless interactive interview to stress-test requirements, edge cases, and architectural decisions."


---
Execute an interactive alignment interview that uncovers hidden assumptions, resolves trade-offs, and gates execution behind explicit mutual agreement.

## Operating Rules
1. **Explore First:** Check existing files, `USER.md`, and project documentation before asking questions. Do not interrogate the user for facts already present in the workspace.
2. **State the Tree:** Announce the 2 to 4 key decision branches upfront before asking the first question.
3. **One Question at a Time:** Use `ask_question` with clear options and a `(Recommended)` path.
4. **Mandatory Final Airlock:** Always end the grilling session with a final check asking if the user has additional details or clarifications. Provide a 1-click "(Recommended) All set, proceed" option alongside the open text box. On complex builds, offer `/goal` as an autonomous execution path.
5. **Synthesize:** Present a concise summary of agreed decisions before beginning execution or creating artifacts.
