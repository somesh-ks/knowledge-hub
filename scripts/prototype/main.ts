/**
 * Prototype entry: wires markup, player store, reader, sheets, sounds and settings together.
 * Everything here is prototype glue. The component contracts it demonstrates are in the spec.
 */
import {
  createSoundEngine,
  defaultSoundsEnabled,
  installGestureUnlock,
  type PlayOptions,
  type SoundName,
} from "../../packages/sound/src/index.js";
import { createGenerate } from "./generate.js";
import { icon, MARK_SVG } from "./icons.js";
import { prefersReducedMotion } from "./motion.js";
import { createPlayerSheet } from "./playerSheet.js";
import { createPlayer, type PlayerState } from "./playerStore.js";
import { createReader, resumeFollow } from "./reader.js";
import { buildTimeline, clockHtml, formatClock, ITEMS, SECTION_TITLES } from "./sampleContent.js";
import { createScrubber } from "./scrubber.js";
import {
  archiveViewMarkup,
  asideMarkup,
  type BannerKind,
  bannerMarkup,
  briefingMarkup,
  earlierMarkup,
  emptyMarkup,
  generateMarkup,
  heroMarkup,
  miniMarkup,
  playerMarkup,
  settingsMarkup,
  toastMarkup,
} from "./views.js";

/* ------------------------------------------------------------------ setup */

type PageState = "normal" | "offline" | "nothing" | "preparing" | "stale" | "error" | "empty";
const THEMES = ["system", "light", "dark"] as const;
type ThemePref = (typeof THEMES)[number];
const RATES = [1, 1.25, 1.5, 2];

interface Prefs {
  theme: ThemePref;
  sounds: boolean;
  volume: number;
  rate: number;
  installHidden: boolean;
}

const STORAGE_KEY = "singularity-prototype";

function loadPrefs(): Prefs {
  const fallback: Prefs = {
    theme: "system",
    sounds: defaultSoundsEnabled(),
    volume: 0.8,
    rate: 1,
    installHidden: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    // Each field is checked, not spread: the settings sheet writes these values into its markup.
    const saved = JSON.parse(raw) as Record<string, unknown>;
    return {
      theme: THEMES.find((theme) => theme === saved.theme) ?? fallback.theme,
      sounds: typeof saved.sounds === "boolean" ? saved.sounds : fallback.sounds,
      volume: unitNumber(saved.volume) ?? fallback.volume,
      rate: RATES.find((rate) => rate === saved.rate) ?? fallback.rate,
      installHidden: saved.installHidden === true,
    };
  } catch {
    return fallback;
  }
}

function unitNumber(value: unknown): number | undefined {
  return typeof value === "number" && value >= 0 && value <= 1 ? Number(value) : undefined;
}

function savePrefs(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage is best effort.
  }
}

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

const params = new URLSearchParams(location.search);
const prefs = loadPrefs();
const timeline = buildTimeline();
const player = createPlayer(timeline, ITEMS);
let pageState: PageState = (params.get("state") as PageState | null) ?? "normal";

const sound = createSoundEngine({
  isEnabled: () => prefs.sounds,
  getVolume: () => prefs.volume,
  isNarrationPlaying: () => player.isNarrating(),
});
installGestureUnlock(sound);
const cue = (name: SoundName, options?: PlayOptions): void => {
  sound.play(name, options);
};

player.setRate(prefs.rate);

/* ------------------------------------------------------------------ announcements */

const live = [must("liveA"), must("liveB")];
let liveTurn = 0;
/** Two regions used alternately, each cleared before reuse, so no message is dropped. */
function announce(message: string): void {
  const region = live[liveTurn++ % 2];
  if (!region) return;
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = message;
  }, 50);
}

/* ------------------------------------------------------------------ theme */

