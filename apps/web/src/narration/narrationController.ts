/**
 * Press Play on a briefing that has no finished audio, and hear it within a few seconds.
 *
 * The order matters. The first file is made BEFORE the player is told anything, so the refusals a
 * listener can do something about (a wrong passphrase, a cap) are answered here, in words that name
 * them, and the player never shows a generic error for them. Once the first file exists the
 * briefing is loaded as one track and plays; the rest is made just ahead of the playhead.
 */
import type { PlayerStore } from "../player/core/playerTypes";
import type { NarrationTimeline, PlayerDigestData } from "../types/contracts";
import { type ApiDeps, FAILURE_COPY, lookupNarration, narrateSegment } from "./narrationApi";
import { narratedDigest, narrationSource, planNarration } from "./narrationPlan";
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
/** A wrong passphrase is asked for again this many times before the attempt is given up. */
const MAX_PASSPHRASE_TRIES = 3;

export interface PassphraseAnswer {
  value: string;
  /** Keep it on this device, so the next briefing does not ask. */
  remember: boolean;
}

export interface ControllerDeps {
  store: Pick<PlayerStore, "load" | "play" | "playItem" | "getState">;
  audio: SwitchableAudio;
  api: ApiDeps;
  passphrase: {
    get(): string | null;
    set(answer: PassphraseAnswer): void;
    clear(): void;
  };
  /** Opens the passphrase sheet. Resolves null when the listener closes it without answering. */
  askPassphrase(context: { wrong: boolean }): Promise<PassphraseAnswer | null>;
  /** Says something to the listener: a toast. */
  notify(message: string): void;
  /** Marks a briefing as being prepared, so its Play control can show it. Null clears the mark. */
  setPreparing(digestId: string | null): void;
}

export type PlayOutcome = "playing" | "cancelled" | "failed";

export interface NarrationController {
  /**
   * Plays a briefing, narrating what is missing. Call it from the tap itself, after unlocking the
   * audio element in that same tap.
   */
  play(digest: PlayerDigestData, itemId?: string): Promise<PlayOutcome>;
}

/** One briefing narrated in this session: its queue, and the copy of it the player loads. */
interface Session {
  queue: SegmentQueue;
  narrated: PlayerDigestData;
}

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
    activeId = digestId;
  }

  function start(digest: PlayerDigestData, itemId: string | undefined): void {
    deps.store.load(digest);
    if (itemId && digest.items.some((item) => item.id === itemId && item.start_ms !== null)) {
      deps.store.playItem(itemId);
    } else {
      deps.store.play();
    }
  }

  function say(reason: NarrationFailure): void {
    const message = FAILURE_COPY[reason];
    if (message) deps.notify(message);
  }

  /** Makes the first file the listener will hear, asking for the passphrase as often as it takes. */
  async function firstFile(queue: SegmentQueue, index: number, mine: number): Promise<PlayOutcome> {
    let wrong = false;
    for (let tries = 0; tries < MAX_PASSPHRASE_TRIES; tries += 1) {
      if (deps.passphrase.get() === null) {
        const answer = await deps.askPassphrase({ wrong });
        if (mine !== attempt) return "cancelled";
        if (!answer) return "cancelled";
        deps.passphrase.set(answer);
        queue.reset();
      }
      try {
        await queue.ensure(index);
        return mine === attempt ? "playing" : "cancelled";
      } catch (error) {
        if (mine !== attempt) return "cancelled";
        const reason = error instanceof NarrationError ? error.reason : "failed";
        if (reason !== "wrong_passphrase" && reason !== "passphrase_required") {
          say(reason);
          return "failed";
        }
        // Not kept, on this device or in this session: the next try starts from the sheet.
        deps.passphrase.clear();
        wrong = reason === "wrong_passphrase";
      }
    }
    say("wrong_passphrase");
    return "failed";
  }

  async function play(digest: PlayerDigestData, itemId?: string): Promise<PlayOutcome> {
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
      const found = await lookupNarration(digest.id, deps.api);
      if (mine !== attempt) return "cancelled";
      if (!found.ok) {
        say(found.reason);
        return "failed";
      }

      // Someone already narrated it as one file since this page was built.
      if (found.whole) {
        const whole = withWholeAudio(digest, found.whole);
        rememberNarrated(whole);
        start(whole, itemId);
        return "playing";
      }

      const plan = planNarration(found.segments, found.msPerCharacter || FALLBACK_MS_PER_CHARACTER);
      const narrated = narratedDigest(digest, plan);
      const queue = createSegmentQueue({
        segments: plan.segments,
        narrate: (key, passphrase) => narrateSegment(digest.id, key, passphrase, deps.api),
        getPassphrase: deps.passphrase.get,
        // A file being made ahead of time can fail quietly: it is asked for again when needed.
        onFailure: (reason, needed) => {
          if (needed && activeId === digest.id) say(reason);
        },
      });

      // Where the listener will start: the story they tapped, or the top.
      const tapped = itemId
        ? found.segments.findIndex((segment) => segment.item_id === itemId)
        : -1;
      const first = Math.max(0, tapped);
      if (!plan.complete) {
        const outcome = await firstFile(queue, first, mine);
        if (outcome !== "playing") return outcome;
      }

      sessions.set(digest.id, { queue, narrated });
      playlists.set(narrationSource(digest.id), queue);
      installAdapter();
      rememberNarrated(narrated);
      activate(digest.id);
      start(narrated, itemId);
      return "playing";
    } finally {
      if (mine === attempt) deps.setPreparing(null);
    }
  }

  return { play };
}
