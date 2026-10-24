/**
 * Markup for every screen and sheet. Plain template strings: the prototype has no framework, and
 * the structure here is exactly what the Astro and React components should emit.
 */
import { icon, playPauseIcons } from "./icons.js";
import {
  ARCHIVE,
  type ArchiveEntry,
  dayNumber,
  formatClock,
  groupArchive,
  ITEMS,
  longDate,
  paletteFor,
  readMinutes,
  SECTION_TITLES,
  type Timeline,
} from "./sampleContent.js";
import { scrubberMarkup } from "./scrubber.js";

export const CURRENT_ID = "2026-10-07";
const DIGEST_ITEMS = ITEMS.length;

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char] ?? char;
  });
}

export function coverMarkup(id: string, extra = ""): string {
  const palette = paletteFor(id);
  const weekly = id.endsWith("-weekly");
  return `<div class="cover" data-placeholder ${weekly ? "data-weekly" : ""} ${extra} style="--cover-bg:${palette.bg};--cover-fg:${palette.fg};--cover-key:${palette.key}" aria-hidden="true"><span class="cover-numeral">${dayNumber(id)}</span><span class="cover-tag">Placeholder cover</span></div>`;
}

/* ------------------------------------------------------------------ banners */

export type BannerKind = "offline" | "nothing" | "stale" | "error" | "preparing";

export function bannerMarkup(kind: BannerKind): string {
  switch (kind) {
    case "offline":
      return `<div class="banner" data-tone="warning" role="status">${icon("wifiOff")}<div><p class="banner-title">You are offline</p><p class="banner-body">Showing the last briefing you opened. Audio needs a connection.</p></div></div>`;
    case "nothing":
      return `<div class="banner" data-tone="info" role="status">${icon("info")}<div><p class="banner-title">Nothing cleared the bar.</p><p class="banner-body">No new items since Monday 5 October. The next run is due in two days.</p></div></div>`;
    case "stale":
      return `<div class="banner" data-tone="warning" role="status">${icon("clock")}<div><p class="banner-title">This briefing is 4 days old</p><p class="banner-body">Generate a new one to see what changed since.</p></div><button class="banner-action press" type="button" data-open="generate">Generate</button></div>`;
    case "error":
      return `<div class="banner" data-tone="danger" role="alert">${icon("alert")}<div><p class="banner-title">The briefing did not load</p><p class="banner-body">Check your connection, then try again.</p></div><button class="banner-action press" type="button" data-action="retry">Try again</button></div>`;
    case "preparing":
      return "";
  }
}

/* ------------------------------------------------------------------ home */

export function heroMarkup(timeline: Timeline, mode: "normal" | "preparing" | "offline"): string {
  const disabled = mode !== "normal";
  const label =
    mode === "preparing"
      ? "Audio is still being prepared"
      : mode === "offline"
        ? "Audio needs a connection"
        : "Play the briefing";
  const hint =
    mode === "preparing"
      ? '<p class="hero-hint" id="ctaHint">Narration is generated after the text. It usually takes a few minutes.</p>'
      : "";
  return `
    <section class="hero" aria-labelledby="pageTitle">
      ${coverMarkup(CURRENT_ID, 'id="heroCover"')}
      <div class="hero-text">
        <h1 id="pageTitle">${longDate(CURRENT_ID)}</h1>
        <p class="hero-meta">${DIGEST_ITEMS} items since Monday<br>${readMinutes()} min to read, ${Math.round(timeline.durationSec / 60)} to listen</p>
      </div>
      <div class="hero-cta">
        <button class="cta press press-subtle" id="cta" type="button" data-playing="false" ${disabled ? 'aria-disabled="true"' : ""} ${disabled && mode === "preparing" ? 'aria-describedby="ctaHint"' : ""}>
          <span class="cta-main">${playPauseIcons("cta-icon")}<span class="spinner" aria-hidden="true"></span><span id="ctaLabel">${label}</span></span>
          <span class="cta-time num" id="ctaTime">${disabled ? "" : formatClock(timeline.durationSec)}</span>
        </button>
      </div>
      ${hint}
    </section>`;
}

export function emptyMarkup(): string {
  return `
    <section class="empty" aria-labelledby="emptyTitle">
      ${coverMarkup("2026-10-07")}
      <h1 id="emptyTitle">No briefings yet</h1>
      <p>The first one arrives within two days. Generate one now to see how it reads.</p>
      <button class="btn-primary press press-subtle" type="button" data-open="generate">${icon("refresh")}Generate a briefing</button>
    </section>`;
}

