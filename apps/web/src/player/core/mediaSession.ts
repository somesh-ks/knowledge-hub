/**
 * Media Session: the lock screen, the notification shade and headset buttons. Everything is
 * feature-detected, because the API is absent in some browsers and in tests.
 *
 * iOS drops handlers now and then, so they are registered again every time the page becomes
 * visible (build-plan 8.4). Position state is kept in sync so the lock-screen scrubber works.
 */
import { longDateFromDigestId, monthLabelFromDate } from "./formatTime";
import { isPlayingStatus } from "./playerCopy";
import {
  type PlayerStore,
  SKIP_BACK_SECONDS,
  SKIP_FORWARD_SECONDS,
  type Track,
} from "./playerTypes";

type ActionName =
  | "play"
  | "pause"
  | "seekbackward"
  | "seekforward"
  | "seekto"
  | "previoustrack"
  | "nexttrack";

export interface MediaSessionLike {
  metadata: MediaMetadata | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void;
  setPositionState(state?: MediaPositionState): void;
}

export interface MediaSessionDeps {
  /** The session, or null where the API does not exist. */
  session?: MediaSessionLike | null;
  createMetadata?: (init: MediaMetadataInit) => MediaMetadata;
  onVisibilityChange?: (callback: () => void) => () => void;
  isHidden?: () => boolean;
  /** Next on the last story: the queue, or else the suggested item, starts. */
  onNextPastEnd?: () => void;
}

/** The PNG beside a cover's WebP. */
export function asPng(src: string): string {
  return src.replace(/\.webp$/, ".png");
}

export function trackMetadata(track: Track): MediaMetadataInit {
  const { digest } = track;
  return {
    title: digest.title || longDateFromDigestId(digest.id),
    artist: "Singularity",
    album: monthLabelFromDate(digest.date),
    // The lock screen gets the PNG beside each WebP cover: not every system's media controls
    // decode WebP, and the pages never ask for these files.
    artwork: [
      { src: asPng(digest.cover.src512), sizes: "512x512", type: "image/png" },
      { src: asPng(digest.cover.src1024), sizes: "1024x1024", type: "image/png" },
    ],
  };
}

function defaultSession(): MediaSessionLike | null {
  return typeof navigator !== "undefined" && "mediaSession" in navigator
    ? navigator.mediaSession
    : null;
}

/** Wires the store to Media Session. Returns a function that clears and unwires everything. */
export function attachMediaSession(store: PlayerStore, deps: MediaSessionDeps = {}): () => void {
  const session = deps.session === undefined ? defaultSession() : deps.session;
  if (!session) return () => undefined;
  const media: MediaSessionLike = session;
  const createMetadata =
    deps.createMetadata ??
    (typeof MediaMetadata === "undefined" ? null : (init) => new MediaMetadata(init));

  let lastDigestId: string | null = null;

  function setHandler(action: ActionName, handler: MediaSessionActionHandler | null): void {
    try {
      session?.setActionHandler(action, handler);
    } catch {
      // A browser that knows the API may not know every action.
    }
  }

  const handlers: Record<ActionName, MediaSessionActionHandler> = {
    play: () => store.play("user"),
    pause: () => store.pause("user"),
    // The system may name its own offset; otherwise these match the transport's two buttons.
    seekbackward: (details) => store.skip(-(details.seekOffset ?? SKIP_BACK_SECONDS)),
    seekforward: (details) => store.skip(details.seekOffset ?? SKIP_FORWARD_SECONDS),
    seekto: (details) => {
      if (typeof details.seekTime === "number") store.seekTo(details.seekTime * 1000);
    },
    previoustrack: () => {
      store.previous("ui");
    },
    nexttrack: () => {
      if (!store.next("ui")) deps.onNextPastEnd?.();
    },
  };

  function registerHandlers(): void {
    for (const [action, handler] of Object.entries(handlers) as [
      ActionName,
      MediaSessionActionHandler,
    ][]) {
      setHandler(action, handler);
    }
  }

  function syncMetadata(track: Track | null): void {
    if (!track || !createMetadata) {
      media.metadata = null;
      return;
    }
    try {
      media.metadata = createMetadata(trackMetadata(track));
    } catch {
      media.metadata = null;
    }
  }

  function syncPosition(): void {
    const state = store.getState();
    if (!state.track?.digest.audio || state.duration <= 0) {
      try {
        media.setPositionState();
      } catch {
        // Nothing to clear.
      }
      return;
    }
    try {
      media.setPositionState({
        duration: state.duration,
        playbackRate: state.rate,
        // setPositionState throws when the position is past the duration or negative.
        position: Math.min(Math.max(0, store.getTime()), state.duration),
      });
    } catch {
      // A transient mismatch (metadata still loading) is not worth an error.
    }
  }

  function onState(): void {
    const state = store.getState();
    if (state.digestId !== lastDigestId) {
      lastDigestId = state.digestId;
      syncMetadata(state.track);
    }
    const { status } = state;
    media.playbackState = isPlayingStatus(status)
      ? "playing"
      : status === "idle"
        ? "none"
        : "paused";
    syncPosition();
  }

  registerHandlers();
  const offState = store.subscribe(onState);
  // Once a second is enough for a lock-screen scrubber, and every seek lands here too.
  const offSecond = store.onSecond(syncPosition);
  // Visible again: iOS may have dropped the handlers.
  const onVisible = (): void => {
    if (deps.onVisibilityChange ? deps.isHidden?.() : document.hidden) return;
    registerHandlers();
    syncPosition();
  };
  let offVisibility = deps.onVisibilityChange?.(onVisible);
  if (!offVisibility) {
    document.addEventListener("visibilitychange", onVisible);
    offVisibility = () => document.removeEventListener("visibilitychange", onVisible);
  }
  onState();

  return () => {
    offState();
    offSecond();
    offVisibility();
    for (const action of Object.keys(handlers) as ActionName[]) setHandler(action, null);
    session.metadata = null;
    session.playbackState = "none";
    try {
      session.setPositionState();
    } catch {
      // Already clear.
    }
  };
}
