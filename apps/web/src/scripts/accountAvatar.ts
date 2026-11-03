/**
 * The avatar in the app bar and the side column (D326). The server draws a cookie; this puts the shape
 * the mood and the reader's pick call for, and lets the avatar react to what the app is really doing.
 *
 * It reads, never owns: the mood's shapes come from the --av-shapes token (avatar.css), the pick from
 * the preferences, and the app's state from what the shell already says on <html>: data-offline
 * (deviceBanners.ts), data-run (a podcast being made), data-player-state (playing). A success or a
 * failure is the app's own sound cue (singularity:sound), a favourite is singularity:saved.
 *
 * Nothing loops by itself. A state shows while it is true, a one-shot plays once, and an idle blink,
 * glance or wiggle comes every 20 to 40 seconds while the page is visible. avatar.css plays none of it
 * under reduced motion, so this does not schedule the idle ones then.
 *
 * A tap is a small, calm show on the face (D353, avatarFace.ts): a look round, a happy squint, a surprised
 * o, a morph into another shape and back. The --av-plays token of the mood lists what it may do, and the hue says where in that
 * list it starts, so each tap is the next one, never a repeat. A tap in the app bar goes to the profile
 * and the show carries on in the persisted avatar. A new pick plays one too. A tap during a show waits for it to end.
 */
import { AVATAR_SHAPES, avatarMarkup, moodShapes, tokenWords } from "../design-system/avatar";
import { getPreferences } from "../player/core/preferences";
import { playAct, rootStyle, stopAct, tokenMs } from "./avatarFace";
import { morphPath, pickReaction } from "./avatarReactions";

const SLOT = "[data-account]";
const ONE_SHOT_MS = 1400;
const FROWN_MS = 2600;
const IDLE_MIN_MS = 20_000;
const IDLE_SPAN_MS = 20_000;
const IDLE_PLAYS = ["blink", "look", "wiggle"] as const;

/** The shape to draw: the reader's pick where this mood offers it, else the mood's first. */
export function chooseShape(picked: string, offered: string[], moodDefault: string): string {
  if (picked && offered.includes(picked)) return picked;
  if (offered.includes(moodDefault)) return moodDefault;
  return offered[0] ?? "cookie";
}

/** The shapes the current mood offers, in its order. */
export function offeredShapes(): string[] {
  const token = getComputedStyle(document.documentElement).getPropertyValue("--av-shapes");
  const shapes = moodShapes(token);
  return shapes.length > 0 ? shapes : ["cookie"];
}

function moodDefault(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--av-shape-default").trim();
}

/** The shape this device shows now. The profile page's picker uses it to mark the current one. */
export function currentShape(): string {
  return chooseShape(getPreferences().get().avatar, offeredShapes(), moodDefault());
}

function avatars(): HTMLElement[] {
  // The slot holds the Avatar and nothing else, so its one child is it.
  return [...document.querySelectorAll<HTMLElement>(`${SLOT} > *`)];
}

function show(id: string, only = avatars()): void {
  const tone = AVATAR_SHAPES[id]?.tone;
  for (const avatar of only) {
    if (avatar.dataset.shape !== id) {
      avatar.innerHTML = avatarMarkup(id);
      avatar.dataset.shape = id;
    }
    if (tone) avatar.dataset.tone = tone;
    else avatar.removeAttribute("data-tone");
    avatar.closest(SLOT)?.setAttribute("data-ready", "");
  }
}

let shown = "";
let lastMood = document.documentElement.dataset.mood ?? "";

function draw(): void {
  shown = currentShape();
  show(shown);
}

let frownTimer = 0;
let playTimer = 0;

function setFace(face: "frown" | "sleep" | null): void {
  for (const avatar of avatars()) {
    if (face) avatar.dataset.face = face;
    else avatar.removeAttribute("data-face");
  }
}

function setState(): void {
  const root = document.documentElement;
  const state = root.hasAttribute("data-offline")
    ? "offline"
    : root.hasAttribute("data-run")
      ? "working"
      : root.dataset.playerState === "playing"
        ? "playing"
        : null;
  for (const avatar of avatars()) {
    if (state) avatar.dataset.state = state;
    else avatar.removeAttribute("data-state");
  }
  // A frown is a moment, not a state: it yields to sleep and returns to the plain face after.
  if (state === "offline") setFace("sleep");
  else if (!frownTimer) setFace(null);
}

function play(kind: string, ms = ONE_SHOT_MS, only = avatars()): void {
  window.clearTimeout(playTimer);
  for (const avatar of only) {
    avatar.removeAttribute("data-play");
    // A reflow between the two writes lets the same one-shot play again straight away.
    void avatar.offsetWidth;
    avatar.dataset.play = kind;
  }
  playTimer = window.setTimeout(() => {
    for (const avatar of only) avatar.removeAttribute("data-play");
  }, ms);
}

