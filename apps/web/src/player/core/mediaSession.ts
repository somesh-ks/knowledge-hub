/**
 * Media Session: the lock screen, the notification shade and headset buttons. Everything is
 * feature-detected, because the API is absent in some browsers and in tests.
 *
 * iOS drops handlers now and then, so they are registered again every time the page becomes
 * visible (build-plan 8.4). Position state is kept in sync so the lock-screen scrubber works.
 */
import { longDateFromDigestId, monthLabelFromDate } from "./formatTime";
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
}

export function trackMetadata(track: Track): MediaMetadataInit {
  const { digest } = track;
  return {
    title: digest.title || longDateFromDigestId(digest.id),
    artist: "Singularity",
    album: monthLabelFromDate(digest.date),
    artwork: [
      { src: digest.cover.src512, sizes: "512x512", type: "image/png" },
      { src: digest.cover.src1024, sizes: "1024x1024", type: "image/png" },
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
      store.next("ui");
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
    if (!session) return;
    if (!track || !createMetadata) {
      session.metadata = null;
      return;
    }
    try {
      session.metadata = createMetadata(trackMetadata(track));
    } catch {
      session.metadata = null;
    }
  }

  function syncPosition(): void {
    if (!session) return;
    const state = store.getState();
    if (!state.track?.digest.audio || state.duration <= 0) {
      try {
        session.setPositionState();
      } catch {
        // Nothing to clear.
      }
      return;
    }
    try {
      session.setPositionState({
        duration: state.duration,
        playbackRate: state.rate,
        // setPositionState throws when the position is past the duration or negative.
        position: Math.min(Math.max(0, store.getTime()), state.duration),
      });
    } catch {
      // A transient mismatch (metadata still loading) is not worth an error.
    }
  }

  function syncPlaybackState(): void {
    if (!session) return;
    const { status } = store.getState();
    session.playbackState =
      status === "playing" || status === "loading"
        ? "playing"
        : status === "idle"
          ? "none"
          : "paused";
  }

  function onState(): void {
    const state = store.getState();
    if (state.digestId !== lastDigestId) {
      lastDigestId = state.digestId;
      syncMetadata(state.track);
    }
    syncPlaybackState();
    syncPosition();
  }

  registerHandlers();
  const offState = store.subscribe(onState);
  // Once a second is enough for a lock-screen scrubber, and every seek lands here too.
  const offSecond = store.onSecond(syncPosition);
  const offVisibility = deps.onVisibilityChange
    ? deps.onVisibilityChange(() => {
        if (!(deps.isHidden?.() ?? false)) {
          registerHandlers();
          syncPosition();
        }
      })
    : (() => {
        if (typeof document === "undefined") return () => undefined;
        const listener = (): void => {
          if (!document.hidden) {
            registerHandlers();
            syncPosition();
          }
        };
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      })();
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
