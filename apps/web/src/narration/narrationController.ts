/**
 * Press Play on a briefing that has no finished audio, and hear it within a few seconds.
 *
 * The order matters. The first file is made BEFORE the player is told anything, so the refusals a
 * listener can do something about (a cap, the monthly allowance) are answered here, in words that
 * name them, and the player never shows a generic error for them. Once the first file exists the
 * briefing is loaded as one track and plays; the rest is made just ahead of the playhead.
 */
import type { StreamStatus } from "../lib/liveStream";
import type { PlayerStore } from "../player/core/playerTypes";
import type { NarrationTimeline, PlayerDigestData } from "../types/contracts";
import { createGrowth, type GrowthDeps } from "./liveEpisode";
import {
  type ApiDeps,
  describeNarrationFailure,
  failureCopy,
  lookupNarration,
  type NarrationNoun,
  narrateSegment,
} from "./narrationApi";
import {
  type NarrationPlan,
  narratedDigest,
  narrationSource,
  planNarration,
  type SegmentInfo,
} from "./narrationPlan";
import { rememberNarrated } from "./narrationRegistry";
import {
  createSegmentQueue,
  NarrationError,
  type NarrationFailure,
  type SegmentQueue,
} from "./segmentQueue";
import type { SwitchableAudio } from "./switchableAudio";
import { createTrackAudio, type Playlist } from "./trackAudio";

/** Used when the server sends no estimate. About the pace of the default voice. */
const FALLBACK_MS_PER_CHARACTER = 62;

export interface ControllerDeps {
  store: Pick<
    PlayerStore,
    "load" | "play" | "playItem" | "getState" | "getPageDigest" | "setPageDigest"
  >;
  audio: SwitchableAudio;
  api: ApiDeps;
  /** Says something to the listener: a toast. */
  notify(message: string): void;
  /** Marks a briefing as being prepared, so its Play control can show it. Null clears the mark. */
  setPreparing(digestId: string | null): void;
}

export type PlayOutcome = "playing" | "cancelled" | "failed";

/** What playing an episode that is still being written needs: where to read the live copy. */
export type LiveSource = Omit<GrowthDeps, "msPerCharacter"> & { status: StreamStatus };

export interface NarrationController {
  /**
   * Plays a briefing, narrating what is missing. Call it from the tap itself, after unlocking the
   * audio element in that same tap.
   */
  play(digest: PlayerDigestData, itemId?: string, live?: LiveSource): Promise<PlayOutcome>;
  /**
   * Asks for the first segments of a briefing in the background, so that Play starts at once.
   * Never plays, never speaks, never throws, and asks nothing of a listener: a refusal of any kind
   * ends it quietly. A press of Play while it runs joins its request.
   */
  prewarm(digest: PlayerDigestData): Promise<void>;
}

/** One briefing narrated in this session: its queue, and the copy of it the player loads. */
interface Session {
  queue: SegmentQueue;
  narrated: PlayerDigestData;
}

/** What a lookup of one briefing came to, kept so that a prewarm and a press share it. */
type Prepared =
  | { ok: false; reason: NarrationFailure }
  | { ok: true; whole: PlayerDigestData }
  | {
      ok: true;
      whole: null;
      segments: SegmentInfo[];
      plan: NarrationPlan;
      narrated: PlayerDigestData;
      queue: SegmentQueue;
    };

/** The first segments a prewarm asks for: the intro, then the first story. */
const PREWARM_SEGMENTS = 2;

/** Puts a whole-file narration's times onto the page's briefing, as the page build would have. */
function withWholeAudio(
  digest: PlayerDigestData,
  whole: { url: string; duration_ms: number; timeline: NarrationTimeline | null },
): PlayerDigestData {
  const items = new Map(whole.timeline?.items.map((item) => [item.id, item]));
  const sections = new Map(whole.timeline?.sections.map((section) => [section.slug, section]));
  return {
    ...digest,
    audio: { url: whole.url, duration_ms: whole.duration_ms },
    timeline: whole.timeline?.kind ?? null,
    items: digest.items.map((item) => ({
      ...item,
      start_ms: items.get(item.id)?.start_ms ?? null,
      end_ms: items.get(item.id)?.end_ms ?? null,
    })),
    sections: digest.sections.map((section) => ({
      ...section,
      start_ms: sections.get(section.slug)?.start_ms ?? null,
    })),
  };
}

