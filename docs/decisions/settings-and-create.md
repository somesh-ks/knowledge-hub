# Decisions: settings and create

Settings (topics, sources, models, schedule, saving) and the Create form. Rules and the Index are in [README.md](README.md).

## D20: One preferences key for theme and settings

- Date: 2026-10-06
- Status: Confirmed
- Decision: Theme, interface sounds, volume and playback speed are one JSON object under the `localStorage` key `dispatch:preferences`. The inline theme script that runs before first paint reads the same key.
- Reason: One key means the pre-paint script and the settings store cannot drift apart.
- Rejected: A separate key for the theme and another for the other settings (two sources of truth for what the pre-paint script reads). A cookie (the site is static and nothing on the server reads it).

## D49: One Podcast settings page: Daily, Weekly and Custom profiles, a shared writer, topics and sources clubbed

- Date: 2026-10-10
- Decision: Settings has one "Podcast" row. `/settings/podcast` holds one configuration with three profiles (Daily: hour and cadence; Weekly: day and hour; Custom: the Create panel's defaults), each with a Type (Readout or Discussion), a Length and Voices (Ada, and Leo for a Discussion), and one shared Model (a vendor select, Nebius or Anthropic, then a model combobox). Topics and sources are one tab, `/settings/podcast/topics`: each topic has a weight (a hint; the model still decides per run) and its sources with a 0 to 5 quality score, and an Add source panel previews a URL (name, icon, feed, score) before it is added. Headlines is not offered for new requests.
- Why: the owner called Settings "a mess" and asked for one podcast configuration, a clubbed topics and sources view with a rating per source, a discoverable Add source, and a voice choice for Daily, Weekly and manual episodes.
- Cost: the daily Type is saved but the audio workflow does not apply it (a workflow change); a weekly run at its own hour needs a `RUN_CRON_WEEKLY` variable in `run.yml`; `/api/source-preview`, `/api/site-icon` and `/api/voices` are open like `/api/models` (SSRF-guarded, cached); the heaviest page has 0.3 KB of budget left.
- Rejected: favicons straight from each host (needs `img-src https:`, loosening the policy; they go through `/api/site-icon`); per-profile models (the owner asked for one vendor and model in general); a quota per topic (the weight is a hint).
- Supersedes: the Schedule and Model pages (D45, D46 placement), the separate Topics and Sources pages.

## D51: Settings is two levels and saves itself; every select opens one drawn list

- Date: 2026-10-10
- Decision: The Settings index lists one row per page, each saying what it holds now: Daily, Weekly, Custom, Topics and Model under Podcast; sounds, the theme and About stay on the index. Each page has one job: `/settings/daily`, `/settings/weekly` and `/settings/custom` hold one profile each (Weekly is one switch while it is off); `/settings/model` the writer; `/settings/topics` lists the topics, each leading to its own page (`/settings/topics/<id>`, and `/settings/topics/other` for sources with no topic) with its switch, its weight and its sources. A page's title carries the way back: "Settings > Daily", the parent muted at the title's own size, so there is no back button, no tab bar and no small line above a title. Changes save themselves (`scripts/autosave.ts`): a change waits until the controls have been still for 1.2 s, then every pending edit goes in one request (up to eight ops); a 429 waits as asked and then sends whatever is pending by then; a removal waits 5 s with Undo in the toast; hiding or leaving the page sends what is waiting. The status is the app's toast: Saving, Saved, or the error with Retry. Every select (Settings, Library, Topics, the Create panel, Add source) opens the model list's drawn list through `appearance: base-select`, set in one place (`primitives.css`); browsers without it keep the native list. The model field reads as a select: the hand cursor at rest, the caret once focused, and a press opens the whole list.
- Why: the owner called the podcast settings complex with too many controls, asked for breadcrumbs instead of the back button, for autosave instead of Save, and for every dropdown to look like the Anthropic model list.
- Cost: topics are one level deeper; a removal takes 5 s to send; there is no Discard (a change is undone by changing it back, a removal by Undo); each save is still a `config.yml` run and a commit, about a minute to show.
- Rejected: saving on every change with no settle (a commit per step, and the server's 10 s cooldown); keeping Save for removals only (two ways of saving); a breadcrumb in small text above the title (the owner's type rule); the score filter and sort on Topics (sources are already split by topic and listed best first); a scripted select for every browser (weight on every page that has one, and `base-select` covers Chromium and Safari 27).
- Supersedes: D49's page layout (one Podcast page with a profile switch and two tabs). Its data model (profiles, one shared writer, topics with weights and scored sources) stands.

## D56: One panel adds a topic or a source and edits a source; Settings has no Custom page

- Date: 2026-10-11
- Decision: Settings' Topics row and page are "Topics & Sources". The page has one outline button, Add ("Add a topic or a source"), that opens one panel (a full-screen sheet on a phone, a side panel from 40rem) with a Topic / Source segmented control under its title.
  - Topic has two steps: the name, what should count and keywords; then up to six catalogue sources whose tags meet its words, leaving out sites already among the sources, each a row to tick. "Add topic and 2 sources" sends one request: `topic.upsert`, then a `source.add` per ticked source with the new topic's id.
  - Source takes an address, looks it up after a 400 ms pause (at once on paste or Enter) and files it under the chosen topic. A topic's own page keeps an outline Add source button that opens the panel on Source with that topic chosen.
  - A source's tile and name are one button that opens the panel to edit it: its name, its topic (one select; Other sends an empty list), a link to its address, and the parts of its score. A new name shows at once; a move says "Moves to X after the next build." Both go as `source.update` (id, name, topic_ids): a seed source keeps the change in its override, an added source is changed in place. A move takes effect in a run: when an override sets a source's topics they decide its category hint, which prefilter and dedupe read (the first built-in category among them; none when they name only custom topics or none). Removing a custom topic strips it from every override; a source left with no topic there goes back to its own topics and hint.
  - Each row has an Open in a new tab button beside its score. A site with no icon shows the first letter of its name in its tile; the site's icon covers the letter once it loads.
  - `/settings/custom` is gone and redirects to `/create`: an episode on request is set up in the Create panel, which still starts from `custom` in `config/schedule.json`.
- Why: the owner asked to add a topic and a source in the same sidebar and sheet, separated by a segmented selector; for good sources as the next step of adding a topic, picked and added at once; to edit existing sources and open their address; for an outline Add source button; for the menu to read Topics & Sources; and said the Custom settings repeat what the Create panel already covers.
- Cost: Create's starting type, length and voices can now be changed only in `config/schedule.json`. A rename or a move shows in its final place after the next build. The panel files a source under one topic, so moving a source that feeds several replaces them with the one chosen.
- Rejected: separate Add topic and Add source buttons (two ways in to one job); the inline Add topic form (no room for the suggestions step); editing the address (a different address is a different source: remove it and add the new one); "Accuracy" as the name of a score part (D55).
- Supersedes: D51's Custom page and its row; D49's Add source panel and the inline add-topic form.

## D57: A topic's page edits its details and adds the sources that suit it; topics are listed by name

- Date: 2026-10-11
- Decision: A topic's page has an Edit topic row that opens the Topics & Sources panel on the topic's details, filled in. A topic the owner made can change its name, what counts and its keywords; one that ships with the app shows its name and what counts read-only and can change its keywords, since the engine keeps a shipped topic's judge question. The second step offers the catalogue sources that suit the topic and are not among its sources yet. Save sends `topic.upsert` with the new details and the switch's current state, then a `source.add` per ticked source, as one request, and the switch's own op takes the new details so a later toggle never brings back the old ones. A renamed custom topic's own section takes the new name, unless its title was set apart. The Topics list and the panel's topic choices are always by name; Other comes last, and a topic that never publishes sorts in with the rest.
- Why: the owner asked to edit topics and their sources, and to always see the topics in alphabetical order. The add flow's two steps are reused, so there is one way of working, and an existing topic gets the same instant add of suitable sources as a new one.
- Cost: a pure rename takes Next and then Save. The new name shows in the list after the next build.
- Rejected: editing a shipped topic's name or what counts (it would change how the topic is judged, and the engine refuses it); suggestions shown on the topic page itself (weight on every load for a choice made rarely); keeping never-publishing topics last (the owner asked for alphabetical, always).

## D58: The Model page offers six top Nebius writers by name, live list or not

- Date: 2026-10-11
- Decision: With Nebius as the provider, the Model list opens with a "Top models" group of six curated writers, best first (`NEBIUS_TOP` in `lib/modelId.ts`): GLM-5.3, Kimi K3, Kimi K2.6, DeepSeek V4 Pro 0813, DeepSeek V4.1 Flash and Qwen3.5 397B. Each is a Token Factory routing key checked on 2026-10-11, ordered by EQ-Bench's longform writing score that day. When the live list (`GET /api/models`) loads, only curated ids it serves show, so a retired one drops out, and the ranked shortlist (`modelRank.ts`) stands in if none is left; "All models" follows. Without the live list all six show, and the typed id field stays for anything else. A pick saves through `writer.set` like any other.
- Why: the owner asked to pick top models from Nebius. Without a provider key on Vercel the page offered only Automatic and a typed id, so no model could be picked by name.
- Cost: a named list goes stale, as Qwen3-32B did when it left the serverless tier on 2026-08-31; refresh it when Nebius's catalogue or the writing leaderboard moves. Kimi K3 costs about four times the others per token.
- Rejected: Llama (no longer a public endpoint on Nebius); gpt-oss-120b (the lowest writing score of the candidates, 35.8).

## D62: Daily and Weekly each choose their topics; voice samples play through the site

- Date: 2026-10-11
- Decision: The Daily and Weekly settings pages each have a Topics row: one chip per section with a topic that is on and may publish, by name, all ticked by default. All ticked is stored as null (every topic, including ones added later); fewer is the list of section ids; the last ticked chip cannot be unticked; Top picks is always covered. The weekly profile gains `weekly.sections` in `config/schedule.json` (null by default), validated by `schedule.set` as the daily list is, and the weekly pass is narrowed by it in every mode (it used to cover every section). Voice samples play through `GET /api/voice-sample?voice=<id>`, which fetches only a sample in the cached Speechify list, caps it at 2 MB and answers byte ranges; `/api/voices` also names the voices Default stands for. Choosing a voice plays its sample, and a Sample chip (the app's play chip) plays it again or stops it.
- Why: the owner asked to choose topics in Daily and Weekly and to preview voices in an intuitive way. The old play button pointed at Speechify's own host, which the page's `media-src` blocks, so in production a press failed and the button hid itself.
- Cost: one function call per sample played (cached at the CDN for a week). A topic added after a narrower list was saved is not in that list until it is ticked. A section left in the file after its topic is removed is ignored, as before.
- Rejected: adding Speechify's host to `media-src` (the host is not documented and can change); a custom voice list with a play button per row (a native select cannot hold buttons, and the drawn list is shared by every select).

## D63: Daily and Weekly leave out topics, one chip per topic, stored as the topics left out

- Date: 2026-10-11
- Decision: The Topics row on Daily and Weekly has one chip per topic (every topic that is on and may publish, by name), not per section. `config/schedule.json` stores `skip_topics` at the top for the daily briefing and in `weekly` for the weekly one: the topics left out, empty by default. `sections` and `weekly.sections` are gone; an older file's `sections` (always null in use) is dropped on read. Selection drops a story whose winning topic is left out, so it reaches Top picks neither. Removing a topic takes it out of both lists. The last ticked chip cannot be unticked. Custom has no setting: the Create panel picks topics per episode.
- Why: the owner asked how to add or remove a topic from the daily and weekly podcasts, and wanted the simplest intuitive answer. D62's chips were sections, so "Design Engineering" stood for five topics and none could be left out alone. Storing what is left out, not what is in, means a topic added later is in both podcasts without anyone remembering to tick it.
- Cost: the chips can run to a dozen names. A story that fits two topics follows its winning one.
- Rejected: a scope dropdown per topic (Daily, Weekly, Custom, All): Custom is chosen per episode and "none" repeats the topic's own switch, so two booleans hidden in a menu; switches on each topic page as well (two places for one setting); keeping sections (coarser than the topics the owner names).
- Supersedes: D62's section-based Topics row and `weekly.sections`, and D45's `sections`.

## D64: Every topic can be renamed; what counts edits wherever the judge reads it

- Date: 2026-10-11
- Decision: Edit topic takes a new name on every topic. What counts (the description) edits on a custom topic and on the two that ship with the app (Design, Trending), whose fit question is built from name and description; on a built-in category it stays read-only, with a note that the app judges it by questions of its own. `topic.upsert` sets name, weight and keywords on a built-in topic and name, description, weight, keywords and the switch on an app topic; sections, depth and flags stay the code's. Rewording an app topic re-judges that topic alone on the next run (its question's hash changes); a built-in topic's name is never read by the judge.
- Why: the owner reported that Edit topic would not let them edit text. Every topic they have ships with the app (11 built-in, Design and Trending), so D57 left them only keywords. D57's reason, keeping the judge question, holds for a built-in category's description and for nothing else.
- Cost: an app topic reworded by mistake re-judges its stories once. A built-in topic's description cannot say what the owner means by it; changing that would need its fixed questions rewritten.
- Rejected: letting a built-in description edit (it would read as changing what counts and change nothing); keeping shipped topics read-only (the owner's whole list).
- Supersedes: D57's read-only name and what counts on shipped topics.

## D69: Design, AI and Technology gather the judge topics; one alphabetical list where each topic sets its scope; every source filed under a topic

- Date: 2026-10-11
- Decision: Topics & Sources is one alphabetical list: the owner's three topics, each of the owner's own topics, and the five general topics, with Other last. Design gathers the judge topics of the `design` and `ui-craft` sections, AI those of `ai`, Technology those of `tech` (`core/topicGroups.ts`). A judge topic keeps its question and weight but has no page of its own. A group's page lists their sources and a weight slider for each judge topic (Technology, which gathers one, shows a plain Weight row), and Add source files a new source under the group's home topic.
  - Scope: each topic page has a Scope multi-select (Daily, Weekly, Custom), and Add topic sets it in the same request. Scope is a `topic.scope` op that edits the skip lists in place (`skip_topics`, `weekly.skip_topics`, new `custom.skip_topics`), so a stale page cannot bring back a topic another page left out. Create hides the chip of a topic left out of Custom. A general topic plays in custom episodes only: Custom is its on switch, and Daily and Weekly are disabled. Daily and Weekly link to Topics & Sources instead of listing chips. Trending is off, and the old category pages redirect to the topic that took them.
  - Rows: a source's name links to its site in a new tab, and the open icon is gone. The checkbox is a new primitive (`.suggest-box`).
  - Filing: every source sits under a topic except Exa discovery, whose searches carry their own.
    - Lobsters and daily.dev go with developer tool launches.
    - Brutalist Report and TechCrunch go with Technology, capped at six candidates each.
    - The three daily AI roundups move under AI, switched off.
    - The seven Trending outlets go under World. France 24 is on. The other top-stories feeds are off where the outlet has a World desk, since they would mostly repeat it.
  - New sources: 21, each feed fetched live through Firecrawl on 2026-10-11.
    - General desks from CBS, Sky, PBS, BBC and The Guardian, so each general topic has five or more outlets.
    - Techmeme for Technology.
    - Latent Space, The Decoder and Google AI for AI.
    - Bram.us, Piccalilli, Ahmad Shadeed, Brad Frost, Dave Rupert, Adactio and WebKit for Design.
    - The eleven of these that came from the catalogue left it, which now holds 32 entries.
- Why: the owner asked for the following.
  - Design, AI and Technology as their topics, "to keep things lean".
  - One list with no separation.
  - Scope set inside a topic and when one is created, as a multi-select.
  - Names as links and a better checkbox.
  - To "fill up the existing sources and new sources into the current topic cluster".
- Cost:
  - A group cannot be renamed, and what it counts cannot be edited, since each judge topic keeps its fixed question.
  - General topics cannot play in Daily or Weekly yet.
  - The new general desks add about ten feeds that Jev judges every run, within `GENERAL_JUDGE_CEILING`.
  - Import keeps an existing source's on/off flag and options, so the off flags and the removed pool caps were written into `config/sources.json` after the import.
- Rejected:
  - One weight per group: it would flatten the curated differences between its judge topics.
  - Filing Exa under one topic: ten of its twelve searches have none.
  - Re-hinting the AI roundups and leaving them on: they would bring a day's hype into the pool.

## D71: Streamlined add topic modal, live suggested sources with TypeSafe Jev scores, schedule timezone and topic scope indicator chips

- Date: 2026-10-11
- Decision: Add topic modal drops the keywords input and intermediate source selection step; creating a topic saves it immediately and opens its detail page. Each topic detail page features a suggested sources section with 5 curated sources scored by TypeSafe Jev. Daily and Weekly settings display read-only topic scope indicator chips with a Configure button linking to Topics & Sources. The When row includes a curated timezone selector persisted in config/schedule.json.
- Why: Removes friction when creating topics, keeps topic pages lively with suggested sources, clarifies topic scope in podcast settings, and accommodates global user timezones.
- Cost: Minor increase in client-side fetch requests for suggested sources.
- Rejected: Heavy multi-step creation wizards; hardcoded UTC or local-only timezone detection without explicit user control.

## D79: A saved setting shows before the build, and a new topic stays on its list with its suggestions at once

- Date: 2026-10-12
- Decision: A save reaches the page about a minute later, because the config workflow commits and Vercel rebuilds. For three minutes after a save the browser remembers the saved ops (`dispatch:saved-edits`) and a settings page that opens shows the saved value instead of the stale one built into it, with one line under the title: "Saved. It takes effect after the next update, about a minute." A value that already equals the saved one counts as the rebuild having landed. A new topic stays listed on the Topics list until the build (a static site has no page for it yet); its suggestions appear under its row at once from `/settings/source-catalog.json`, ranked by the same function as the build's (`lib/sourceCatalogMatch.ts`), each with a plus that adds the feed. Inside the server's ten-second gap between saves the page holds the next request quietly and sends everything changed meanwhile in one request. A topic with a name already in use is refused, a queued topic has no Cancel, and the World topic has an honest switch.
- Why: the owner saw settings revert after a save, a new topic had no suggestions for a minute, and a second edit showed "Saving" for ten seconds.
- Cost: the overlay reads only the saved value; if a save never lands (a workflow failure) the page shows the saved value for three minutes and then the old one. A save that waits longer than three minutes behind a briefing outlives the overlay. Leaving the site during the quiet wait loses that edit, as the old 429 wait did.
- Rejected: reading the saved value back from GitHub on every visit (a request on every settings page); a longer overlay (it would hide a failed save for longer).
- Supersedes: D71's "creating a topic opens its detail page".

## D83: Settings shows a source's score as one word, a source's name opens its editor, and the Model default is called Default

- Date: 2026-10-12
- Decision: A source's row shows its score as one word under the host ("host · Good"; Excellent, Good, Fair or Poor, and "Not scored yet" for a new source); the pips and the number are gone. The score is still out of 3 and its parts are in the edit panel (D55). A source's name, and a suggested source's, is plain text: the row opens the editor, and the panel's Address link opens the site. Segmented controls are pills with on-surface labels, and the daily podcast's "Type" is "Format". A topic's summary on the list reads "2 of 3 sources on" or "No sources yet" and carries no weight. The Model page's automatic choice is called "Default" and its row reads "Nebius, Default". A weight reads as a percentage under its label. A topic with a name already in use is refused, a queued topic has no Cancel, the World topic has a switch that is really its on state, and a failed address lookup says so under the field. Panel and sheet headers put Close before the title.
- Why: the second critic found three marks for one score (pips, number and label), a link and a row action fighting over one name, long values pushing a row past the edge of a 360px phone, and a Cancel that cancelled nothing.
- Cost: a source's site is one press further (open its row, then Address); a word hides the difference between 2.1 and 2.6, which the panel's parts show.
- Rejected: keeping the pips beside the word (the same fact twice); a name that links out with a separate edit control (a row with two targets, neither obvious).
- Amends: D55 (the pips and the number) and D69's names as links.

## D89: The time zone selector is withdrawn until the engine counts in a chosen zone; Settings summaries follow what was saved; episodes on request are Episodes

- Date: 2026-10-12
- Decision:
  - The Time zone row is gone from Daily and Weekly, and Time says "Stockholm time". The selector of D71 saved a value that nothing read: the cron route (`slotAt`), the gate (`decideRun`), the Next episode line (`nextRun.ts`), the status report and `run.yml`'s fallback entries all count in Stockholm time, so "New York" with 07:00 still ran at 07:00 in Stockholm, and its labels were wrong for half the year. `config/schedule.json` keeps its `timezone` field and the engine is unchanged. To bring the selector back the engine must count dates and hours in the chosen zone in `stockholmDate` and `stockholmHour` (core), the gate, the cron route and the workflow's schedule; that is a separate change with its own tests.
  - After a save, the index summaries ("Every second day at 09:00", "Nebius, Kimi K3"), the Topics list counts, the Daily and Weekly topic chips (a removed topic's chip is hidden) and the Sunday note follow what was saved for three minutes, as the pages do (D79). The code is lazy: `scripts/settingsSaved.ts` loads only when a saved edit or a pending model exists, and the summary functions live in `lib/settingsSummary.ts`, which the build and the browser share.
  - Episodes made on request are "Episodes" everywhere in Settings (the Library's filter calls them that); a topic that is in all three podcasts reads "All podcasts"; an off topic reads "Off"; the index counts the sources that are on ("9 topics · 9 of 11 sources on"). A general topic's switch reads "Use World".
  - Below 64rem a sub-page's title stands alone (the app bar's arrow leads up); from 64rem the full trail stays. Removing a topic goes back to the Topics list once the removal is saved.
  - Sources and suggestions are one row, 72px with the host on the second line and regular-weight names; the plus is a plain icon button. The second voice is "Discussion voice" and the hints under the voices are gone; a voice without a sample keeps its slot, and on a phone the value takes the second line.
  - The Add panel's Topic | Source switch keeps one height at every width (it grew to 349 to 497px on phones); Add source on a topic page has no Topic switch. The Model list says "No model called ..." when a filter matches nothing, and its default is called Default with no hint.
- Why: the third critic round found a setting that did nothing, summaries that contradicted the pages Back lands on after a save (the "settings revert" the owner reported, on the index), and five spellings of one noun.
- Cost: a source cannot be removed from the app (it is switched off with its checkbox, D69); a wrong feed stays as an unticked row. Left for later: a "Use x" option on the Model page, a message after removing a topic, main-switch styling for the on and off switches, and one field style inside each panel form.
- Rejected: honouring the zone only in the Next episode line (it would promise what the engine does not do); a disabled row with a note (a control that explains itself is the thing the owner called slop).
- Amends: D71 (the selector) and D79 (the overlay reaches the index and the lists).

## D91: Daily and Weekly offer only what a briefing uses, and an edit made inside the server's gap survives leaving the page

- Date: 2026-10-12
- Decision:
  - Daily and Weekly show Time (Day on Weekly), Repeat, Topics, Length and one Voice. The Format segment, the Voices head and the second voice are gone from both pages. A briefing is narrated from its digest as written, so Format was saved and not applied and the second voice was the discussion's; New episode keeps both for episodes. The stored fields (`type`, `voice_id_b`) and the engine are untouched, so nothing migrates and the rows can return when a briefing is built as a discussion.
  - A save that waits out the server's ten second gap now outlives leaving the page. The toast's popover calls threw on a toast the page swap had removed, before the request was sent, so the second of two changes made inside the gap was lost while "Saved" showed. Every toast call is guarded and none can skip the request; the toast says "Saving" as soon as a change waits; leaving the page writes the waiting edits to storage marked `pending` (shown for 90 s at most, dropped when their request fails), so the next page shows them ("Saving. Live in about a minute."); changes made on that next page while the run is still busy are sent after it.
  - Remove topic replaces the removed topic's page in history, and a removed topic's page opened before the build replaces itself with the list.
  - Look: every segmented choice marks its chosen option with a check (Length did not); controls share one width of 22rem on Settings, podcast and topic pages; link rows end at the edge and read like their neighbours (Edit topic ends in a pencil, a new glyph in `tokens/glyphs.json`); a custom topic's single Weight row has Design's shape; a suggested source is a three-line row of 88px from 40rem and says "Added" once; a switched-off general topic's counts and sources read as off (the Topics index counts a source as on only while its topic is on); the Add panel says "All podcasts" when all three are ticked.
  - Round five: a feed address never widens the Add source panel (its form, card and facts are one column that may shrink); the model field has the row's room (16rem from 40rem) and a longer name ends in an ellipsis, not in half a name; a refused suggested source says "Not added. Try again." with its plus back, and pressing it sends the same add once more (`Pending` takes `fail` and `done` hooks); a general topic switched off keeps its sources legible (names quiet, tiles faded) instead of dimming both lists to 1.6:1.
  - Round six: a refused change is marked failed and left out of what the next page shows (it was kept as pending, so a reload showed "Added" for something nothing would send); a queued topic row says "Not added yet. Press Retry."; the sender loads when the browser is idle, while online, so a change made offline reaches a request that fails with "The site could not be reached. Not saved yet." and Retry (a chunk that fails to load once stays failed in the browser, and a retry online made Vite reload the page, losing the change).
- Why: the fourth critic round found that changing two things and pressing Back lost the second edit while the page said Saved ("the settings revert" again), and that Format on Daily was a choice the product ignored, which the owner has called slop.
- Cost: Format and a second voice cannot be set on Daily or Weekly until a briefing can be a discussion (the daily Type item under Not working stands). A pending edit shows for up to 90 s even if its request never goes (a tab closed in the gap).
- Rejected: leaving the Format row with a note (a control that explains itself, D89); keeping the second voice on a Daily that never uses it.
- Amends: D74 (the second voice's place on Daily and Weekly) and D79 (the quiet wait inside the gap no longer loses an edit).

## D100: The time zone selector returns and the schedule counts in the chosen zone; Daily and Weekly offer Format and a second voice again; every voice row keeps its play button

- Date: 2026-10-12
- Decision (the owner asked for all three back):
  - `schedule.timezone` is the schedule's wall clock. The daily hour, the weekly day and hour, the date the gate decides for, the cadence arithmetic, the date part of new digest ids, the cron route's slot, the Next episode line, the Settings summaries and the status report are read in it. Fifteen zones are offered (D71's list, plain city names, no CET or CEST); `schedule.set` refuses any other, and a stored zone outside the list reads as Stockholm. The default is Europe/Stockholm and every Stockholm result is unchanged.
  - Bookkeeping that is not the schedule stays on Stockholm (`TIME_ZONE`): the narration caps and usage month, pruning, source scoring, `learn`, episode file dates and the build date. A few readers that compare a digest's date with today (`sinceLabel`, `pendingAudio`, `podcast/select`) still use Stockholm's today; in a zone far from Stockholm that moves a window edge by a day for some hours a day, and nothing else acts on it.
  - `RUN_CRON` (the fallback schedule, set from Settings) is the Stockholm hour the chosen local hour falls on now. It is exact only until one of the two zones changes its clock; the Vercel cron route asks the zone every hour and is exact. A half-hour zone (India) works with the hourly cron: the route fires when its UTC hour overlaps the slot, so a run may start up to 30 minutes early, and the gate dedupes.
  - Format and Discussion voice are rows under Episode on Daily and Weekly again (saved as `format` and `voice_id_b`). A briefing is still narrated from its digest by one voice (`scheduledVoice` in `server/narrate.ts`), so both take effect only where a discussion is made, not in a briefing's narration. The page does not say so.
  - A voice row's play button is always there: pressable when the chosen voice has a sample, dimmed and labelled "No sample for the ..." when it has none. Hiding it made the Discussion voice look as if it lacked the control.
- Why: the owner asked for the time zone ("I don't know if you have an argument against it"), for the second voice on Daily and Weekly, and for the second voice's play button. D89 withdrew the selector because nothing read `timezone`; the gate, the cron route and the screens read it now, so it is no longer a control that does nothing. D91 withdrew Format and the second voice for the opposite reason, a briefing ignores them, and that is still true; the owner chose to have them, so this records the gap instead of hiding it.
- Cost: Format and the Discussion voice are saved settings a briefing does not use, which is what D91 removed, accepted on request. Making them real is a discussion briefing: a podcast step in `audio.yml` (a workflow change the owner merges by hand), a writer call per briefing and the narration cost. The fallback entries in `run.yml` were not edited (a workflow change), so after a clock change in either zone the fallback hour can be an hour off until Settings saves the schedule again; the cron route stays exact. A half-hour zone starts a run up to 30 minutes early. The fifteen options are server-rendered; the largest first load is still 109.4 KB of 110.
- Rejected: on-demand synthesis of a sample for a voice that has none (it costs per press and needs an abuse cap); editing `run.yml` to follow the zone; every IANA zone (D71's fifteen are enough and keep the tests finite).
- Amends: D71 (the zone list), D89 (the selector returns) and D91 (Format and the second voice return).

## D102: General topics play in Daily and Weekly; a topic is always on and has a summary card; the bar has no chevron; the gate runs in parallel

- Date: 2026-10-13 (the owner's feedback on the pages at 2038x974, and "why is development so slow")
- Decision:
  - The five general news topics can be ticked on Daily and Weekly like any other topic (D69 had them locked). Ticked, each publishes a section of its own id and name (two stories, outside the briefing's cap, never in Top picks; a story only one outlet carried never publishes). A schedule file without the new `general_scoped` marker reads as skipping them (`effectiveSkipTopics`, core), so today's briefings do not change; the first edit of a skip list writes the five ids and the marker (`withGeneralScope`). The site shows the lists the engine reads, so the chips start unticked and a tick is a real change. Weekly judges only stories the same run's daily pass did not.
  - A topic has no on and off switch: it is always on and open to every podcast. `enabled` stays parseable in `config/topics.json` and is read for no general topic. The topic page's Podcasts list is shown for general topics too, with no weight.
  - A topic's page opens with a summary card: a picture drawn from its id and name in the covers' language (`packages/cover/src/topicArt.ts`, deterministic, no request), its name, what counts as it, and a More menu (Edit; Delete for the owner's own topics). Sources has an outline Add source button level with its title; a source row shows its address, how many stories of it reached a briefing, and its score. The way up is a line over the card from 64rem.
  - The bar has no chevron. The whole bar opens and closes the page; the keyboard's Close button now exists at every width.
  - Library and Settings titles are the display size, as a briefing's title is (they were 22px from 64rem, D87, D89); every page starts 64px from the top from 40rem (was 48px); a hero's cover is 8rem, so the title, its facts and Play fill its height; the Contents list has more room inside each entry; a card with a progress bar has a shade under it; the Library's sort chevron is 16px; the check in a chosen segment is 6px from its word.
  - Copy: Custom for Episodes (Library filter and Podcasts list), AI Model, Last updated (the build's day, not a version), and the Topics row says only how many topics and sources there are. The "Next episode" line is gone from Daily and Weekly, with `nextBriefing`, `nextWeekly` and the page script that rewrote them; Weekly's off line sits under its switch.
  - The New episode panel has more air (gutter and group spacing from 40rem) and a stable scrollbar gutter: opening More options added a scrollbar that narrowed the column by its width and rewrapped every control, which was the shake.
  - Tooling: `npm run gate [-- --build]` runs typecheck, the site's type check, lint, the unit tests and the build in parallel (79 s here; the four in a row through the agent's shell took 321 s). `npm run typecheck` now includes `astro check` (the whole of `apps/web` was outside every gate; 22 errors were fixed). `scripts/worktreeLinks.mjs` links a worktree's packages and takes them off before the worktree is removed. `dispatch-worker` has 90 turns, commits early and reports by call 70; `dispatch-verify` runs the gate through PowerShell and no longer kills what listens on 4321, which is the owner's dev server.
- Why: the owner's list, whose earlier round had "tabs and Contents that I have told you multiple times". For speed: every process started from the agent's Git Bash cost 3 to 8 s while PowerShell starts one in 50 ms, so a one-file test took 37 s instead of 1.4 s; two workers each used 60 turns and reported nothing, as `learnings.md` said they would; and the type check the owner's rule calls a gate did not look at the site.
- Cost: `general_scoped` is one more field in the schedule file. A ticked general topic adds two stories per topic to a briefing and, on Weekly, up to 600 judged items (the ceiling); nothing has run live. The generated picture is abstract art with an initial, not a photograph. First-load JavaScript did not grow (the build's own check passed at 110 KB). The site check adds about 40 s to CI's typecheck step.
- Rejected: photographs for topics (an image search needs a key, a licence per picture and a network at build; the generated art needs none, and a photograph can replace it later); topics ticked by default on Daily and Weekly (tomorrow's design briefing would open with world news); removing `enabled` from the schema (an old file would fail to parse); a second close control for tablets (the bar, Escape and Back already close it).
- Amends: D69 (general topics are no longer for episodes only), D87 and D89 (title sizes), D90 (the chevron), D101 (every topic shown, the general ones locked).

## D103: Scores out of 5 as a star rating; Regenerate with feedback; a 150 KB budget

- Date: 2026-10-13 (the owner's second round of feedback that day)
- Decision:
  - A source's score is out of 5 again (SCORE_MAX 5; Excellent 4.5, Good 3.5, Fair 2.5, the same 0.9, 0.7 and 0.5 on the mean of the parts). A source row shows a star and the number ("4.5") before its checkbox, or New, and no longer shows its stories in briefings: the quality part already counts them (publish share and volume).
  - A topic page lists seven sources and a "Show N more" button. Delete in a topic's More menu opens a confirm dialog first; built-in topics (Design, AI, Technology, the general topics) still have no Delete or menu, as the engine refuses to remove them.
  - Copy: Listen in (was Podcasts), Topic weightage (was Weights, with no note under it), Configure (Daily and Weekly's link to Topics and sources), Primary voice and Secondary voice. Daily's Repeat row has no weekly note (`weeklyNote` is gone). The Topics list opens with "N topics" and a compact Add on one line; Add source is the same compact button.
  - The model field is as wide as its name at rest (`field-sizing: content`), so its hover fill hugs the words.
  - Today's New briefing is Regenerate: a dialog with one optional text area whose feedback goes through `/api/generate`, `run.yml`'s `feedback` input and `dispatch run --feedback` to the writer prompt as delimited untrusted text. It publishes a new digest that becomes the latest; it does not replace today's.
  - The first-load budget is 150 KB (was 110 KB, D53), at the owner's request.
- Why: the owner's feedback on /settings/daily, /settings/topics, /settings/topics/ai, /settings/model and Today.

## D115: Settings save quietly

- Date: 2026-10-14 (the owner: "I don't want the saving in progress snackbar ... I want it to feel live and natural"; #125)
- Decision:
  - A settings change shows no toast while it saves or once it is saved; the control already shows the change. The polite live region says "Saved." for a screen reader.
  - The toast comes up only when the owner can act or should know: a failure with Retry, a removal with Undo, and a save that could not change the time.
  - A page opened again before the build shows saved values without a line under its title. The line appears only when a held edit failed ("Not saved yet. It goes with your next change.").
- Why: a toast after every change made each edit feel like a transaction. The controls and the saved overlay (D79) already show the change at once.
- Cost: a sighted owner sees no confirmation that a save went through. A failure is still shown, and the rest of the site still updates after the redeploy (about a minute), which this does not change.
- Rejected: a shorter-lived Saved toast; an inline check beside the changed row (more markup for the same news).

## D123: one model select, system-coloured Android bars, a launch screen, a light from the playing cover

- Date: 2026-10-16 (the owner: "Just have one model drop-down available upfront in settings page (3 models (opus, sonnet, haiku, latest) + top 5 models from nebius that are very good for the podcast use case", "Flash screen design animation for pwa - dark & light", "Light animation of album art when playing", "Pwa bottom Android navigation is white, hiding the native nav buttons + has to adapt to theme")
- Decision:
  - Settings holds one "AI model" select in the Podcast section, in place of the AI Model page and its Provider select (D51's one job per page gives way to the owner's "upfront"). Claude: Opus, Sonnet and Haiku, each the newest of its family in Anthropic's list (Opus 5.5 joins the built-in models); Nebius: the first five of `NEBIUS_TOP` (EQ-Bench long-form writing, 2026-10-11) the live list still serves. The provider follows from the id; a saved model neither list offers shows as "(current)" (`writerOptions`, `lib/combobox.ts`).
  - The manifest names no `theme_color` and no `background_color` (`lib/manifest.ts`). Chrome reads them once at install into the WebAPK and paints the system navigation bar in `theme_color` (Chromium's WebAppNavigationBarThemeColor) and the status bar too, whatever the page shows later, and it dropped per-scheme manifest colours in Chrome 128. Without them Android draws its bars and splash in the system's light or dark theme. They follow the system, not an in-app Light or Dark choice, which nothing in the manifest can reach.
  - A launch screen in the installed app only (`display-mode: standalone`): the ringed dot where Android's splash left it sends out two rings, gives a beat and lifts away, about 0.9 s, in the theme's tokens, a 0.4 s fade under reduced motion (`LaunchScreen.astro`, `launch.css`). It persists across in-app moves and is hidden once played.
  - While the narration plays, the cover lights the open player page: the cover image itself, blurred, behind it, fading in on play and out on pause and breathing on a 4.2 s loop; transform and opacity only, still under reduced motion, hidden in forced colours (`PlayerCoverGlow`, `player.css`).
- Why: two selects and a separate page were three taps to a choice the owner makes often. The white bar was the light `theme_color` frozen into the installed app, under light navigation buttons in dark mode. The blurred cover is the one light source whose colours always match the art.
- Check: the manifest test keeps both colours out; the select's options are unit tested and its save, hold-away and layout journeys are browser tested; the launch screen and the glow were recorded frame by frame in both themes.
- Then, from the same day's audit of the app as a PWA (the owner: "audit all things related to making this a sound pwa app and making this fun to use"): navigation preload; an update check when the app returns to view, at most every 30 minutes; /library in the offline shell and stale hashed files pruned (sw.js v8); manifest shortcuts (Latest, Library, New episode) and `launch_handler`; an Install row on Settings for Android's install prompt; press timing back on the play disc, the bar's buttons and the view switch; votes that crossfade outline to fill and pop when pressed (never when restored); no tap flash or long-press link menu on in-app navigation; the bar title and story line fade on each story; Back to now rises in; the navigation pill grows from its centre after a move. A source can be deleted from its edit panel (no control sent `source.remove` before), and the model value on Settings takes the hint colour.
- Left for the owner: offline listening (keep the latest few recordings on the device; needs the audio host in the CSP and CORS), iOS startup images in both themes, the iOS status bar in the light theme (`black-translucent` puts white text over the light app bar; unchecked on an iPhone), and a Gallery and List morph.
- Not verified on a device: the bars and splash after reinstalling the app (an installed app keeps its old manifest colours until Chrome updates the WebAPK), and the launch hand-off from Android's splash.

## D124: named weight stops, source formats, a format mix and a perspective

- Date: 2026-10-20 (the owner: "in the sources section, I want a search bar with filters (Forums, Blogs, Videos, etc.)", "the topic weightage in each topic should rather be source type weightage and left vs right news", "the topic weight names are very generic, it needs to be meaningful", "for weights - do a slider with fixed values", "the source type can be guessed by jev and prefilled as soon as I add the url", "categorize all the existing sources too")
- Decision:
  - The eleven judge categories keep their ids and take story-kind names (Build breakdowns, User studies, Components, Motion and CSS, Tool launches, Design essays, AI interface patterns, Model releases, Device launches, Funding and gossip, AI hype lists). A weight is one of five stops: Off 0, Less 0.5, Normal 0.7, More 0.85, Most 0.95. Off replaces the hard-coded `NEVER_PUBLISH`; `dispatch learn` moves one stop.
  - Every source has a `format` (blog, news, forum, video, research, releases, podcast): the type's rule, then Jev (`classify-formats`, and on add within 3 s). Search and format and status chips filter the index and each topic page.
  - Source type is added to topic weights, not swapped for them: a page's format mix (Off to Most, x0 to x1.2) multiplies the topic score; Design, AI and Technology keep one mix on their home topic.
  - Left and right only on the five general topics: Jev rates each outlet's lean (-2 to 2), and a Perspective slider (default Even) moves a story by up to 15%, never removing one. The owner chose the slider over a Balance toggle.
  - A briefing takes at most two stories per outlet, by the story's host, outside sections of their own.
- Why: what a story is about (the weights) and where it comes from (the format) are different questions; replacing one with the other would score a hype list on a good blog like an essay. Numbers like 0.88 against 0.85 could not be heard in a briefing; five named stops can.
- Rejected: a Newsletters and an Official format (folded into News and Blog); AllSides or MBFC ratings (licence, US-only coverage); a lean filter that drops stories.
- Check: unit tests for Off, snapping, format derivation, group mix Off, perspective at Even and the outlet cap; a phone journey for search and chips, one for a format slider that holds after reload.
- Left: the general feeds rate 17 Centre-left, 10 Centre, 3 Centre-right, 0 Right, so Right has little to favour; `curate` (agent mode) ignores the mix.

## D129: Settings restructured

- Date: 2026-10-21 (the owner's backlog)
- Decision:
  - Index sections: Podcast (Daily, Weekly, Sources, Preferences), Intelligence (AI model), Sound (Podcast voice, Interface sounds, each a page: `/settings/voice`, `/settings/sounds`), Appearance (Theme, a select with no value drawn until the stored one is set), About. No breadcrumbs anywhere: titles stand alone and phones keep the app bar's arrow; a topic page has no "‹ Sources" link.
  - Daily and Weekly: no Configure row, Format and Length are selects, no voice rows, and Weekly has no switch (the engine still reads `weekly.enabled`, which is true).
  - One voice pair (`voice_id`, `voice_id_b` at the top of `config/schedule.json`, `podcastVoices()`) serves Daily, Weekly and Catch up; the old per-podcast voices apply only while it is unset. New episode keeps a per-request voice that defaults to the pair.
  - "Topics and sources" is "Sources" (page title too). A topic page has a Sources or Preferences switch (`?view=preferences`; Other has none). Preferences holds Topic weightage and, on World and Business or a topic with a saved lean, Perspective. "Format" is "Type" in copy. Catch up names on-request episodes everywhere.
  - One global type mix: `format_mix` in `config/preferences.json`, op `mix.set`, edited on `/settings/preferences` (seven sliders, Off, Less, Normal, More, Most, default Normal) and applied to every story by `applyFormatMix`. `topic.mix` carries perspective only; per-topic mixes are no longer read.
  - Sources page: a fire icon for Latest; deleting a source is a confirm dialog then immediate removal, no Undo; a suggested add shimmers, then moves into Sources and the next suggestion fills its place (10 rendered, 5 shown); desktop type chips with no All and multi-select, phone tabs with All, sticky with the search below 64rem; Add source beside the search from 64rem; the Add panel lists suggestions for its chosen topic.
- Why: one mix and one voice pair replaced settings the owner never wanted to repeat per page; a type mix per topic was a control with too many places to set. Breadcrumbs repeated what the title and the app bar already said.
- Rejected: keeping per-topic mixes beside the global one; a Weekly switch (the owner never turns it off).
- Check: unit tests for `mix.set`, `applyFormatMix` and `podcastVoices`; the topics journey. Revisit if: the `?view=preferences` flash of Sources on load bothers the owner.

## D133: the second owner round of 2026-10-21

- Date: 2026-10-21 (the owner: "the up next logic is a bit shady and flaky", "club stories and transcript to one", "the tab line is full bleed only on mobile, on desktop a segmented selector"; "different sections of the settings can be put in different cards"; "this style should be consistent everywhere, make sure there is an established linter"; "we have a flat design concept, so no shadow"; "each topic can have an icon or an emoji, use Jev to decide"; "drop daily type setting if nothing uses it"; "on mobile I should get a bottom sheet"; "simple outline ones and not have inner details")
- Decision: the full player has two views, Stories (each story a chapter row; the playing one shows its transcript under it) and Up next (the queue, or the previous briefing), as full-bleed tabs below 64rem and `.segmented-nav` above; the peek strip and pull-up sheet of D126 are gone, and an item's end opens Up next. Settings groups its rows in tonal `.card-group` cards; /settings/about holds the author, the purpose and a change log (`lib/changelog.ts`). Sources and topic pages use the Library's `.search-field` and `.filter-chip`; `styles.test.ts` fails a second search or chip style and any shadow that lifts a control. `.segmented-nav` is flat: the active pill is the accent container. Shipped topics have fixed emoji; an added topic asks Jev (`/api/topic-emoji`) with a fallback. Other is hidden from lists and pickers (its one source, Exa discovery, keeps running: the owner chose to hide, not delete). The Daily has no type; a stored top-level `format` is ignored. The Library row menu is a bottom sheet on a phone, with an icon per item. Icons are plain outlines; icon buttons never move on press.
- Why: the pull-up was hard to hit and fought the page's scroll; settings read as one long list; three search and chip styles had drifted apart with nothing to stop the next one.
- Check: the queue journey in `firstPlay.spec.ts`, the stillness test in `libraryMenu.spec.ts`, the offline Play journey, and the new style rules were each shown red first.

## D142: creating and deleting feel instant

- Date: 2026-10-21 (the owner on a phone: "emoji selection & topic creation should be made instantly", "suggested sources shown outside - not good and natural", "Why's there a delay in creation or deletion actions in the app?")
- Decision: A new topic is listed at once as a row like the others (emoji, name, "No sources yet", chevron) in its place by name, with core `topicEmoji`'s guess, replaced in place by Jev's pick. The add sends one `topic.upsert`: the request waits for Jev (up to 4.5 s, `pickEmoji`) through a `ready` promise on the pending edit, so the edits made meanwhile ride with it, and carries the guess when Jev has no answer. Before the build the row opens `/settings/topics/new?id=<id>`: one page `[id].astro` builds with stand-in id, name and description, which `fillShell` (`savedView.ts`) swaps for the saved or pending topic; it suggests sources with `suggestSources` in the browser. A topic the build already has, or one not saved here, goes to its own page; a removed one to the list. Suggested sources no longer show on the Sources list, and "Its page opens in about a minute" is gone. A source's removal now leaves at once with Undo in the toast, as a topic's does; a topic's page shows it removed at once rather than when the request lands. The server keeps its 10 s gap (`CONFIG_COOLDOWN_MS`, the flood guard): the client already holds the next request quietly and sends what changed meanwhile in one (D79, D91), so no screen waits on it.
- Why: the add waited up to 2.5 s for Jev before showing anything, then sat in a separate block with a note about the build, and its suggestions sat outside any topic. A deleted source vanished but could not be undone, and a deleted topic stayed on screen for the Undo window.
- Cost: the page before the build shows the generic art of its stand-in, not the topic's own, until the build. A topic opened from another device before the build is not on that device's list (the overlay is per browser, as D79's is).
- Rejected: an on-demand server route for the topic page (a function call on every visit to it, and the site is otherwise static); lowering the server gap (it is the flood guard, and the queue already hides it); a follow-up upsert for Jev's emoji (two commits and a ten-second wait).
- Amends: D79 (a new topic is a row and has a page before the build; its suggestions are on that page).

## D177: on a phone the Costs chart or table switch sits beside the figure

- Date: 2026-10-24
- Decision: from 40rem the switch stays at the end of the filter row (D169); below it, it sits at the end of the answer's first line, level with "Estimated spend", and the chips keep their row. It follows the answer in the reading order, just before the panels it switches.
- Why: at 390px the two pill chips and the switch do not fit one row, so the switch wrapped to a row of its own, 72px of nothing above the figure (screenshot, 2026-10-24). The owner chose the figure's line over the empty row.
- Rejected: the empty row it had; narrower chips (the pills are D167's one shape).
- Amends: D169's Costs bullet, on a phone only.
- Revisit if: the chips and the switch fit one row on a phone.

## D205: Settings paint the kept store copy at once, and the theme before first paint

- Date: 2026-10-28 (the owner: Settings takes a second to show Daily, Weekly, podcast and theme).
- Decision: a page with a kept copy of the store's answer (D172) shows it without waiting (`CACHE_GRACE_MS` 0); a store that then answers with something else is offered as a reload, as before. The Theme select takes this device's theme from an inline script before the first paint (`settingsInit.js`, its hash in the policy). A page with no valid copy still waits for the store, up to 2.5 s.
- Why: measured on the built site with a slow store, the lines took 376 to 577 ms with a copy (a fixed 300 ms wait for a store that nearly always takes longer, plus the script) and the theme 130 to 240 ms (the select drew nothing until the script ran). Now 163 to 184 ms and about 70 ms; the floor with no store is about 65 ms. The copy is what the page would show after the wait, so no build value paints first.
- Rejected: rendering settings from the store on the server (D172's rejection stands); the same inline script for the sounds, autoplay and volume controls (it would copy the reduced-motion default of `getSoundsEnabled`); keeping a copy across config changes (its ops are a diff from that build's files).
- Revisit if: cross-device reload toasts become common, or a first visit after a config change is reported slow; then keep the copy as full values, not a diff.
- Amends: D172.

## D215: Daily and Weekly have no Look back and no Format

- Date: 2026-10-29 (the owner: "Weekly Format removed. Look back removed for Daily and Weekly because the window is automatic; Catch up keeps its own").
- Decision: the Look back row (D184) and the Weekly Format row are gone from the Daily and Weekly pages. A podcast covers everything since its last episode, within the fetch window (at most 7 days). `lookback_hours` (top level and `weekly`) and `weekly.format` leave the schedule schema, the edit op and the engine; selection no longer has a `too_old` drop. A stored value is read past and dropped on the next write, and a page open from before sends them in vain. The Create panel keeps its Format and its own Look back.
- Why: nothing read Weekly Format for a briefing (it only chose hosts in Create), and a fixed lookback shorter than the cadence silently skips stories: 24 hours on a two-day cadence never airs stories 24 to 48 hours old.
- Rejected: keeping the stored fields as dormant data (a value nobody can see or clear would still narrow a run); a real two-host weekly (a larger build, not asked for).
- Supersedes: D184. Amends: D91, D100, D133 (the Weekly Format back and forth ends).

## D218: the podcast queue replaces the generations list and the run strip

- Date: 2026-10-29 (the owner's queue plan, and his answers on the table).
- Decision: what is being made shows in one queue, drawn from one script and one list of rows. It lists a Catch up and a regeneration while they are made, never a Daily, a Weekly or a delete, and it exists only while there is something to show. Below 64rem a dock sits directly above the bottom bar (never a modal): one row folded ("Generating podcast 45%"), the rows when opened. From 64rem a row under "Updated {date}" in the side column opens the rows in a popover. A row is a thumbnail, a name (`Catch up · 7 Oct`, `Weekly podcast · W24`), the time left, the stage, Cancel, and a ring with the percent. Cancel goes once the voices are being recorded. A run that ends well leaves, and a toast with Open says so; a failed, lost or cancelled one stays with its action until dismissed. The percent is a share of expected time weighed by stage length, and a ring never goes back. The old top-of-column icon, the side card and the strip's expanded card are gone.
- Why: the owner wanted a queue that reads as downloads do, and the strip, the card and the list each told the same run differently. A run that finished lingered in all three.
- Rejected: a modal or sheet for the dock (it blocked the bar); album art in the rows (the owner: not needed); polling `/api/generations` on every page to find another device's run (a GitHub call a page; the queue asks only while this device has something to show); a login gate on Cancel (owner: keep it open).
- Revisit if: another device's run must show here without a run of this device's own (one cheap check a tab session); `run.yml` now names a regeneration `regenerate <id>` (D217), so only a briefing under the old name `run` or made by hand is still hidden for other devices.
- Context changed: the owner asked for a queue that reads as downloads do, and the list, the card and the strip each told the same run differently.
- Supersedes: D208's list and card; amends D204's strip.

