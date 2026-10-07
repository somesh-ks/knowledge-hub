/**
 * One continuous track made of many files.
 *
 * A briefing narrated on Play arrives story by story: each story is its own short MP3, and most of
 * them do not exist yet when the first one starts. The player, though, is built around one audio
 * element with one timeline. This adapter keeps it that way. It wraps the real element and presents
 * a playlist of segments as a single piece of audio: one duration, one playhead, one `ended`.
 *
 * The timeline is fixed up front. Every segment owns a span of virtual time (its known length, or an
 * estimate from its character count), and time inside a segment is scaled to fit its span. So story
 * boundaries, scrubber ticks and the lock-screen length never move, even though an estimate is
 * rarely right to the second. The cost is a playhead that runs a few percent fast or slow inside a
 * story whose estimate was off, which nobody can see.
 *
 * With no playlist registered for a source, the adapter is a plain pass-through to the element.
 */
import type { AudioLike } from "../player/core/playerTypes";

export interface TrackSegment {
  key: string;
  /** Where the segment sits on the virtual timeline, in seconds. Fixed for the life of the track. */
  start: number;
  end: number;
  /** The file, once it exists. */
  url: string | null;
}

export interface Playlist {
  readonly segments: readonly TrackSegment[];
  /** Resolves with the segment's file, making it first when it does not exist. Rejects on failure. */
  ensure(index: number): Promise<string>;
  /** A hint that the segment is needed soon. Returns at once and never throws. */
  prepare(index: number): void;
}

export interface TrackAudioOptions {
  /** The playlist behind a source string, or null when the source is an ordinary file. */
  resolve(src: string): Playlist | null;
  /** How many segments past the current one are prepared ahead of the playhead. */
  lookAhead?: number;
}

const DEFAULT_LOOK_AHEAD = 3;
/** Element readyState values (HTMLMediaElement). */
const HAVE_METADATA = 1;
/** MediaError.MEDIA_ERR_NETWORK: the nearest standard code for "the file could not be fetched or made". */
const MEDIA_ERR_NETWORK = 2;

/** The events the player listens to. Every one is either forwarded or re-timed by the adapter. */
const FORWARDED = [
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
type AudioEvent = (typeof FORWARDED)[number];

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The segment that holds a moment of virtual time. The last segment also owns the very end. */
export function segmentIndexAt(segments: readonly TrackSegment[], seconds: number): number {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment && seconds >= segment.start) return index;
  }
  return 0;
}