export function createNarrationController(deps: ControllerDeps): NarrationController {
  /**
   * Every briefing narrated in this session stays playable for the rest of it. The listener can go
   * back to an earlier one, and its page's Play control then loads the same source string again.
   */
  const sessions = new Map<string, Session>();
  const playlists = new Map<string, Playlist>();
  let adapterInstalled = false;
  let activeId: string | null = null;
  /** Bumped by every play, so an attempt that was overtaken stops quietly. */
  let attempt = 0;
  // What the recording being started is called, for the copy of a refusal.
  let noun: NarrationNoun = "briefing";

  function installAdapter(): void {
    if (adapterInstalled) return;
    adapterInstalled = true;
    deps.audio.use(
      createTrackAudio(deps.audio.element, { resolve: (src) => playlists.get(src) ?? null }),
    );
  }

  /** Only the briefing being listened to has files made ahead of its playhead. */
  function activate(digestId: string): void {
    if (activeId !== null && activeId !== digestId) sessions.get(activeId)?.queue.stop();
    // A briefing the listener comes back to was stopped when they left it.
    if (activeId !== digestId) sessions.get(digestId)?.queue.reset();
    activeId = digestId;
  }

  function start(digest: PlayerDigestData, itemId: string | undefined): void {
    // The page still shows this briefing: from now on its chips drive the narrated copy.
    if (deps.store.getPageDigest()?.id === digest.id) deps.store.setPageDigest(digest);
    deps.store.load(digest);
    if (itemId && digest.items.some((item) => item.id === itemId && item.start_ms !== null)) {
      deps.store.playItem(itemId);
    } else {
      deps.store.play();
    }
  }

  function say(reason: NarrationFailure): void {
    deps.notify(failureCopy(reason, noun));
  }

  /** Makes the first file the listener will hear. */
  async function firstFile(queue: SegmentQueue, index: number, mine: number): Promise<PlayOutcome> {
    try {
      // The server is asked even where a file is expected to be: it answers at once for one that
      // exists, and a guess that is wrong costs a failed fetch.
      await queue.confirm(index);
      return mine === attempt ? "playing" : "cancelled";
    } catch (error) {
      if (mine !== attempt) return "cancelled";
      say(error instanceof NarrationError ? error.reason : "failed");
      return "failed";
    }
  }

  /** One lookup per briefing, shared by a prewarm and a press. A failed one is forgotten. */
  const lookups = new Map<string, Promise<Prepared>>();

  function prepare(digest: PlayerDigestData): Promise<Prepared> {
    const existing = lookups.get(digest.id);
    if (existing) return existing;
    const made = lookupNarration(digest.id, deps.api).then((found): Prepared => {
      if (!found.ok) return found;
      // Someone already narrated it as one file since this page was built.
      if (found.whole) return { ok: true, whole: withWholeAudio(digest, found.whole) };
      const plan = planNarration(found.segments, found.msPerCharacter || FALLBACK_MS_PER_CHARACTER);
      const queue = createSegmentQueue({
        segments: plan.segments,
        narrate: (key) => narrateSegment(digest.id, key, deps.api),
        // A file being made ahead of time fails quietly: it is asked for again when needed. A
        // refusal mid-briefing is told once, by the player: the file's wait ends in an error whose
        // words describeFailure gives (see playlists below), so no toast repeats it.
      });
      return {
        ok: true,
        whole: null,
        segments: found.segments,
        plan,
        narrated: narratedDigest(digest, plan),
        queue,
      };
    });
    lookups.set(digest.id, made);
    void made.then((outcome) => {
      if (!outcome.ok && lookups.get(digest.id) === made) lookups.delete(digest.id);
    });
    return made;
  }

  async function prewarm(digest: PlayerDigestData): Promise<void> {
    // A press already has it: stay out of the way.
    if (sessions.has(digest.id)) return;
    try {
      const prepared = await prepare(digest);
      if (!prepared.ok || prepared.whole) return;
      for (let index = 0; index < PREWARM_SEGMENTS; index += 1) prepared.queue.warm(index);
    } catch {
      // A prewarm is never worth an error.
    }
  }

  async function play(
    digest: PlayerDigestData,
    itemId?: string,
    live?: LiveSource,
  ): Promise<PlayOutcome> {
    noun = digest.turns || digest.kind === "on-demand" ? "episode" : "briefing";
    attempt += 1;
    const mine = attempt;

    // Narrated earlier in this session: its files and its place in the player are still good.
    const known = sessions.get(digest.id);
    if (known) {
      activate(digest.id);
      start(known.narrated, itemId);
      return "playing";
    }

    deps.setPreparing(digest.id);
    try {
      const prepared = await prepare(digest);
      if (mine !== attempt) return "cancelled";
      if (!prepared.ok) {
        say(prepared.reason);
        return "failed";
      }

      // Someone already narrated it as one file since this page was built.
      if (prepared.whole) {
        rememberNarrated(prepared.whole);
        start(prepared.whole, itemId);
        return "playing";
      }

      const { segments, plan, narrated, queue } = prepared;
      // A press is a fresh ask: whatever a prewarm was refused is tried again, and told if it stands.
      queue.reset();

      // Where the listener will start: the story they tapped, or the top.
      const tapped = itemId ? segments.findIndex((segment) => segment.item_id === itemId) : -1;
      const first = Math.max(0, tapped);
      if (!plan.complete) {
        const outcome = await firstFile(queue, first, mine);
        if (outcome !== "playing") return outcome;
      }

      sessions.set(digest.id, { queue, narrated });
      playlists.set(narrationSource(digest.id), {
        get segments() {
          return queue.segments;
        },
        ensure: (index) => queue.ensure(index),
        prepare: (index) => queue.prepare(index),
        describeFailure: (error) =>
          error instanceof NarrationError ? describeNarrationFailure(error.reason, noun) : null,
        // An episode still being written: the track grows with it (liveEpisode.ts).
        ...(live
          ? {
              growth: createGrowth(
                plan.segments,
                { status: live.status },
                { ...live, msPerCharacter: FALLBACK_MS_PER_CHARACTER },
              ),
            }
          : {}),
      });
      installAdapter();
      rememberNarrated(narrated);
      activate(digest.id);
      start(narrated, itemId);
      return "playing";
    } finally {
      if (mine === attempt) deps.setPreparing(null);
    }
  }

  return { play, prewarm };
}