function applyTheme(): void {
  const root = document.documentElement;
  if (prefs.theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = prefs.theme;
}

function changeTheme(next: ThemePref): void {
  prefs.theme = next;
  savePrefs();
  // A crossfade, not a wipe: theme changes are rare, and a quiet fade eases the brightness jump.
  if (document.startViewTransition) document.startViewTransition(applyTheme);
  else applyTheme();
}

const themeParam = params.get("theme");
if (themeParam === "light" || themeParam === "dark" || themeParam === "system")
  prefs.theme = themeParam;
applyTheme();

/* ------------------------------------------------------------------ shells */

must("wordmarkSlot").innerHTML = `${MARK_SVG}<span>Singularity</span>`;
must("generateIcon").innerHTML = icon("refresh");
must("settingsIcon").innerHTML = icon("sliders");

const mini = must("mini");
mini.innerHTML = miniMarkup();
const playerDialog = must<HTMLDialogElement>("playerSheet");
playerDialog.innerHTML = playerMarkup(timeline, prefs.rate);
const generateDialog = must<HTMLDialogElement>("generateSheet");
generateDialog.innerHTML = generateMarkup();
const settingsDialog = must<HTMLDialogElement>("settingsSheet");
settingsDialog.innerHTML = settingsMarkup({
  theme: prefs.theme,
  sounds: prefs.sounds,
  volume: prefs.volume,
  rate: prefs.rate,
});
const toast = must("toast");
toast.innerHTML = toastMarkup();

const shell = must("shell");
const banners = must("banners");

/* ------------------------------------------------------------------ playback actions */

/** Plays the cue before narration starts, so it lands in silence. */
function startNarration(): void {
  resumeFollow();
  cue("play");
  player.play();
}

function stopNarration(): void {
  player.pause();
  // After the pause, so the cue is not skipped by the narration policy.
  cue("pause");
}

function togglePlayback(): void {
  const { status } = player.getState();
  if (status === "playing" || status === "loading") {
    stopNarration();
    announce("Paused.");
  } else {
    startNarration();
    announce("Playing.");
  }
}

function playItem(index: number): void {
  const state = player.getState();
  if (state.hasStarted && state.status === "playing" && state.itemIndex === index) {
    stopNarration();
    announce("Paused.");
    return;
  }
  resumeFollow();
  if (state.status !== "playing") cue("play");
  player.playItem(index);
  announce(`Playing item ${index + 1} of ${ITEMS.length}: ${ITEMS[index]?.headline ?? ""}`);
}

function skipItem(direction: "next" | "previous"): void {
  const moved = direction === "next" ? player.next() : player.previous();
  if (!moved) return;
  resumeFollow();
  cue(direction === "next" ? "itemNext" : "itemPrev");
  const index = player.getState().itemIndex;
  announce(`Item ${index + 1} of ${ITEMS.length}: ${ITEMS[index]?.headline ?? ""}`);
}

function setRate(rate: number, announceIt = true): void {
  player.setRate(rate);
  prefs.rate = rate;
  savePrefs();
  for (const radio of document.querySelectorAll<HTMLInputElement>(
    'input[name="speed"], input[name="defaultSpeed"]',
  )) {
    radio.checked = Number(radio.value) === rate;
  }
  if (announceIt) {
    cue("speedChange", { rate });
    announce(`Speed ${rate}x.`);
  }
}

/* ------------------------------------------------------------------ home rendering */

let reader: ReturnType<typeof createReader> | null = null;

function bannerFor(state: PageState): BannerKind | null {
  switch (state) {
    case "offline":
    case "nothing":
    case "stale":
    case "error":
      return state;
    default:
      return null;
  }
}

function renderBanners(route: "home" | "archive"): void {
  const kind = bannerFor(pageState);
  const show = kind && (route === "home" || kind === "offline");
  banners.innerHTML = show && kind ? bannerMarkup(kind) : "";
}

function renderHome(): void {
  reader?.destroy();
  reader = null;
  renderBanners("home");
  if (pageState === "empty") {
    shell.innerHTML = `<main id="main">${emptyMarkup()}</main>`;
    return;
  }
  if (pageState === "error") {
    shell.innerHTML = `<main id="main" tabindex="-1">${earlierMarkup()}</main>`;
    return;
  }
  const heroMode =
    pageState === "offline" ? "offline" : pageState === "preparing" ? "preparing" : "normal";
  shell.innerHTML = `${asideMarkup(timeline)}<main id="main">${heroMarkup(timeline, heroMode)}${briefingMarkup(timeline)}${earlierMarkup()}</main>`;
  reader = createReader({
    briefing: must("briefing"),
    player,
    timeline,
    onSeekItem: (index) => playItem(index),
  });
  syncPlayback(player.getState());
}

function renderArchive(): void {
  reader?.destroy();
  reader = null;
  renderBanners("archive");
  shell.innerHTML = `<main id="main">${`<a class="btn press back-link" href="#/">${icon("chevronLeft")}Today</a>`}${archiveViewMarkup()}</main>`;
}

function route(): "home" | "archive" {
  return location.hash.startsWith("#/archive") ? "archive" : "home";
}

function renderRoute(moveFocus = true): void {
  if (route() === "archive") renderArchive();
  else renderHome();
  document.documentElement.dataset.view = route();
  if (moveFocus) {
    // A client-side navigation resets scroll and moves focus to the new heading, as a page load would.
    window.scrollTo(0, 0);
    const heading = document.getElementById(route() === "archive" ? "archiveTitle" : "pageTitle");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }
  document.title =
    route() === "archive" ? "Archive, Singularity" : "Wednesday 7 October, Singularity";
}

window.addEventListener("hashchange", () => {
  if (document.startViewTransition) document.startViewTransition(renderRoute);
  else renderRoute();
});

/* ------------------------------------------------------------------ playback UI sync */

const SECTION_LABEL = (index: number): string => {
  const slug = timeline.items[index]?.section;
  return `${slug ? SECTION_TITLES[slug] : ""}, ${index + 1} of ${ITEMS.length}`;
};

function syncPlayback(state: PlayerState): void {
  const root = document.documentElement;
  root.dataset.playerState = state.status;
  root.dataset.mini = state.hasStarted ? "visible" : "hidden";
  const playing = state.status === "playing" || state.status === "loading";

  // Hero call to action.
  const cta = document.getElementById("cta");
  if (cta && cta.getAttribute("aria-disabled") !== "true") {
    cta.dataset.playing = String(state.status === "playing");
    const label = document.getElementById("ctaLabel");
    const time = document.getElementById("ctaTime");
    const text =
      state.status === "playing"
        ? "Pause"
        : state.status === "loading"
          ? "Preparing audio"
          : state.status === "paused"
            ? "Resume"
            : state.status === "ended"
              ? "Play again"
              : "Play the briefing";
    if (label) label.textContent = text;
    if (time)
      time.innerHTML =
        state.status === "idle"
          ? clockHtml(timeline.durationSec)
          : `${clockHtml(state.time)} of ${clockHtml(timeline.durationSec)}`;
    loadingTimer(cta, state.status === "loading");
  }

  // Mini player.
  mini.dataset.visible = String(state.hasStarted);
  const item = ITEMS[state.itemIndex];
  const miniSection = document.getElementById("miniSection");
  const miniTitle = document.getElementById("miniTitle");
  if (miniSection) miniSection.textContent = SECTION_LABEL(state.itemIndex);
  if (miniTitle && item) miniTitle.textContent = item.headline;
  const miniToggle = document.getElementById("miniToggle");
  if (miniToggle) {
    miniToggle.dataset.playing = String(state.status === "playing");
    miniToggle.setAttribute("aria-label", playing ? "Pause" : "Play");
  }
  document
    .getElementById("miniOpen")
    ?.setAttribute("aria-label", `Open the player. ${item?.headline ?? ""}`);

  // Expanded player.
  const section = document.getElementById("playerSection");
  const title = document.getElementById("playerTitle");
  const source = document.getElementById("playerSource");
  if (section) section.textContent = SECTION_LABEL(state.itemIndex);
  if (title && item) title.textContent = item.headline;
  if (source && item) source.textContent = `${item.source}, ${item.author}`;
  const toggle = document.getElementById("tToggle");
  if (toggle) {
    toggle.dataset.playing = String(state.status === "playing");
    toggle.setAttribute("aria-label", playing ? "Pause" : "Play");
    toggle.toggleAttribute("aria-busy", state.status === "loading");
    toggle.dataset.loading = String(state.status === "loading");
  }
  renderChapterList(state);
}

let loadingHandle = 0;
function loadingTimer(cta: HTMLElement, loading: boolean): void {
  window.clearTimeout(loadingHandle);
  if (!loading) {
    cta.removeAttribute("data-loading");
    return;
  }
  // The spinner appears only after 300 ms, so a fast load never flashes it.
  loadingHandle = window.setTimeout(() => {
    cta.dataset.loading = "true";
  }, 300);
}

function renderChapterList(state: PlayerState): void {
  const list = document.getElementById("chapterList");
  if (!list) return;
  list.innerHTML = timeline.sections
    .map(
      (section, index) =>
        `<button class="chapter-row press" type="button" data-chapter-play="${section.firstIndex}" ${state.hasStarted && index === state.sectionIndex ? 'aria-current="true"' : ""}><span class="chapter-row-name">${SECTION_TITLES[section.slug]}</span><span class="chapter-row-time">${formatClock(section.endSec - section.startSec)}</span></button>`,
    )
    .join("");
}

player.subscribe((state, previous) => {
  syncPlayback(state);
  if (previous.status !== "ended" && state.status === "ended") {
    cue("digestEnd");
    announce("Briefing finished.");
  }
});
player.onFrame((time, duration) => {
  const fill = document.getElementById("miniFill");
  if (fill) fill.style.setProperty("--player-progress", (time / duration).toFixed(5));
});

/* ------------------------------------------------------------------ sheets */

function openSheet(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  dialog.showModal();
  cue("sheetOpen");
  if (dialog === generateDialog) generate.onOpen();
}

for (const dialog of [generateDialog, settingsDialog]) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => cue("sheetClose"));
}