export function createTrackAudio(real: AudioLike, options: TrackAudioOptions): AudioLike {
  const lookAhead = options.lookAhead ?? DEFAULT_LOOK_AHEAD;
  const listeners = new Map<string, Set<() => void>>();

  let playlist: Playlist | null = null;
  let virtualSrc = "";
  /** The segment the playhead is in. */
  let index = 0;
  /** Where in that segment to land once its file is loaded, as a share of its length. */
  let pendingShare: number | null = null;
  /** Which segment's file the element currently holds, and whether its header has been read. */
  let attachedIndex: number | null = null;
  let attachedReady = false;
  /** A file swap is under way: the element's own pause and time are not the track's. */
  let switching = false;
  let wantsPlay = false;
  let ended = false;
  let failure: { code: number } | null = null;
  /** Bumped by every start and stop, so a file that arrives late knows it was overtaken. */
  let generation = 0;

  function emit(type: AudioEvent): void {
    for (const listener of [...(listeners.get(type) ?? [])]) listener();
  }

  function emitSoon(type: AudioEvent): void {
    const owner = playlist;
    queueMicrotask(() => {
      if (playlist === owner) emit(type);
    });
  }

  function current(): TrackSegment | null {
    return playlist?.segments[index] ?? null;
  }

  function span(segment: TrackSegment): number {
    return Math.max(0, segment.end - segment.start);
  }

  function total(): number {
    const segments = playlist?.segments ?? [];
    return segments[segments.length - 1]?.end ?? 0;
  }

  function isLast(): boolean {
    return playlist !== null && index >= playlist.segments.length - 1;
  }

  /** The length of the loaded file, or the segment's span until the header says otherwise. */
  function fileSeconds(segment: TrackSegment): number {
    return isFinitePositive(real.duration) ? real.duration : span(segment);
  }

  function virtualTime(): number {
    const segment = current();
    if (!segment) return 0;
    if (ended) return total();
    const length = span(segment);
    if (attachedIndex !== index || !attachedReady || switching) {
      return segment.start + (pendingShare ?? 0) * length;
    }
    const share = clamp(real.currentTime / fileSeconds(segment), 0, 1);
    return segment.start + share * length;
  }

  function prepareAhead(): void {
    if (!playlist) return;
    const last = Math.min(playlist.segments.length - 1, index + lookAhead);
    for (let ahead = index + 1; ahead <= last; ahead += 1) playlist.prepare(ahead);
  }

  function attach(target: number, url: string): void {
    switching = true;
    attachedIndex = target;
    attachedReady = false;
    // A load resets the rate to the default, so the default must already be the rate in use.
    const rate = real.playbackRate;
    real.src = url;
    real.preload = "auto";
    real.defaultPlaybackRate = rate;
    real.playbackRate = rate;
  }

  function fail(): void {
    failure = { code: MEDIA_ERR_NETWORK };
    wantsPlay = false;
    emit("error");
  }

  /** A start the adapter made by itself (the next file, a seek) was refused by the element. */
  function onStartRefused(error: unknown): void {
    // A newer load or a pause won the race: not a failure.
    if (error instanceof Error && error.name === "AbortError") return;
    if (!wantsPlay) return;
    // The browser would not start the next file unasked (a locked phone can do this). To the player
    // that is a pause it did not ask for, and it offers to resume.
    wantsPlay = false;
    emit("pause");
  }

  function start(): void {
    startCurrent().catch(onStartRefused);
  }

  /** Plays the current segment, fetching or making its file first when needed. */
  function startCurrent(): Promise<void> {
    const list = playlist;
    const segment = current();
    if (!list || !segment) return Promise.resolve();
    generation += 1;
    const mine = generation;
    const target = index;

    if (attachedIndex === target) return real.play();
    if (segment.url) {
      attach(target, segment.url);
      return real.play();
    }

    emitSoon("waiting");
    return list.ensure(target).then(
      (url) => {
        // Overtaken by a seek, a pause, or another track: the newer call owns the element.
        if (mine !== generation || playlist !== list || !wantsPlay) return undefined;
        attach(target, url);
        return real.play();
      },
      () => {
        // Reported as an error event, which is where the player listens for a file that failed.
        if (mine === generation && playlist === list) fail();
        return undefined;
      },
    );
  }

  function seek(seconds: number): void {
    const list = playlist;
    if (!list) return;
    const target = clamp(seconds, 0, total());
    const next = segmentIndexAt(list.segments, target);
    const segment = list.segments[next];
    if (!segment) return;
    const length = span(segment);
    const share = length > 0 ? clamp((target - segment.start) / length, 0, 1) : 0;
    ended = false;
    failure = null;
    // Whatever file was on its way for the old position is no longer wanted.
    generation += 1;
    index = next;

    if (attachedIndex === next && attachedReady && !switching) {
      pendingShare = null;
      real.currentTime = share * fileSeconds(segment);
      if (wantsPlay && real.paused) start();
      return;
    }
    pendingShare = share;
    // Paused: nothing is fetched until play, but the file can be made ready in the meantime.
    if (wantsPlay) start();
    else list.prepare(next);
    emit("timeupdate");
  }

  function reset(): void {
    generation += 1;
    index = 0;
    pendingShare = null;
    attachedIndex = null;
    attachedReady = false;
    switching = false;
    wantsPlay = false;
    ended = false;
    failure = null;
  }

  /* ---------------------------------------------------------------- the element's events */

  const handlers: Record<AudioEvent, () => void> = {
    loadedmetadata() {
      if (!playlist) return emit("loadedmetadata");
      const segment = current();
      if (attachedIndex !== index || !segment) return;
      attachedReady = true;
      if (pendingShare !== null && pendingShare > 0 && isFinitePositive(real.duration)) {
        try {
          real.currentTime = pendingShare * real.duration;
        } catch {
          // Some engines refuse a seek before the first frame. The next canplay tries again.
          return;
        }
      }
      pendingShare = null;
      // The new file is in place and positioned: from here its clock is the track's clock.
      switching = false;
    },
    durationchange() {
      // The virtual length never changes, so a file's own length is not the track's news.
      if (!playlist) emit("durationchange");
    },
    canplay() {
      if (playlist && attachedIndex === index && pendingShare !== null && attachedReady) {
        handlers.loadedmetadata();
      }
      emit("canplay");
    },
    playing() {
      switching = false;
      emit("playing");
      prepareAhead();
    },
    pause() {
      if (!playlist) return emit("pause");
      // A file swap pauses the element, and so does reaching the end of a file that is not the
      // last. Neither is the track pausing.
      if (switching || (real.ended && !isLast())) return;
      if (real.ended) ended = true;
      wantsPlay = false;
      emit("pause");
    },
    ended() {
      if (!playlist) return emit("ended");
      if (attachedIndex !== index) return;
      if (isLast()) {
        ended = true;
        wantsPlay = false;
        emit("ended");
        return;
      }
      index += 1;
      pendingShare = 0;
      switching = true;
      emit("timeupdate");
      if (wantsPlay) start();
    },
    waiting() {
      emit("waiting");
    },
    stalled() {
      emit("stalled");
    },
    timeupdate() {
      emit("timeupdate");
      if (playlist && !switching) prepareAhead();
    },
    ratechange() {
      emit("ratechange");
    },
    error() {
      if (playlist) {
        if (attachedIndex === null) return;
        failure = real.error ?? { code: MEDIA_ERR_NETWORK };
        wantsPlay = false;
      }
      emit("error");
    },
  };
  for (const type of FORWARDED) real.addEventListener(type, handlers[type]);

  /* ---------------------------------------------------------------- the audio the player sees */

  return {
    get src() {
      return playlist ? virtualSrc : real.src;
    },
    set src(value: string) {
      const next = options.resolve(value);
      const hadPlaylist = playlist !== null;
      reset();
      playlist = next;
      if (!next) {
        virtualSrc = "";
        real.src = value;
        return;
      }
      virtualSrc = value;
      if (hadPlaylist || real.src) {
        // Whatever the element was holding belongs to the track before this one.
        switching = true;
        real.pause();
        real.removeAttribute("src");
        real.load();
        switching = false;
      }
      // The length and the story marks are known without reading a file, so the header is "read".
      emitSoon("loadedmetadata");
      emitSoon("durationchange");
    },
    get currentTime() {
      return playlist ? virtualTime() : real.currentTime;
    },
    set currentTime(value: number) {
      if (playlist) seek(value);
      else real.currentTime = value;
    },
    get duration() {
      return playlist ? total() : real.duration;
    },
    get paused() {
      return playlist ? !wantsPlay : real.paused;
    },
    get ended() {
      return playlist ? ended : real.ended;
    },
    get readyState() {
      if (!playlist) return real.readyState;
      const live = attachedIndex === index && attachedReady && !switching;
      return live ? Math.max(HAVE_METADATA, real.readyState) : HAVE_METADATA;
    },
    get error() {
      return playlist ? failure : real.error;
    },
    get playbackRate() {
      return real.playbackRate;
    },
    set playbackRate(value: number) {
      real.playbackRate = value;
    },
    get defaultPlaybackRate() {
      return real.defaultPlaybackRate;
    },
    set defaultPlaybackRate(value: number) {
      real.defaultPlaybackRate = value;
    },
    get preservesPitch() {
      return real.preservesPitch;
    },
    set preservesPitch(value: boolean) {
      real.preservesPitch = value;
    },
    get webkitPreservesPitch() {
      return real.webkitPreservesPitch;
    },
    set webkitPreservesPitch(value: boolean | undefined) {
      if ("webkitPreservesPitch" in real) real.webkitPreservesPitch = value;
    },
    get preload() {
      return real.preload;
    },
    set preload(value: string) {
      // A playlist loads each file in full as it is reached; the player's hint is for single files.
      if (!playlist) real.preload = value;
    },
    play() {
      if (!playlist) return real.play();
      if (ended) {
        ended = false;
        index = 0;
        pendingShare = 0;
      }
      failure = null;
      wantsPlay = true;
      return startCurrent();
    },
    pause() {
      if (!playlist) return real.pause();
      wantsPlay = false;
      // A file that is still on its way must not start when it lands.
      generation += 1;
      if (attachedIndex !== null) real.pause();
    },
    load() {
      if (playlist) reset();
      real.load();
    },
    removeAttribute(name: string) {
      if (name === "src") {
        reset();
        playlist = null;
        virtualSrc = "";
      }
      real.removeAttribute(name);
    },
    addEventListener(type: string, listener: () => void) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
}
