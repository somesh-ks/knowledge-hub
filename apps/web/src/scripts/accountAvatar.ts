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
 */
import { AVATAR_SHAPES, avatarMarkup, moodShapes } from "../design-system/avatar";
import { getPreferences } from "../player/core/preferences";

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

function draw(): void {
  const id = currentShape();
  const tone = AVATAR_SHAPES[id]?.tone;
  for (const avatar of avatars()) {
    if (avatar.dataset.shape !== id) {
      avatar.innerHTML = avatarMarkup(id);
      avatar.dataset.shape = id;
    }
    if (tone) avatar.dataset.tone = tone;
    else avatar.removeAttribute("data-tone");
    avatar.closest(SLOT)?.setAttribute("data-ready", "");
  }
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

function play(kind: string): void {
  window.clearTimeout(playTimer);
  for (const avatar of avatars()) {
    avatar.removeAttribute("data-play");
    // A reflow between the two writes lets the same one-shot play again straight away.
    void avatar.offsetWidth;
    avatar.dataset.play = kind;
  }
  playTimer = window.setTimeout(() => {
    for (const avatar of avatars()) avatar.removeAttribute("data-play");
  }, ONE_SHOT_MS);
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
  draw();
  setState();
}

export function installAccountAvatar(): void {
  sync();
  // The router brings a fresh document with the server's cookie: drawn before it is first painted.
  document.addEventListener("astro:after-swap", sync);
  document.addEventListener("astro:page-load", sync);
  new MutationObserver(sync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-style", "data-offline", "data-run", "data-player-state"],
  });
  getPreferences().subscribe(draw);
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