const generate = createGenerate({
  dialog: generateDialog,
  playSound: (name) => cue(name),
  announce,
  isOffline: () => pageState === "offline" || !navigator.onLine,
  onFinishedInBackground: (status) => {
    showToast(
      status === "success"
        ? "Briefing ready"
        : status === "nothing"
          ? "Nothing cleared the bar."
          : "The run failed",
      status === "success" ? "Open" : "Details",
      () => {
        if (status === "success")
          window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        else openSheet(generateDialog);
      },
    );
  },
  onOpenNewBriefing: () => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  },
});

const toastTimer = 0;
function showToast(text: string, actionLabel: string, onAction: () => void): void {
  const message = document.getElementById("toastText");
  const action = document.getElementById("toastAction");
  if (message) message.textContent = text;
  if (action) {
    action.textContent = actionLabel;
    action.onclick = () => {
      toast.hidePopover();
      onAction();
    };
  }
  if (toast.matches(":popover-open")) toast.hidePopover();
  toast.showPopover();
  announce(text);
  // A toast with an action stays until dismissed or used, so nothing is lost to a timer.
  window.clearTimeout(toastTimer);
}

document.getElementById("toastDismiss")?.addEventListener("click", () => toast.hidePopover());

/* ------------------------------------------------------------------ player sheet */