export function briefingMarkup(timeline: Timeline): string {
  const sections = timeline.sections
    .map((section, sectionIndex) => {
      const items = ITEMS.filter((item) => item.section === section.slug);
      const sectionTime = formatClock(section.endSec - section.startSec);
      const itemHtml = items
        .map((item) => {
          const index = ITEMS.indexOf(item);
          const lead = index === 0;
          return `
        <article class="item" data-item-id="${item.id}" data-index="${index}" ${lead ? "data-lead" : ""} aria-labelledby="t-${item.id}">
          <span class="node" aria-hidden="true"></span>
          <h3 class="item-title" id="t-${item.id}"><a href="#/item/${item.id}" rel="noopener noreferrer">${esc(item.headline)}</a></h3>
          <div class="item-meta">
            <p class="item-byline"><span class="item-source">${esc(item.source)}</span><span><span class="sr-only">by </span>${esc(item.author)}</span></p>
            <button class="item-play press" type="button" data-play="${index}" data-current="false" data-playing="false" aria-label="Listen from here: ${esc(item.headline)}"><span class="item-play-face">${playPauseIcons()}</span></button>
          </div>
          <p class="item-summary">${esc(item.summary)}</p>
          <p class="item-why"><span class="item-why-label">Why</span>${esc(item.why)}</p>
        </article>`;
        })
        .join("");
      return `
      <section class="chapter-block" data-chapter="${section.slug}" aria-labelledby="c-${section.slug}">
        <div class="chapter" data-section-index="${sectionIndex}">
          <span class="chapter-node" aria-hidden="true"></span>
          <h2 id="c-${section.slug}"><button class="chapter-btn press" type="button" data-chapter-play="${section.firstIndex}" aria-label="Listen to ${esc(SECTION_TITLES[section.slug])}, ${sectionTime}"><span>${esc(SECTION_TITLES[section.slug])}</span><span class="chapter-time">${sectionTime}</span></button></h2>
        </div>
        ${itemHtml}
      </section>`;
    })
    .join("");
  return `
    <div class="briefing" id="briefing">
      <div class="rail" aria-hidden="true"><div class="rail-fill" id="railFill"></div></div>
      <div class="rail-hit" id="railHit" aria-hidden="true"></div>
      ${sections}
    </div>`;
}

function archiveRow(entry: ArchiveEntry): string {
  const weekly = entry.kind === "weekly";
  return `
    <li><a class="archive-row press" href="#/d/${entry.id}">
      ${coverMarkup(entry.id)}
      <span><span class="archive-date">${longDate(entry.id)}</span>
      <span class="archive-meta">${weekly ? '<span class="archive-kind">Weekly deep dive</span><br>' : ""}<span>${entry.items} items, ${entry.listenMinutes} min</span></span></span>
      ${icon("chevronRight")}
    </a></li>`;
}

export function earlierMarkup(): string {
  return `
    <section class="earlier" aria-labelledby="earlierTitle">
      <h2 class="section-title" id="earlierTitle">Earlier</h2>
      <ul class="archive-list" role="list">${ARCHIVE.slice(0, 3).map(archiveRow).join("")}</ul>
      <a class="btn-secondary earlier-all press press-subtle" href="#/archive">All briefings${icon("chevronRight")}</a>
    </section>
    <p class="foot">Prototype with invented sample content. Names, projects and studies are made up and links go nowhere. Covers are placeholders: the real ones are generated from each briefing.</p>`;
}

export function asideMarkup(timeline: Timeline): string {
  return `
    <aside class="aside" aria-label="Chapters">
      ${coverMarkup(CURRENT_ID)}
      <nav class="aside-nav" aria-label="Chapters">
        ${timeline.sections
          .map(
            (section) =>
              `<button class="aside-link press" type="button" data-chapter-play="${section.firstIndex}" data-section="${section.slug}"><span>${esc(SECTION_TITLES[section.slug])}</span><span>${formatClock(section.endSec - section.startSec)}</span></button>`,
          )
          .join("")}
      </nav>
    </aside>`;
}

/* ------------------------------------------------------------------ archive view */

