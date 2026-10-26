/**
 * The audio store. One `Audio` object, created lazily in script and never placed in the DOM, so
 * playback survives Astro ClientRouter navigations that swap the page underneath it.
 *
 * Three subscription channels, because they change at different rates and cost different amounts:
 * - subscribe: coarse state (status, item, rate, scrubbing). A few times a minute. React reads it
 *   with useSyncExternalStore, so the snapshot keeps its identity until something coarse changes.
 * - onFrame: the playhead, every animation frame while playing. Subscribers write to leaf elements.
 * - onSecond: whole-second ticks and every seek, for labels and ARIA values.
 * Semantic moments (willPlay, didPause, itemChanged, ...) go through onEvent so the sound and
 * announcement layers never have to infer intent from state diffs.
 */
import type { PlayerDigestData } from "../../types/contracts";
import { type AudioNoun, describeMediaError, describePlayRejection } from "./audioErrors";
import {
  ADVANCE_CHECK_MS,
  type AudioSources,
  audioCandidates,
  browserCanPlayType,
  type CanPlayType,
  PLAY_RESOLVE_LIMIT_MS,
  shouldFallBack,
} from "./audioSource";
import { clamp, isFiniteNumber } from "./mathUtils";
import {
  type AudioLike,
  type EventListener,
  type FrameListener,
  type ItemChangeCause,
  isPlaybackRate,
  type PauseReason,
  type PlayerError,
  type PlayerEvent,
  type PlayerState,
  type PlayerStore,
  type PlayReason,
  type StateListener,
  type Track,
} from "./playerTypes";
import {
  clearResumePosition,
  readResumePosition,
  type StorageLike,
  saveResumePosition,
} from "./resume";
import { buildTimeline, findItemIndexById, itemIndexAt, sectionIndexOfItem } from "./timeline";

/** A buffering spinner that appears instantly flashes on every fast load, so it waits. */
export const BUFFERING_DELAY_MS = 300;
export const RESUME_SAVE_INTERVAL_MS = 5000;
/** A shorter file is not a recording: the silence the first tap loads to unlock the element is 0.05 s. */
const MIN_RECORDING_SECONDS = 1;
/** Past this many seconds into an item, "previous" restarts it, like every audio player. */
export const PREVIOUS_RESTART_SECONDS = 3;
/**
 * Our own pause() reaches the element's `pause` event a task later. Inside this window a pause
 * event is ours; outside it, the system did it (a call, an alarm, headphones unplugged).
 */
const EXPECTED_PAUSE_WINDOW_MS = 1000;
const HAVE_NOTHING = 0;
const HAVE_FUTURE_DATA = 3;

export interface PlayerStoreOptions {
  createAudio: () => AudioLike;
  storage: StorageLike | null;
  /** The default-speed preference, read when a digest loads. */
  getPreferredRate?: () => number;
  /** Persists a rate the listener chose in the player. */
  onRateChange?: (rate: number) => void;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
  isHidden?: () => boolean;
  isOnline?: () => boolean;
  /** Whether the browser plays a media type (audioSource.ts); the page's own answer by default. */
  canPlayType?: CanPlayType;
  /** Called when the page is about to be hidden or closed, so the position is saved in time. */
  onPageHide?: (callback: () => void) => () => void;
}

export const INITIAL_PLAYER_STATE: PlayerState = {
  digestId: null,
  track: null,
  status: "idle",
  availability: "preparing",
  time: 0,
  duration: 0,
  rate: 1,
  itemIndex: 0,
  sectionIndex: 0,
  scrubbing: false,
  hasStarted: false,
  buffering: false,
  interrupted: false,
  error: null,
  upNextId: null,
};

const AUDIO_EVENTS = [
  "playing",
  "pause",
  "ended",
  "waiting",
  "stalled",
  "canplay",
  "loadedmetadata",
  "durationchange",
  "timeupdate",
  "ratechange",
  "error",
] as const;

