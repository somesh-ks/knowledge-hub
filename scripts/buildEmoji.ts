import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Compiles the emoji picker's data (apps/web/public/emoji.json) from emojibase-data (MIT), the
 * Unicode CLDR names and keywords. The picker fetches the file when it first opens, so it is never
 * in a page's first load. Only emoji up to Unicode 15 are kept (they draw on current Android and
 * iOS), without skin tones or the regional-indicator and component pieces.
 *
 *   npm run emoji   (or: npx tsx scripts/buildEmoji.ts <dir of emojibase-data/en>)
 *
 * emojibase-data is a pinned devDependency; the build never reads it, only this script does.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const EMOJI_PATH = resolve(ROOT, "apps/web/public/emoji.json");
const MAX_VERSION = 15;
/** emojibase's "component" group: skin tones and hair pieces, not emoji to pick. */
const COMPONENT = 2;

interface Entry {
  label: string;
  emoji: string;
  tags?: string[];
  group?: number;
  version: number;
}

interface Message {
  key: string;
  message: string;
  order: number;
}

/** The picker's file: category names, and for each category its emoji as [emoji, name, keywords]. */
export interface EmojiFile {
  groups: { name: string; emoji: [string, string, string][] }[];
}

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export function compile(entries: Entry[], groups: Message[]): EmojiFile {
  const named = groups.filter((group) => group.order !== COMPONENT);
  return {
    groups: named.map((group) => ({
      name: group.message.replace(/^./, (c) => c.toUpperCase()).replaceAll("&", "and"),
      emoji: entries
        .filter((e) => e.group === group.order && e.version <= MAX_VERSION)
        .map((e): [string, string, string] => {
          const label = e.label.toLowerCase();
          // Keywords add only the words the name does not already carry.
          const extra = [...new Set((e.tags ?? []).flatMap(words))].filter(
            (word) => !words(label).includes(word),
          );
          return [e.emoji, label, extra.join(" ")];
        }),
    })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const from = process.argv[2] ?? resolve(ROOT, "node_modules/emojibase-data/en");
  const read = (name: string) => JSON.parse(readFileSync(join(from, name), "utf8"));
  const file = compile(read("data.json"), read("messages.json").groups);
  writeFileSync(EMOJI_PATH, `${JSON.stringify(file)}\n`);
  console.log(`${file.groups.reduce((n, g) => n + g.emoji.length, 0)} emoji written`);
}