export function archiveViewMarkup(): string {
  const years = groupArchive();
  const total = ARCHIVE.length + 1;
  return `
    <div class="archive-view">
      <h1 id="archiveTitle" tabindex="-1">Archive</h1>
      <p class="archive-lede">${total} briefings, newest first. Weekly deep dives are marked.</p>
      ${years
        .map(
          (year, yearIndex) => `
        <details class="year-group" ${yearIndex === 0 ? "open" : ""}>
          <summary><span>${year.year}</span>${icon("chevronDown")}</summary>
          ${year.months
            .map(
              (month, monthIndex) => `
            <details class="month-group" ${yearIndex === 0 && monthIndex === 0 ? "open" : ""}>
              <summary><span>${month.label}</span><span class="month-count">${month.entries.length} briefings${icon("chevronDown")}</span></summary>
              <ul class="month-body archive-list" role="list">${month.entries.map(archiveRow).join("")}</ul>
            </details>`,
            )
            .join("")}
        </details>`,
        )
        .join("")}
    </div>`;
}

/* ------------------------------------------------------------------ mini player */

export function miniMarkup(): string {
  return `
    <div class="mini-progress" aria-hidden="true"><span class="mini-progress-fill" id="miniFill"></span></div>
    <button class="mini-open press press-subtle" id="miniOpen" type="button" aria-haspopup="dialog" aria-label="Open the player">
      ${coverMarkup(CURRENT_ID, 'id="miniCover"')}
      <span class="mini-text"><span class="mini-section" id="miniSection"></span><span class="mini-title" id="miniTitle"></span></span>
    </button>
    <button class="mini-btn press" id="miniToggle" type="button" data-primary data-playing="false" aria-label="Play">${playPauseIcons()}</button>
    <button class="mini-btn press" id="miniNext" type="button" aria-label="Next item">${icon("skipForward")}</button>`;
}

/* ------------------------------------------------------------------ expanded player */

/** The playback speeds offered, in the player and as the default in settings. */
export const RATES = [1, 1.25, 1.5, 2];