export function createPlayerStore(options: PlayerStoreOptions): PlayerStore {
  const {
    createAudio,
    storage,
    getPreferredRate = () => 1,
    onRateChange,
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (handle) => cancelAnimationFrame(handle),
    now = () => performance.now(),
    isHidden = () => typeof document !== "undefined" && document.hidden,
    isOnline = () => typeof navigator === "undefined" || navigator.onLine,
    canPlayType = browserCanPlayType(),
    onPageHide,
  } = options;

  const initialRate = isPlaybackRate(getPreferredRate()) ? getPreferredRate() : 1;
  let state: PlayerState = { ...INITIAL_PLAYER_STATE, rate: initialRate };
  let audio: AudioLike | null = null;
  let track: Track | null = null;
  let pageDigest: PlayerDigestData | null = null;
  let pendingAutoplayId: string | null = null;
  /** The live playhead in seconds. State carries a snapshot; this is the truth. */
  let time = 0;
  let rate = initialRate;
  /** The listener asked for playback and has not asked for a pause. */
  let wantsPlay = false;
  // Bumped by a seek or scrub: the 2 s advance check compares positions, so it is void after one.
  let seekGeneration = 0;
  let wasPlayingBeforeScrub = false;
  let expectedPauseUntil = 0;
  let pendingStart: number | null = null;
  let attachedUrl: string | null = null;
  /** Files of this track that errored or stalled, so the next source is tried (audioSource.ts). */
  const skippedUrls = new Set<string>();
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped when the watch stops, so a play() promise that settles later arms nothing. */
  let watchToken = 0;
  let frameHandle: number | null = null;
  let saveTimer: ReturnType<typeof setInterval> | null = null;
  let bufferTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSecond = -1;
  let disposed = false;

  const stateListeners = new Set<StateListener>();
  const frameListeners = new Set<FrameListener>();
  const secondListeners = new Set<() => void>();
  const eventListeners = new Set<EventListener>();
  const audioHandlers = new Map<string, () => void>();
  let removePageHide: (() => void) | null = null;

  /* ---------------------------------------------------------------- helpers */

  function emit(event: PlayerEvent): void {
    for (const listener of eventListeners) listener(event);
  }

  function durationNow(): number {
    return state.duration > 0 ? state.duration : (track?.timeline?.durationSec ?? 0);
  }

  /**
   * Applies a coarse change. The snapshot keeps its identity unless a coarse field changed, so a
   * seek inside an item does not re-render React. Item and section are derived from the playhead.
   */
  function commit(patch: Partial<PlayerState>, cause: ItemChangeCause = "auto"): boolean {
    const timeline = track?.timeline ?? null;
    const itemIndex = itemIndexAt(timeline, time);
    const sectionIndex = sectionIndexOfItem(timeline, itemIndex);
    const next: PlayerState = { ...state, ...patch, itemIndex, sectionIndex };
    const keys = Object.keys(next) as (keyof PlayerState)[];
    const changed = keys.some((key) => key !== "time" && next[key] !== state[key]);
    if (!changed) return false;
    const previous = state;
    state = { ...next, time };
    for (const listener of stateListeners) listener(state, previous);
    const itemChanged = timeline !== null && previous.itemIndex !== itemIndex;
    if (itemChanged && cause !== "load") emit({ type: "itemChanged", index: itemIndex, cause });
    return itemChanged;
  }

  function readAudioTime(): void {
    if (!audio) return;
    // Until the header is read the element reports 0, and iOS keeps it at 0 until the first play
    // whatever `preload` says. That is not the playhead, and saving it would erase the position
    // that is waiting to be restored.
    if (pendingStart !== null || audio.readyState === HAVE_NOTHING) return;
    const current = audio.currentTime;
    if (isFiniteNumber(current)) time = clamp(current, 0, durationNow() || current);
  }

  function publishTime(cause: ItemChangeCause, forceSecond: boolean): void {
    if (state.itemIndex !== itemIndexAt(track?.timeline ?? null, time)) commit({}, cause);
    const duration = durationNow();
    for (const listener of frameListeners) listener(time, duration);
    const whole = Math.floor(time);
    if (forceSecond || whole !== lastSecond) {
      lastSecond = whole;
      for (const listener of secondListeners) listener();
    }
  }

  function expectPause(): void {
    expectedPauseUntil = now() + EXPECTED_PAUSE_WINDOW_MS;
  }

  function applyRate(): void {
    if (!audio) return;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    // Speech at 1.5x without pitch correction sounds like a chipmunk, so this stays on.
    audio.preservesPitch = true;
    if ("webkitPreservesPitch" in audio) audio.webkitPreservesPitch = true;
  }

  /* ---------------------------------------------------------------- timers */

  function stopFrameLoop(): void {
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
  }

  function frame(): void {
    frameHandle = null;
    if (state.status !== "playing" || state.scrubbing) return;
    readAudioTime();
    publishTime("auto", false);
    frameHandle = requestFrame(frame);
  }

  function startFrameLoop(): void {
    if (frameHandle !== null) return;
    frameHandle = requestFrame(frame);
  }

  function saveResume(): void {
    if (!track) return;
    readAudioTime();
    saveResumePosition(storage, track.digest.id, time, durationNow());
  }

  function startSaveTimer(): void {
    if (saveTimer !== null) return;
    saveTimer = setInterval(saveResume, RESUME_SAVE_INTERVAL_MS);
  }

  function stopSaveTimer(): void {
    if (saveTimer !== null) clearInterval(saveTimer);
    saveTimer = null;
  }

  function stopTimers(): void {
    stopFrameLoop();
    stopSaveTimer();
    stopBufferTimer();
    stopFallbackWatch();
  }

  function stopBufferTimer(): void {
    if (bufferTimer !== null) clearTimeout(bufferTimer);
    bufferTimer = null;
  }

  /** The spinner and the "Preparing audio" label wait, so a buffered source never flashes them. */
  function armBufferingTimer(): void {
    if (bufferTimer !== null || state.buffering) return;
    bufferTimer = setTimeout(() => {
      bufferTimer = null;
      if (state.status === "loading") commit({ buffering: true });
    }, BUFFERING_DELAY_MS);
  }

  function enterLoading(): void {
    commit({ status: "loading" });
    armBufferingTimer();
  }

  /* ---------------------------------------------------------------- audio events */

  function onPlaying(): void {
    if (!wantsPlay && !state.scrubbing) {
      // The element started on its own: a source swap, or Android resuming after a call. The
      // listener's last word was "not playing", and the interface says so, so the element obeys.
      expectPause();
      audio?.pause();
      return;
    }
    stopBufferTimer();
    commit({
      status: "playing",
      hasStarted: true,
      buffering: false,
      interrupted: false,
      error: null,
    });
    if (!state.scrubbing) {
      startFrameLoop();
      startSaveTimer();
    }
  }

  function onPause(): void {
    if (!audio || audio.ended) return;
    if (now() < expectedPauseUntil) {
      // Ours, and already accounted for. Consuming the window keeps a real interruption that
      // follows within a second from being mistaken for it.
      expectedPauseUntil = 0;
      return;
    }
    stopFrameLoop();
    stopSaveTimer();
    // Not ours: a call, an alarm, a Bluetooth disconnect. Remember it and offer resume. Resuming
    // on our own would talk over the call that just ended or wake a sleeping person.
    if (state.status !== "playing" && state.status !== "loading") return;
    readAudioTime();
    wantsPlay = false;
    stopBufferTimer();
    saveResume();
    commit({ status: "paused", buffering: false, interrupted: true });
    emit({ type: "interrupted" });
    publishTime("auto", true);
  }

  function onEnded(): void {
    if (!track) return;
    stopTimers();
    wantsPlay = false;
    time = durationNow();
    clearResumePosition(storage, track.digest.id);
    commit({ status: "ended", buffering: false, upNextId: track.digest.prev_id });
    publishTime("auto", true);
    emit({ type: "ended" });
  }

  function onWaiting(): void {
    if (!wantsPlay || state.scrubbing) return;
    if (state.status === "playing") {
      stopFrameLoop();
      enterLoading();
    }
  }

  /** `stalled` means the fetch went quiet, which is only a problem when the buffer has run dry. */
  function onStalled(): void {
    if (audio && audio.readyState < HAVE_FUTURE_DATA) onWaiting();
  }

  function onCanPlay(): void {
    if (!audio || !wantsPlay || audio.paused || state.scrubbing) return;
    if (state.status === "loading") onPlaying();
  }

  function onLoadedMetadata(): void {
    if (!audio) return;
    const duration = audio.duration;
    // Under a second is the unlock primer's silence (0.05 s), which a tap loads so the phone lets the
    // element start later. It is no recording: its length must not become the track's.
    if (isFiniteNumber(duration) && duration >= MIN_RECORDING_SECONDS) {
      if (pendingStart !== null) {
        const start = clamp(pendingStart, 0, duration);
        pendingStart = null;
        try {
          audio.currentTime = start;
        } catch {
          // Some engines throw before the first frame is ready. The time stays in the store.
        }
      }
      commit({ duration });
    }
  }

  function onTimeUpdate(): void {
    // The animation loop is the primary clock. timeupdate carries on while the tab is hidden, when
    // frames stop, so the lock-screen position and the saved position keep moving.
    if (!audio || state.scrubbing) return;
    // The element is playing with data in hand but no `playing` event is coming (a stall that
    // cleared on its own), so the clock is the proof.
    if (
      state.status === "loading" &&
      wantsPlay &&
      !audio.paused &&
      audio.readyState >= HAVE_FUTURE_DATA
    ) {
      onPlaying();
    }
    if (state.status !== "playing") return;
    if (frameHandle === null || isHidden()) {
      readAudioTime();
      publishTime("auto", false);
    }
  }

  function onAudioRateChange(): void {
    if (audio && audio.playbackRate !== rate) applyRate();
  }

  /** What the error copy calls the recording: an episode carries its script. */
  function audioNoun(): AudioNoun {
    return track?.digest.turns ? "episode" : "briefing";
  }

  function onError(): void {
    if (!audio) return;
    if (state.status === "playing" || state.status === "loading") {
      readAudioTime();
      publishTime("auto", true);
    }
    if (fallBack()) return;
    const error = describeMediaError(audio.error?.code, isOnline(), audioNoun());
    if (!error) return;
    // A file the narration could not make says why; offline, the connection is the reason. The
    // browser's own MediaError.message is debug text and is never used.
    const narrated = audio.error?.narrated;
    if (narrated && isOnline()) {
      error.message = narrated.message;
      if (narrated.summary) error.summary = narrated.summary;
      if (narrated.standing) error.kind = "refused";
    }
    // The playhead is where the element failed, not where the last frame left it: a story whose
    // file could not be made fails at its start, while the last frame is still in the tail of the
    // story before. A retry from that tail would play it again before it was refused again.
    if (state.status === "playing" || state.status === "loading") {
      readAudioTime();
      publishTime("auto", true);
    }
    fail(error);
  }

  /** Playback stopped short: the listener is told why, once. A blocked start is only paused. */
  function fail(error: PlayerError): void {
    stopTimers();
    wantsPlay = false;
    commit({ status: error.kind === "blocked" ? "paused" : "error", buffering: false, error });
    emit({ type: "error", error });
  }

  function ensureAudio(): AudioLike {
    if (audio) return audio;
    const created = createAudio();
    created.preload = "metadata";
    audio = created;
    applyRate();
    const handlers: Record<(typeof AUDIO_EVENTS)[number], () => void> = {
      playing: onPlaying,
      pause: onPause,
      ended: onEnded,
      waiting: onWaiting,
      stalled: onStalled,
      canplay: onCanPlay,
      loadedmetadata: onLoadedMetadata,
      durationchange: onLoadedMetadata,
      timeupdate: onTimeUpdate,
      ratechange: onAudioRateChange,
      error: onError,
    };
    for (const type of AUDIO_EVENTS) {
      const handler = handlers[type];
      audioHandlers.set(type, handler);
      created.addEventListener(type, handler);
    }
    return created;
  }

  /* ---------------------------------------------------------------- loading */

  /**
   * The file of this track's narration the browser plays. Offline it is the MP3, the file a download
   * saves (lib/downloads.ts); online, the smallest the browser can decode.
   */
  function sourceOf(audio: AudioSources): string {
    if (!isOnline()) return audio.url;
    return audioCandidates(audio, canPlayType).find((url) => !skippedUrls.has(url)) ?? audio.url;
  }

  /** The source after the one attached, or undefined when it is the last. */
  function nextSource(): string | undefined {
    const files = track?.digest.audio;
    if (!files || !attachedUrl || !isOnline()) return undefined;
    return audioCandidates(files, canPlayType).find(
      (url) => url !== attachedUrl && !skippedUrls.has(url),
    );
  }

  function clearFallbackTimer(): void {
    if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }

  function stopFallbackWatch(): void {
    watchToken += 1;
    clearFallbackTimer();
  }

  /**
   * Gives up the attached file for the next one at the same position: it errored, play() never
   * resolved, or the clock never moved (shouldFallBack). The media session reads the store, so it
   * follows. Returns false when this is the last file.
   */
  function fallBack(): boolean {
    const next = nextSource();
    if (!next || !attachedUrl) return false;
    const wasWanted = wantsPlay;
    skippedUrls.add(attachedUrl);
    stopFallbackWatch();
    if (!wasWanted) {
      pendingStart = time > 0 ? time : null;
      attachedUrl = null;
      attachSource(next);
      return true;
    }
    retryAs("resume");
    return true;
  }

  /** Watches a started play() for the two silent failures: it never resolves, or it resolves and the clock stays. */
  function watchPlayStart(element: AudioLike, started: Promise<unknown>): void {
    stopFallbackWatch();
    const watched = attachedUrl;
    if (!nextSource()) return;
    const token = watchToken;
    const stale = () => attachedUrl !== watched || !wantsPlay || token !== watchToken;
    let resolved = false;
    fallbackTimer = setTimeout(() => {
      if (stale() || resolved) return;
      if (
        shouldFallBack({
          errored: false,
          playResolved: false,
          sincePlayMs: PLAY_RESOLVE_LIMIT_MS,
          sinceResolveMs: null,
          advancedSec: 0,
        })
      )
        fallBack();
    }, PLAY_RESOLVE_LIMIT_MS);
    started.then(
      () => {
        if (stale()) return;
        resolved = true;
        clearFallbackTimer();
        const from = element.currentTime;
        const generation = seekGeneration;
        fallbackTimer = setTimeout(() => {
          if (stale() || generation !== seekGeneration) return;
          const advancedSec = element.currentTime - from;
          if (
            shouldFallBack({
              errored: false,
              playResolved: true,
              sincePlayMs: ADVANCE_CHECK_MS,
              sinceResolveMs: ADVANCE_CHECK_MS,
              advancedSec,
            })
          )
            fallBack();
        }, ADVANCE_CHECK_MS);
      },
      () => undefined,
    );
  }

  function attachSource(url: string): void {
    const element = ensureAudio();
    if (attachedUrl === url) return;
    attachedUrl = url;
    expectPause();
    element.src = url;
    element.preload = "metadata";
    applyRate();
  }

  function releaseSource(): void {
    attachedUrl = null;
    if (!audio) return;
    expectPause();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  function load(digest: PlayerDigestData): void {
    if (disposed) return;
    const sameDigest = track?.digest.id === digest.id;
    const sameAudio = track?.digest.audio?.url === digest.audio?.url;
    if (sameDigest && sameAudio) {
      // The same briefing again (a navigation back to its page). Refresh the data, keep playing.
      const timeline = buildTimeline(digest);
      track = { digest, timeline };
      commit({ track, duration: state.duration || (timeline?.durationSec ?? 0) });
      return;
    }

    if (track) saveResume();
    stopTimers();
    skippedUrls.clear();
    wantsPlay = false;
    wasPlayingBeforeScrub = false;

    const timeline = buildTimeline(digest);
    const duration = timeline?.durationSec ?? 0;
    const restored = readResumePosition(storage, digest.id, duration);
    time = restored;
    pendingStart = restored > 0 ? restored : null;
    track = { digest, timeline };
    rate = isPlaybackRate(getPreferredRate()) ? getPreferredRate() : 1;

    // No audio is fetched until the listener presses play (2026-10-26: the weekly MP3, 7.6 MiB,
    // downloaded on every page view and woke download managers). The duration comes from the
    // timeline; the play paths attach the source themselves. A source of the track before this one
    // is let go.
    if (!digest.audio || attachedUrl !== sourceOf(digest.audio)) releaseSource();
    if (digest.audio) ensureAudio();
    applyRate();

    lastSecond = -1;
    commit(
      {
        digestId: digest.id,
        track,
        status: "idle",
        availability: digest.audio ? "ready" : "preparing",
        duration,
        rate,
        scrubbing: false,
        buffering: false,
        interrupted: false,
        error: null,
        upNextId: null,
      },
      "load",
    );
    emit({ type: "loaded", digestId: digest.id });
    publishTime("load", true);
  }

  function setPageDigest(digest: PlayerDigestData | null): void {
    if (disposed) return;
    pageDigest = digest;
    if (!digest) return;
    const isCurrent = track?.digest.id === digest.id;
    // Follow the page until the listener has played something. After that, the playing track stays
    // until the listener picks another digest.
    if (!track || isCurrent || state.status === "idle") load(digest);
    if (pendingAutoplayId === digest.id) {
      pendingAutoplayId = null;
      if (track?.digest.id !== digest.id) load(digest);
      play("user");
    }
  }

  /* ---------------------------------------------------------------- transport */

  function hasAudio(): boolean {
    return Boolean(track?.digest.audio);
  }

  function startPlayback(reason: PlayReason): void {
    const element = ensureAudio();
    const audioFiles = track?.digest.audio;
    if (!audioFiles) return;
    const url = sourceOf(audioFiles);
    // Attaching a source can pause the element, but that is settled by now. A pause of our own
    // that is still on its way (K then Space in quick succession: the element delivers the event
    // after play() was called again) keeps its window; only the one attaching just opened closes.
    const pendingWindow = expectedPauseUntil;
    attachSource(url);
    expectedPauseUntil = pendingWindow;
    if (state.status === "ended") seekInternal(0, "seek");
    wantsPlay = true;
    // The cue first, so it lands in silence; then the audio.
    emit({ type: "willPlay", reason });
    commit({ status: "loading", hasStarted: true, interrupted: false, error: null });
    const started = Promise.resolve(element.play());
    watchPlayStart(element, started);
    started.catch((rejection: unknown) => {
      // A fallback replaced the file: the old play() rejecting is not this one failing.
      if (attachedUrl !== url) return;
      const error = describePlayRejection(rejection, isOnline(), audioNoun());
      // The element's own error event may have reported this failure already: once is enough.
      if (!error || state.status === "error") return;
      fail(error);
    });
    armBufferingTimer();
  }

  function play(reason: PlayReason = "user"): void {
    if (disposed || !hasAudio()) return;
    if (state.status === "playing" || state.status === "loading") return;
    if (state.status === "error") {
      // Offline the browser already knows the file cannot be fetched: the reason is told again,
      // with nothing loaded and no Pause shown on the way.
      if (state.error?.kind === "offline" && !isOnline()) {
        fail({ ...state.error });
        return;
      }
      // Every failure is tried again from where the playhead is. In a refusal that stands, a story
      // whose file is made plays; one that needs a new file is refused again at once by the
      // narration's queue, which sends nothing, and the same reason is told again.
      retryAs(reason);
      return;
    }
    startPlayback(reason);
  }

  function pause(reason: PauseReason = "user"): void {
    if (!audio) return;
    if (state.status !== "playing" && state.status !== "loading") return;
    wantsPlay = false;
    // A scrub that was going to resume playback must not undo this pause when it ends.
    wasPlayingBeforeScrub = false;
    stopTimers();
    readAudioTime();
    expectPause();
    audio.pause();
    commit({ status: "paused", buffering: false });
    saveResume();
    publishTime("auto", true);
    // After the pause, so the cue is not skipped by the narration policy.
    emit({ type: "didPause", reason });
  }

  function toggle(): void {
    if (state.status === "playing" || state.status === "loading") pause("user");
    else play("user");
  }

  /** A retry is announced as what asked for it: a step or a row says its story, not "Playing.". */
  function retryAs(reason: PlayReason): void {
    if (!track?.digest.audio) return;
    const url = sourceOf(track.digest.audio);
    // A failed element keeps its error until the source is set again.
    attachedUrl = null;
    pendingStart = time > 0 ? time : null;
    commit({ status: "idle", error: null });
    attachSource(url);
    startPlayback(reason);
  }

  function retry(): void {
    retryAs("user");
  }

  function seekInternal(seconds: number, cause: ItemChangeCause): boolean {
    const duration = durationNow();
    const target = clamp(seconds, 0, duration > 0 ? duration : Math.max(0, seconds));
    time = target;
    seekGeneration += 1;
    if (audio && hasAudio()) {
      if (audio.readyState === HAVE_NOTHING) {
        // Setting currentTime before metadata is unreliable on iOS. Apply it on loadedmetadata.
        pendingStart = target;
      } else {
        try {
          audio.currentTime = target;
        } catch {
          pendingStart = target;
        }
      }
    }
    const patch: Partial<PlayerState> = {};
    if (state.status === "ended" && target < duration - 0.5) {
      patch.status = "paused";
      patch.upNextId = null;
    }
    const itemChanged = commit(patch, cause);
    publishTime(cause, true);
    return itemChanged;
  }

  function seekTo(ms: number): void {
    if (!isFiniteNumber(ms)) return;
    seekInternal(ms / 1000, "seek");
  }

  function skipToItem(index: number, cause: ItemChangeCause): boolean {
    const item = track?.timeline?.items[index];
    if (!item) return false;
    const changed = seekInternal(item.startSec, cause);
    // A restart of the same item changes nothing derived, but it is still something the
    // listener did and the cue should confirm.
    if (!changed) emit({ type: "itemChanged", index, cause });
    return true;
  }

  function playItemAt(index: number): void {
    const item = track?.timeline?.items[index];
    if (!item) return;
    seekInternal(item.startSec, "select");
    if (state.status !== "playing" && state.status !== "loading") play("item");
  }

  function playItem(id: string): void {
    const index = findItemIndexById(track?.timeline ?? null, id);
    if (index >= 0) playItemAt(index);
  }

  /**
   * A story step. From the end or a failure nothing is playing, so the step plays the story it lands
   * on, as a tap on its row does (a failure is cleared by that play's retry); otherwise it only moves.
   */
  function step(move: () => boolean): boolean {
    const stopped = state.status === "ended" || state.status === "error";
    const moved = move();
    if (moved && stopped) play("item");
    return moved;
  }

  function next(source: "ui" | "keyboard" = "ui"): boolean {
    return step(() =>
      skipToItem(state.itemIndex + 1, source === "keyboard" ? "keyboard" : "skip-next"),
    );
  }

  function previous(source: "ui" | "keyboard" = "ui"): boolean {
    return step(() => stepBack(source));
  }

  function stepBack(source: "ui" | "keyboard"): boolean {
    const items = track?.timeline?.items;
    const first = items?.[0];
    if (!items || !first) return false;
    const cause = source === "keyboard" ? "keyboard" : "skip-previous";
    // Before the first story (an episode's rundown) Previous goes back to the very start.
    const toLeadIn = (): boolean => {
      if (time <= 0) return false;
      if (!seekInternal(0, cause)) emit({ type: "itemChanged", index: -1, cause });
      return true;
    };
    const current = items[state.itemIndex];
    if (!current) return state.itemIndex < 0 ? toLeadIn() : false;
    const restart = time - current.startSec > PREVIOUS_RESTART_SECONDS;
    if (restart) return skipToItem(state.itemIndex, cause);
    if (state.itemIndex > 0) return skipToItem(state.itemIndex - 1, cause);
    return first.startSec > 0 ? toLeadIn() : skipToItem(0, cause);
  }

  function skip(deltaSeconds: number): void {
    seekInternal(time + deltaSeconds, "seek");
  }

  function setRate(requested: number): void {
    if (!isPlaybackRate(requested) || requested === rate) return;
    rate = requested;
    applyRate();
    commit({ rate });
    onRateChange?.(requested);
    emit({ type: "rateChanged", rate: requested });
  }

  /* ---------------------------------------------------------------- scrubbing */

  function beginScrub(): void {
    if (state.scrubbing || !hasAudio()) return;
    seekGeneration += 1;
    wasPlayingBeforeScrub = state.status === "playing" || state.status === "loading";
    // Narration pauses while the thumb is down, so a drag never produces audio bursts or a storm
    // of range requests. The status stays "playing" so the controls do not flicker.
    stopFrameLoop();
    stopBufferTimer();
    // The paused element would read as a stalled start: the monitor restarts when the scrub ends.
    stopFallbackWatch();
    if (audio && wasPlayingBeforeScrub) {
      expectPause();
      audio.pause();
    }
    commit({ scrubbing: true, buffering: false });
  }

  function scrubTo(seconds: number): void {
    if (!state.scrubbing) return;
    time = clamp(seconds, 0, durationNow() || seconds);
    publishTime("scrub", false);
  }

  function endScrub(seconds: number): void {
    if (!state.scrubbing) return;
    const resume = wasPlayingBeforeScrub;
    wasPlayingBeforeScrub = false;
    commit({ scrubbing: false });
    seekInternal(seconds, "scrub");
    if (resume && audio) {
      // The status never left "playing", so the controls did not flicker. The element's own
      // playing event restarts the frame loop; a seek that needs data raises waiting.
      wantsPlay = true;
      const started = Promise.resolve(audio.play());
      watchPlayStart(audio, started);
      started.catch((rejection: unknown) => {
        const error = describePlayRejection(rejection, isOnline(), audioNoun());
        if (!error || state.status === "error") return;
        fail(error);
      });
    }
  }

  /* ---------------------------------------------------------------- lifecycle */

  if (onPageHide) removePageHide = onPageHide(saveResume);

  function dispose(): void {
    disposed = true;
    stopTimers();
    if (audio) {
      for (const [type, handler] of audioHandlers) audio.removeEventListener(type, handler);
      audioHandlers.clear();
      audio.pause();
      audio.removeAttribute("src");
      audio = null;
    }
    removePageHide?.();
    removePageHide = null;
    stateListeners.clear();
    frameListeners.clear();
    secondListeners.clear();
    eventListeners.clear();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    onFrame(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    onSecond(listener) {
      secondListeners.add(listener);
      return () => secondListeners.delete(listener);
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    getTime: () => time,
    isNarrating: () => state.status === "playing" && !state.scrubbing,
    getPageDigest: () => pageDigest,
    setPageDigest,
    load,
    play,
    pause,
    toggle,
    seekTo,
    playItem,
    playItemAt,
    next,
    previous,
    skip,
    setRate,
    beginScrub,
    scrubTo,
    endScrub,
    itemAt: (seconds) => itemIndexAt(track?.timeline ?? null, seconds),
    retry,
    playWhenPageLoads(digestId) {
      if (pageDigest?.id === digestId) {
        if (track?.digest.id !== digestId) load(pageDigest);
        play("user");
        return;
      }
      pendingAutoplayId = digestId;
    },
    dispose,
  };
}