function frown(): void {
  play("shake");
  setFace("frown");
  window.clearTimeout(frownTimer);
  frownTimer = window.setTimeout(() => {
    frownTimer = 0;
    setState();
  }, FROWN_MS);
}

let taps = 0;
let busy = false;
let queued = false;
let tapped: HTMLElement | undefined;
let actTimers: number[] = [];

/** Ends a show now (a new mood, a new page) and leaves the plain face. */
function cancelAct(): void {
  for (const timer of actTimers) window.clearTimeout(timer);
  actTimers = [];
  busy = false;
  queued = false;
  stopAct(avatars());
}

function later(ms: number, fn: () => void): void {
  actTimers.push(window.setTimeout(fn, ms));
}

function hue(): number {
  return Number.parseFloat(rootStyle("--hue-shift")) || 0;
}

/** A show is over: a tap that came while it ran plays the next show after a breath. */
function finish(): void {
  const again = queued;
  cancelAct();
  // The return swap of a morph runs on a frame: a hidden tab may not have run it, so draw home here.
  draw();
  setState();
  if (again) later(tokenMs("--duration-state"), () => react(tapped));
}

/**
 * The show of one tap (avatarFace.ts): none offline or when the reader asked for calm. A tap during a
 * show is kept (one, not a pile) and plays when it ends, so no show is cut off and none restarts cold.
 * A tap plays on the avatar that was tapped alone; a new pick (no target) plays on every avatar.
 */
function react(target?: HTMLElement): void {
  if (calm.matches || document.documentElement.hasAttribute("data-offline")) return;
  if (avatars().length === 0) return;
  if (busy) {
    queued = true;
    tapped = target;
    return;
  }
  busy = true;
  tapped = target;
  const actors = () => (target ? [target].filter((el) => el.isConnected) : avatars());
  const kind = pickReaction(tokenWords(rootStyle("--av-plays")), hue(), taps);
  const home = currentShape();
  const [other] = morphPath(offeredShapes(), home, hue(), taps);
  taps += 1;
  const ms = playAct(kind, actors, home, other === home ? undefined : other, (id) =>
    show(id, actors()),
  );
  play(kind, ms, actors());
  later(ms, finish);
}

function onTap(event: MouseEvent): void {
  const avatar = (event.target as Element | null)?.closest?.<HTMLElement>(`${SLOT} > *`);
  if (!avatar?.querySelector("svg")) return;
  if (!avatar.closest("a")) {
    react(avatar);
    return;
  }
  // The app bar holds the link to the profile: the show starts at once and goes on in the same avatar
  // across the page change (AccountSlot persists it). The profile's own avatar stays still.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  react(avatar);
}

let idleTimer = 0;
const calm = matchMedia("(prefers-reduced-motion: reduce)");

function scheduleIdle(): void {
  window.clearTimeout(idleTimer);
  if (calm.matches) return;
  idleTimer = window.setTimeout(
    () => {
      const root = document.documentElement;
      // Only a quiet avatar fidgets: not while it plays, works or sleeps, nor on a page nobody sees.
      if (document.visibilityState === "visible" && !root.hasAttribute("data-offline")) {
        const still = avatars().every((a) => !a.dataset.play && !a.dataset.state);
        if (still) play(IDLE_PLAYS[Math.floor(Math.random() * IDLE_PLAYS.length)] ?? "blink");
      }
      scheduleIdle();
    },
    IDLE_MIN_MS + Math.random() * IDLE_SPAN_MS,
  );
}

/** Turns a mood's name into the drawn shape on a page: also after the router swapped the document. */
function sync(): void {
  // A show a tap started in the app bar goes on through the page change.
  if (!busy) cancelAct();
  draw();
  setState();
}

export function installAccountAvatar(): void {
  sync();
  // The router brings a fresh document with the server's cookie: drawn before it is first painted.
  document.addEventListener("astro:after-swap", sync);
  document.addEventListener("astro:page-load", sync);
  // A new mood changes the shapes; the other attributes change only what the avatar is doing.
  new MutationObserver((changes) => {
    // The router writes the attribute again on every page change: only a new mood ends a show.
    const mood = document.documentElement.dataset.mood ?? "";
    if (changes.some((change) => change.attributeName === "data-mood") && mood !== lastMood) {
      lastMood = mood;
      cancelAct();
      draw();
    }
    setState();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-mood", "data-offline", "data-run", "data-player-state"],
  });
  getPreferences().subscribe(() => {
    const before = shown;
    cancelAct();
    draw();
    // A new pick answers with a show of its own.
    if (before && shown !== before) later(tokenMs("--duration-state"), react);
  });
  document.addEventListener("click", onTap);
  document.addEventListener("singularity:sound", (event) => {
    const cue = (event as CustomEvent<string>).detail;
    if (cue === "success") play("hop");
    else if (cue === "failure") frown();
  });
  window.addEventListener("singularity:saved", () => play("wiggle"));
  window.addEventListener("online", () => play("hop"));
  scheduleIdle();
  calm.addEventListener("change", scheduleIdle);
}
