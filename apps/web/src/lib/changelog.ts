/**
 * The app's change log, shown on its own Settings page. Add a version at the top: a number, the day it
 * landed (YYYY-MM-DD) and one or two plain sentences on what changed for the listener. The newest
 * version is the app's version everywhere it is shown. The record behind each is in docs/history/.
 *
 * Numbering (2026-10-22): a new feature a listener can use raises the minor number (0.8 to 0.9); fixes
 * and polish add or raise a patch digit (0.8 to 0.8.1 to 0.8.2). Pull requests landing the same day
 * share one entry, numbered by the largest change among them, so the number moves at most once a day.
 */
export interface Release {
  version: string;
  date: string;
  description: string;
}

export const CHANGELOG: readonly Release[] = [
  {
    version: "0.9.1",
    date: "2026-10-23",
    description:
      "A story's publisher sits above its headline and its summary is one shade lighter, so the headline leads. The cover is larger on a phone, the player's side buttons share one outline style, and New episode in the side rail no longer looks selected.",
  },
  {
    version: "0.9",
    date: "2026-10-22",
    description:
      "Software Engineering is a fourth topic with its own section, visits are counted without cookies, shared links say they were shared, and Settings has a Privacy page. Settings rows say their value at the end, podcast topics are listed by name, cards and what they hold share one rounded shape, and Costs is one card with its range and breakdown at the top.",
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