const playerSheet = createPlayerSheet({
  dialog: playerDialog,
  panel: must("playerPanel"),
  scrim: must("playerScrim"),
  dragZone: must("playerDrag"),
  cover: must("playerCover"),
  miniCover: () => document.getElementById("miniCover"),
  openZone: must("miniOpen"),
  onCommitOpen: () => cue("sheetOpen"),
  onCommitClose: () => cue("sheetClose"),
});

createScrubber({
  root: must("scrubber"),
  player,
  timeline,
  onDetent: (position) => cue("scrubDetent", { position }),
  onKeyItemSkip: (direction) => cue(direction === "next" ? "itemNext" : "itemPrev"),
});

must("miniOpen").addEventListener("click", () => playerSheet.open());
must("playerClose").addEventListener("click", () => playerSheet.close());
must("miniToggle").addEventListener("click", togglePlayback);
must("miniNext").addEventListener("click", () => skipItem("next"));
must("tToggle").addEventListener("click", togglePlayback);
must("tPrev").addEventListener("click", () => skipItem("previous"));
must("tNext").addEventListener("click", () => skipItem("next"));
must("tBack").addEventListener("click", () => player.skip(-15));
must("tForward").addEventListener("click", () => player.skip(15));

must("speedGroup").addEventListener("change", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.name === "speed") setRate(Number(target.value));
});

/* ------------------------------------------------------------------ settings */

