/** What a Library card says about one briefing. Build-time only: it reads the whole digest. */
import type { DigestEntry } from "./digests";
import { listenLength, storyCount } from "./digestView";
import { type CardFacts, normalize } from "./library";

export function cardFacts(entry: DigestEntry): CardFacts {
  const { digest } = entry;
  const length = listenLength(entry);
  const parts = [storyCount(digest.items.length), length];
  if (digest.kind === "weekly") parts.unshift("Weekly");
  const lines = [digest.date, entry.player.title];
  // One line per story, headline and publisher together, so a story counts once however it matches.
  for (const item of digest.items) lines.push(`${item.headline} ${item.source}`);
  return {
    line: parts.join(", "),
    minutes: Number.parseInt(length, 10) || digest.listen_minutes,
    search: normalize(lines.join("\n")),
  };
}
