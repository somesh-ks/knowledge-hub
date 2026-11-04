/**
 * The app's change log, shown on its own Settings page. Add a version at the top: a number, the day it
 * landed (YYYY-MM-DD, UTC) and one or two plain sentences on what changed for the listener. The newest
 * version is the app's version everywhere it is shown. The record behind each is in docs/history/.
 *
 * Numbering (2026-10-22): a new feature a listener can use raises the minor number (0.8 to 0.9); fixes
 * and polish add or raise a patch digit (0.8 to 0.8.1 to 0.8.2). Pull requests landing the same day
 * share one entry, numbered by the largest change among them, so the number moves at most once a day.
 *
 * Kept current by CI (D355): a feat, fix or perf pull request fails the docs check when the newest entry
 * is more than two days old. Its author writes the missing days from `git log --since=<date> origin/main`.
 */
export interface Release {
  version: string;
  date: string;
  description: string;
}

export const CHANGELOG: readonly Release[] = [
  {
    version: "0.20",
    date: "2026-11-04",
    description:
      "A heart beside Play on a podcast's page adds it to Favorites, and every podcast menu in the Library, Favorites, Downloads and the queue has Add to favorites and Remove from favorites. Play on a podcast's page no longer flashes when you switch tabs. Listen now on a podcast being made, a regeneration too, plays it whole and keeps playing while the rest is written: its timer shows the length it will run, and a jump past what is written so far waits there until it is. On a phone the player bar's sideways swipe runs to the screen's edge. On a computer, the open player has the speed between its ten-second buttons, and the Podcast queue in the side column shimmers while a podcast is being made.",
  },
  {
    version: "0.19.1",
    date: "2026-11-04",
    description:
      "A podcast played again after a pause starts two seconds back, so the first words are not lost while your headphones or speaker wake up.",
  },
  {
    version: "0.19",
    date: "2026-11-03",
    description:
      "A profile button at the top right opens your profile page, and Settings is regrouped. Play opens the player in place, played podcasts leave the queue, the playing row can be dragged, and one speed screen serves the player and Settings. Cards show a grey download mark, Saved is called Favorites, and More options on Create is a closed accordion. Swipes on the player and on sheets, and dragging the seek line, make no sound, and the player bar's sideways swipe shows the podcast it switches to. In Up next any row can go above the playing one, rows glide as the list changes, a swipe to remove works on phones, and a podcast you remove is not suggested again.",
  },
  {
    version: "0.18",
    date: "2026-11-02",
    description:
      "Every podcast player has a ⋮ menu with Save, a speed screen and a Saved page. A Hue slider turns a style's colours, covers recolour with the style, and a page slides in from the side of the tab you came from. Pages open faster, offline changes wait and sync on their own, and the voice list says when you are offline.",
  },
  {
    version: "0.17",
    date: "2026-11-01",
    description:
      "Settings has Downloads, Notifications (Daily, Weekly and Podcast ready) and a Style select with a Halloween look. The Library groups by month, edits made offline are kept and sent when you are back, and play, pause, skip and speed are felt even with Sounds off.",
  },
  {
    version: "0.16",
    date: "2026-10-31",
    description:
      "A long press on a Library card opens its menu, the tab pill slides between tabs and a cover flies in and out. The Expressive style and haptic cues arrive, a tada plays when a podcast is ready, and you can hear a voice from its list. The queue keeps played items, and the hour select opens as a wheel on a phone.",
  },
  {
    version: "0.15",
    date: "2026-10-30",
    description:
      "Only the person who started a run can cancel it, covers are drawn when first asked for, and warnings use an orange. The owner gets a command center at /admin with Health, Costs and an Experiments page that switches unfinished features on and off.",
  },
  {
    version: "0.14",
    date: "2026-10-29",
    description:
      "The app says podcast where it said briefing. A podcast queue sits above the bottom bar, a podcast's More menu offers Download and Add to queue, and a day's Catch ups are one album. Each podcast takes three regenerations, and Settings offers to switch the schedule's time zone when your device is in another one.",
  },
  {
    version: "0.13",
    date: "2026-10-28",
    description:
      "Settings has a Health page and Analytics. A new version of the app loads by itself instead of asking for a reload, and Regenerate and Catch up share one run card and a length to choose.",
  },
  {
    version: "0.12",
    date: "2026-10-27",
    description:
      "Speed is kept per episode with an offer to make it the default, the next episode plays on its own, and Up next suggests what plays when nothing is queued. A podcast's profile is a card with art, and the Daily and Weekly can each be switched off.",
  },
  {
    version: "0.11.1",
    date: "2026-10-26",
    description:
      "Episodes reach the length asked, a category's sources filter by tabs, and Settings pages show a breadcrumb. Audio files are smaller, none loads until you press Play, a deleted episode leaves every page at once, and the Costs page answers within seconds.",
  },
  {
    version: "0.11",
    date: "2026-10-25",
    description:
      "Preferences has a Structure view where you edit what each block of a podcast says. A new episode shows a card with the time left and plain failures, and a Singularity cover fills in when one is missing. Topics are called categories, and the Costs page gets stat pills.",
  },
  {
    version: "0.10",
    date: "2026-10-24",
    description:
      "The passphrase is gone. Catch up writes an episode of what you missed, share links open the app's own page, and queue gestures and phone sheets arrive. Story rows are calmer and say when a page was made, and Costs counts what Anthropic billed.",
  },
  {
    version: "0.9.1",
    date: "2026-10-23",
    description:
      "Costs is one card with its range and breakdown at the top, and Settings lists share one left edge with roomier cards. A story's publisher sits above its headline and its summary is one shade lighter, so the headline leads. The cover is larger on a phone, the player's side buttons share one outline style, New episode in the side rail no longer looks selected, and with reduced motion on, things fade in place instead of vanishing.",
  },
  {
    version: "0.9",
    date: "2026-10-22",
    description:
      "Software Engineering is a fourth topic with its own section, visits are counted without cookies, shared links say they were shared, and Settings has a Privacy page. Settings rows say their value at the end, podcast topics are listed by name, and cards and what they hold share one rounded shape.",
  },
  {
    version: "0.8",
    date: "2026-10-21",
    description:
      "Play works offline for what you downloaded, the Library has a menu sheet on every card, Settings is in cards, search and chips are shared across pages, Up next is a tab in the player, and every icon is the Phosphor set.",
  },
  {
    version: "0.7",
    date: "2026-10-21",
    description:
      "A play queue with Up next, downloads for offline listening, one voice pair for every podcast and a Settings page grouped into cards.",
  },
  {
    version: "0.6",
    date: "2026-10-20",
    description:
      "Sources know their type and have a star rating. Each kind of story and each topic can count for more or less, so the briefing leans toward what you read.",
  },
  {
    version: "0.5",
    date: "2026-10-16",
    description:
      "A brighter look with a colour scheme for every month's covers, one AI model to choose, a launch screen and an app you can install.",
  },
  {
    version: "0.4",
    date: "2026-10-13",
    description:
      "New episode on request, a Library you can search, and Regenerate and Delete for any briefing or episode.",
  },
  {
    version: "0.3",
    date: "2026-10-10",
    description:
      "Settings that save themselves: your own topics and sources, a time zone, and separate Daily and Weekly podcasts.",
  },
  {
    version: "0.2",
    date: "2026-10-08",
    description:
      "Singularity gets its name and its voice: every briefing can be played as a podcast, story by story, with a player and a transcript.",
  },
  {
    version: "0.1",
    date: "2026-10-06",
    description:
      "The first briefing: stories gathered from chosen outlets, judged and written up every second day, and published to a private reader.",
  },
];

/** The newest version, which is the app's. */
export const APP_VERSION = CHANGELOG[0]?.version ?? "0.1";

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "21 October 2026" for a YYYY-MM-DD day. */
export function releaseDay(date: string): string {
  return DAY.format(new Date(`${date}T12:00:00Z`));
}