settingsDialog.addEventListener("change", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.name === "theme") changeTheme(target.value as ThemePref);
  if (target.name === "defaultSpeed") setRate(Number(target.value));
  if (target.id === "soundsSwitch") {
    const volume = settingsDialog.querySelector<HTMLInputElement>("#volumeRange");
    if (target.checked) {
      prefs.sounds = true;
      cue("toggleOn");
    } else {
      // The off cue plays first, then the engine goes quiet: a last confirmation.
      cue("toggleOff");
      prefs.sounds = false;
    }
    if (volume) volume.disabled = !prefs.sounds;
    savePrefs();
  }
  if (target.id === "volumeRange") cue("toggleOn");
  if (target.id === "stateSelect") {
    pageState = (target as unknown as HTMLSelectElement).value as PageState;
    renderRoute(false);
  }
  if (target.id === "slowSwitch") player.setBufferDelay(target.checked ? 1400 : 0);
  if (target.id === "voiceSwitch") player.setVoiceEnabled(target.checked);
});

settingsDialog.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === "volumeRange") {
    prefs.volume = Number(target.value);
    target.style.setProperty("--range-fill", `${prefs.volume * 100}%`);
    savePrefs();
  }
});

const volumeRange = settingsDialog.querySelector<HTMLInputElement>("#volumeRange");
volumeRange?.style.setProperty("--range-fill", `${prefs.volume * 100}%`);
if (prefs.installHidden) settingsDialog.querySelector("#installHint")?.setAttribute("hidden", "");
settingsDialog.querySelector("#hideInstall")?.addEventListener("click", () => {
  prefs.installHidden = true;
  savePrefs();
  settingsDialog.querySelector("#installHint")?.setAttribute("hidden", "");
});

/* ------------------------------------------------------------------ global clicks */

document.addEventListener("click", (event) => {
  const target = event.target as Element;
  const closest = (selector: string): HTMLElement | null => target.closest<HTMLElement>(selector);

  if (closest('a[href="#"], a[href="#run"]')) {
    event.preventDefault();
    return;
  }
  const cta = closest("#cta");
  if (cta) {
    if (cta.getAttribute("aria-disabled") !== "true") togglePlayback();
    return;
  }
  const play = closest("[data-play]");
  if (play) {
    playItem(Number(play.dataset.play));
    return;
  }
  const chapter = closest("[data-chapter-play]");
  if (chapter) {
    playItem(Number(chapter.dataset.chapterPlay));
    return;
  }
  if (closest("#openGenerate") || closest('[data-open="generate"]')) {
    openSheet(generateDialog);
    return;
  }
  if (closest("#openSettings")) {
    openSheet(settingsDialog);
    return;
  }
  const dismiss = closest("[data-close]");
  if (dismiss) {
    dismiss.closest("dialog")?.close();
    return;
  }
  if (closest('[data-action="retry"]')) {
    pageState = "normal";
    renderRoute();
  }
});

/* ------------------------------------------------------------------ boot */

window.addEventListener("online", () => announce("You are back online."));
window.addEventListener("offline", () => announce("You are offline."));

renderRoute(false);
syncPlayback(player.getState());

const stateSelect = settingsDialog.querySelector<HTMLSelectElement>("#stateSelect");
if (stateSelect) stateSelect.value = pageState;

// Screenshot and review hooks: ?at=<item>&play=1&open=player|generate|settings
const at = params.get("at");
if (at !== null) {
  const index = Math.min(ITEMS.length - 1, Math.max(0, Number(at)));
  const entry = timeline.items[index];
  if (entry) {
    player.seek(entry.startSec + (entry.endSec - entry.startSec) * 0.42);
    // Mark the player as started without sound: the first play is a user gesture in real use.
    player.play();
    if (params.get("play") !== "1") player.pause();
  }
}
const open = params.get("open");
if (open === "player") playerSheet.open();
if (open === "generate") openSheet(generateDialog);
if (open === "settings") openSheet(settingsDialog);

declare global {
  interface Window {
    singularityPrototype: { player: typeof player; sound: typeof sound; prefs: Prefs };
  }
}
window.singularityPrototype = { player, sound, prefs };
