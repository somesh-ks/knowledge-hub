import { installAnalytics, track } from "../lib/analytics";
import { LISTEN_PATH, listenMetadata } from "../lib/listenAnalytics";

/**
 * The public listen page's one script (pages/s/[token].astro, D153). Play asks /api/share-play,
 * which counts the play against the link's cap and the month's budget and answers the stored files;
 * they play one after another in one audio element. It never asks /api/narrate: a file that will
 * not play is skipped with a line. No service worker, no player, no app script: its own budget line
 * in checkBundle keeps it small.
 */

interface Segment {
  url: string;
  duration_ms: number;
}

const root = document.querySelector<HTMLElement>("[data-listen]");
const audio = document.querySelector<HTMLAudioElement>("[data-listen-audio]");
const play = document.querySelector<HTMLButtonElement>("[data-listen-play]");
const seek = document.querySelector<HTMLInputElement>("[data-listen-seek]");
const elapsed = document.querySelector<HTMLElement>("[data-listen-elapsed]");
const status = document.querySelector<HTMLElement>("[data-listen-status]");

// Read here and sent only to the play route: never to analytics, which reports LISTEN_PATH.
const token = location.pathname.split("/")[2] ?? "";

installAnalytics({ path: LISTEN_PATH });

const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

if (root && audio && play && seek && elapsed && status) {
  const item = root.dataset.item ?? "";
  const meta = listenMetadata(item, root.dataset.kind ?? "", location.search);
  const counted = new Set<string>();
  const once = (name: "listen_start" | "listen_half" | "listen_complete"): void => {
    if (counted.has(name)) return;
    counted.add(name);
    track(name, meta);
  };
  const label = play.querySelector<HTMLElement>("[data-chip-label]");
  const idleLabel = label?.textContent ?? "";

  let segments: Segment[] | null = null;
  let starts: number[] = [];
  let total = Number(seek.max) || 0;
  let index = 0;
  let starting = false;
  let skipped = false;

  const say = (message: string): void => {
    status.textContent = message;
  };
  const position = (): number => (starts[index] ?? 0) + audio.currentTime * 1000;
  const paint = (): void => {
    const at = Math.min(total, position());
    if (document.activeElement !== seek) seek.value = String(Math.round(at));
    seek.style.setProperty("--range-fill", `${total > 0 ? (at / total) * 100 : 0}%`);
    elapsed.textContent = clock(at);
    if (total > 0 && at >= total / 2) once("listen_half");
  };
  const playing = (on: boolean): void => {
    play.dataset.playing = String(on);
    play.setAttribute("aria-label", on ? "Pause" : "Play");
    if (label) label.textContent = segments ? (on ? "Pause" : "Resume") : idleLabel;
  };

  /** Loads segment `next` and starts it at `offset` ms into it. */
  const load = (next: number, offset = 0): void => {
    const segment = segments?.[next];
    if (!segment) {
      playing(false);
      once("listen_complete");
      index = 0;
      return;
    }
    index = next;
    audio.src = segment.url;
    if (offset > 0) {
      audio.addEventListener("loadedmetadata", () => (audio.currentTime = offset / 1000), {
        once: true,
      });
    }
    void audio.play().catch(() => playing(false));
  };

  const refusal = async (response: Response): Promise<string> => {
    if (response.status === 410) return "This link has stopped working.";
    if (response.status === 404) return "This link does not work.";
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === "string") return body.message;
    } catch {
      // No words from the server: the line below says enough.
    }
    return "Could not start. Try again in a moment.";
  };

  /** One play start: the server checks and counts it, then answers the files. */
  const start = async (): Promise<void> => {
    play.dataset.state = "preparing";
    try {
      const response = await fetch("/api/share-play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        play.dataset.state = response.status === 410 ? "unavailable" : "idle";
        if (response.status === 410) play.setAttribute("aria-disabled", "true");
        say(await refusal(response));
        return;
      }
      const body = (await response.json()) as { segments?: Segment[] };
      segments = (body.segments ?? []).filter((each) => typeof each.url === "string");
      starts = [];
      let sum = 0;
      for (const segment of segments) {
        starts.push(sum);
        sum += segment.duration_ms;
      }
      total = sum || total;
      seek.max = String(total);
      seek.disabled = false;
      play.dataset.state = "current";
      say("");
      load(0);
    } catch {
      play.dataset.state = "idle";
      say("Could not start. Check your connection and try again.");
    }
  };

  play.addEventListener("click", () => {
    if (play.getAttribute("aria-disabled") === "true") return;
    if (!segments) {
      // One play start at a time: a second press while it is asked counts nothing twice.
      if (starting) return;
      starting = true;
      void start().finally(() => {
        starting = false;
      });
      return;
    }
    if (audio.paused) void audio.play().catch(() => playing(false));
    else audio.pause();
  });

  audio.addEventListener("playing", () => {
    playing(true);
    once("listen_start");
  });
  audio.addEventListener("pause", () => playing(false));
  audio.addEventListener("timeupdate", paint);
  audio.addEventListener("ended", () => load(index + 1));
  // A file that will not play is skipped, never narrated: the page says so once and goes on.
  audio.addEventListener("error", () => {
    if (!segments) return;
    if (!skipped) say("A part of this could not be played and was skipped.");
    skipped = true;
    load(index + 1);
  });

  seek.addEventListener("input", () => {
    const at = Number(seek.value);
    elapsed.textContent = clock(at);
    seek.style.setProperty("--range-fill", `${total > 0 ? (at / total) * 100 : 0}%`);
  });
  seek.addEventListener("change", () => {
    if (!segments) return;
    const at = Number(seek.value);
    let next = 0;
    while (next + 1 < starts.length && (starts[next + 1] ?? 0) <= at) next += 1;
    const offset = at - (starts[next] ?? 0);
    if (next === index && audio.src) {
      audio.currentTime = offset / 1000;
      if (audio.paused) void audio.play().catch(() => playing(false));
    } else load(next, offset);
  });
}