export function playerMarkup(timeline: Timeline, rate: number): string {
  return `
    <div class="player-scrim" id="playerScrim"></div>
    <div class="player-panel" id="playerPanel" tabindex="-1" data-cover-key style="--cover-key:${paletteFor(CURRENT_ID).key}">
      <div class="player-drag" id="playerDrag">
        <div class="player-handle" aria-hidden="true"></div>
        <div class="player-bar">
          <span class="player-bar-date">${longDate(CURRENT_ID)}</span>
          <button class="icon-btn press" id="playerClose" type="button" aria-label="Close the player">${icon("chevronDown", "icon-lg")}</button>
        </div>
        <div class="player-cover">${coverMarkup(CURRENT_ID, 'id="playerCover"')}</div>
        <div class="player-meta">
          <p class="player-section" id="playerSection"></p>
          <h2 class="player-title" id="playerTitle"></h2>
          <p class="player-source" id="playerSource"></p>
        </div>
      </div>
      <div class="player-controls">
        ${scrubberMarkup(timeline)}
        <div class="transport">
          <button class="transport-btn press" id="tPrev" type="button" aria-label="Previous item">${icon("skipBack")}</button>
          <button class="transport-btn press" id="tBack" type="button" data-size="sm" aria-label="Back 15 seconds">${icon("back15")}</button>
          <button class="transport-btn press" id="tToggle" type="button" data-primary data-playing="false" aria-label="Play">${playPauseIcons()}<span class="spinner" aria-hidden="true"></span></button>
          <button class="transport-btn press" id="tForward" type="button" data-size="sm" aria-label="Forward 15 seconds">${icon("forward15")}</button>
          <button class="transport-btn press" id="tNext" type="button" aria-label="Next item">${icon("skipForward")}</button>
        </div>
      </div>
      <div class="player-scroll scroll-area">
        <fieldset class="player-group">
          <legend class="player-section-title">Speed</legend>
          <div class="segmented" id="speedGroup">
            ${RATES.map(
              (value) =>
                `<label><input type="radio" name="speed" value="${value}" ${value === rate ? "checked" : ""}><span>${value}x</span></label>`,
            ).join("")}
          </div>
        </fieldset>
        <h3 class="player-section-title">Chapters</h3>
        <div id="chapterList"></div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ sheets */

export function settingsMarkup(state: {
  theme: string;
  sounds: boolean;
  volume: number;
  rate: number;
}): string {
  const themes: Array<[string, string]> = [
    ["system", "System"],
    ["light", "Light"],
    ["dark", "Dark"],
  ];
  return `
    <div class="sheet-panel" tabindex="-1">
      <div class="sheet-head">
        <h2 class="sheet-title" id="settingsTitle">Settings</h2>
        <button class="icon-btn press" type="button" data-close aria-label="Close settings">${icon("close")}</button>
      </div>

      <fieldset class="sheet-group">
        <legend>Theme</legend>
        <div class="segmented">
          ${themes
            .map(
              ([value, label]) =>
                `<label><input type="radio" name="theme" value="${value}" ${state.theme === value ? "checked" : ""}><span>${label}</span></label>`,
            )
            .join("")}
        </div>
      </fieldset>

      <div class="sheet-group">
        <h3>Sound</h3>
        <label class="setting-row">
          <span class="setting-text"><span>Interface sounds</span><span class="setting-hint">Soft cues for play, skips and Generate. Follows your phone's silent switch.</span></span>
          <input class="switch" id="soundsSwitch" type="checkbox" role="switch" ${state.sounds ? "checked" : ""}>
        </label>
        <div class="setting-stack">
          <label for="volumeRange" id="volumeLabel">Volume</label>
          <input class="range" id="volumeRange" type="range" min="0" max="1" step="0.05" value="${state.volume}" ${state.sounds ? "" : "disabled"}>
        </div>
      </div>

      <fieldset class="sheet-group">
        <legend>Default speed</legend>
        <div class="segmented">
          ${RATES.map(
            (value) =>
              `<label><input type="radio" name="defaultSpeed" value="${value}" ${value === state.rate ? "checked" : ""}><span>${value}x</span></label>`,
          ).join("")}
        </div>
      </fieldset>

      <div class="sheet-group" id="installHint">
        <h3>Install</h3>
        <div class="hint-card">
          ${icon("share")}
          <div>
            <p><strong>Add Singularity to your Home Screen</strong>In Safari, tap Share, then Add to Home Screen. It opens full screen and keeps playing in the background.</p>
          </div>
          <button class="btn press" type="button" id="hideInstall">Hide this</button>
        </div>
      </div>

      <details class="sheet-group proto-group">
        <summary class="btn press">Prototype states</summary>
        <div class="field">
          <label for="stateSelect">Page state</label>
          <select id="stateSelect">
            <option value="normal">Normal</option>
            <option value="offline">Offline</option>
            <option value="nothing">Nothing cleared the bar</option>
            <option value="preparing">Audio still preparing</option>
            <option value="stale">Stale briefing</option>
            <option value="error">Briefing failed to load</option>
            <option value="empty">No briefings yet</option>
          </select>
          <label class="setting-row"><span class="setting-text"><span>Slow network</span><span class="setting-hint">First play buffers for 1.4 seconds.</span></span><input class="switch" id="slowSwitch" type="checkbox" role="switch"></label>
          <label class="setting-row"><span class="setting-text"><span>Device voice</span><span class="setting-hint">Reads the briefing aloud with the browser's voice, so you can hear sounds duck under speech.</span></span><input class="switch" id="voiceSwitch" type="checkbox" role="switch"></label>
        </div>
      </details>
    </div>`;
}

export function generateMarkup(): string {
  return `
    <div class="sheet-panel" tabindex="-1">
      <div class="sheet-head">
        <h2 class="sheet-title" id="generateTitle">Generate a new briefing</h2>
        <button class="icon-btn press" type="button" data-close aria-label="Close">${icon("close")}</button>
      </div>
      <p class="sheet-lede" id="generateLede">Covers everything since Monday. It takes a few minutes, and you can close this sheet while it runs.</p>
      <form id="generateForm" novalidate>
        <div class="field">
          <label for="pass">Passphrase</label>
          <input id="pass" name="pass" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="passHint passError">
          <p class="field-hint" id="passHint">Prototype: try demo, nothing, cooldown or fail.</p>
          <p class="field-error" id="passError" role="alert" hidden></p>
        </div>
        <p class="botcheck" id="botcheck" data-state="pending"><span class="spinner" aria-hidden="true"></span><span id="botcheckText">Checking you are not a bot</span></p>
        <div class="sheet-actions">
          <button class="btn-primary press press-subtle" id="generateBtn" type="submit">Generate briefing</button>
        </div>
      </form>
      <ol class="run-steps" id="runSteps" role="list" aria-label="Progress" hidden></ol>
      <div class="run-result" id="runResult" aria-live="polite"></div>
    </div>`;
}

export function toastMarkup(): string {
  return `<span id="toastText">Briefing ready</span><button class="toast-action press" id="toastAction" type="button">Open</button><button class="toast-dismiss press" id="toastDismiss" type="button" aria-label="Dismiss">${icon("close")}</button>`;
}
