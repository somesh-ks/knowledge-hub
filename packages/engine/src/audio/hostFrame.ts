import { type Digest, type DigestKind, isBuiltinSection, type Section } from "@dispatch/core";

/**
 * The words around the stories: the opening, the bridge into each new section, the small
 * connectives between stories and the sign-off. All of it is code, not model output, so a briefing
 * written long ago sounds as hosted as one written today, and none of it ever reaches the page.
 *
 * Everything here is deterministic. The same digest always gets the same phrases, which keeps the
 * narration's text, and therefore its cached audio, stable between runs. Variety comes from hashing
 * the digest id and the item id, never from a random number or the clock. The greeting depends on
 * the kind of digest, not the hour: a digest is written once and heard at any time of day.
 */

const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "twenty-one",
  "twenty-two",
  "twenty-three",
  "twenty-four",
] as const;

const ORDINAL_WORDS = [
  "zeroth",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
  "twenty-first",
  "twenty-second",
  "twenty-third",
  "twenty-fourth",
  "twenty-fifth",
  "twenty-sixth",
  "twenty-seventh",
  "twenty-eighth",
  "twenty-ninth",
  "thirtieth",
  "thirty-first",
] as const;

/** The count as a word up to twenty-four (the most a digest can hold), digits beyond that. */
export function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** FNV-1a. Small, stable across runs and platforms, and plenty for choosing between a few phrases. */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** "Wednesday the seventh of October", read from the digest's calendar date, never from the clock. */
export function spokenDate(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" }).format(at);
  const month = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long" }).format(at);
  const day = ORDINAL_WORDS[at.getUTCDate()] ?? String(at.getUTCDate());
  return `${weekday} the ${day} of ${month}`;
}

/** What the opening says it starts with. */
const LEAD: Record<Section, string> = {
  top: "the top picks",
  design: "design",
  "ui-craft": "design engineering",
  software: "software engineering",
  ai: "AI products",
  tech: "tech product launches",
  trending: "what is trending",
  research: "research",
  launches: "launches",
  watch: "something to watch and listen to",
};

/** A section the owner added is spoken by its title, in lower case as it falls mid-sentence. */
function spokenSection(section: SpokenSection): string {
  return isBuiltinSection(section.id) ? LEAD[section.id] : section.title.toLowerCase();
}

/** A section as the narration needs it: its id, and the title to say for one that is not built in. */
export interface SpokenSection {
  id: string;
  title: string;
}

/** The opening line. `firstSection` is the section whose story is heard first. */
export function openingLine(digest: Digest, firstSection: SpokenSection | undefined): string {
  const count = digest.items.length;
  const stories = count === 1 ? "story" : "stories";
  const date = spokenDate(digest.date);
  const lead = firstSection ? `, starting with ${spokenSection(firstSection)}` : "";
  const total = capitalize(countWord(count));
  switch (digest.kind) {
    case "weekly":
      return `This is the Singularity weekly, for ${date}. ${total} ${stories} from the week${lead}.`;
    case "on-demand":
      return `This is Singularity, a special edition for ${date}. ${total} ${stories}${lead}.`;
    default:
      return `This is Singularity for ${date}. ${total} ${stories} today${lead}.`;
  }
}

/** Phrases that introduce a section. None repeats a section title word for word. */
export function bridgeCandidates(
  /** A bare id is enough for a built-in section. */
  given: SpokenSection | string,
  count: number,
): readonly string[] {
  const section = typeof given === "string" ? { id: given, title: given } : given;
  if (!isBuiltinSection(section.id)) {
    const name = section.title.toLowerCase();
    return [`Now, ${name}.`, `On to ${name}.`, `Over to ${name}.`];
  }
  return builtinBridges(section.id, count);
}

function builtinBridges(section: Section, count: number): readonly string[] {
  switch (section) {
    case "top":
      return ["Back to the top picks.", "Now, the top picks."];
    case "design":
      return ["Now, design.", "On to design.", "Over in design."];
    case "ui-craft":
      return ["Now, design engineering.", "On to design engineering.", "Over to the craft side."];
    case "software":
      return [
        "Now, software engineering.",
        "On to software engineering.",
        "Over to the engineering side.",
      ];
    case "ai":
      return ["Over in AI.", "Now, AI products.", "On the AI side."];
    case "tech":
      return count === 2
        ? ["Now, tech launches.", "A couple of launches.", "On to tech launches."]
        : ["Now, tech launches.", "On to tech launches.", "Some launches worth knowing."];
    case "trending":
      return ["Now, what is trending.", "On to what everyone is covering.", "In the wider news."];
    case "research":
      return ["Now, research.", "On the research side.", "Over in research."];
    case "launches":
      return count === 2
        ? ["Now, launches.", "A couple of launches.", "On to launches."]
        : ["Now, launches.", "On to launches.", "Some new launches."];
    case "watch":
      return [
        "Something to watch and listen to.",
        "Now, watch and listen.",
        "To watch and listen.",
      ];
    default: {
      const unreachable: never = section;
      throw new Error(`Unhandled section: ${String(unreachable)}`);
    }
  }
}

/**
 * The line that introduces a section, or null for the first one, which the opening already
 * announced. `previous` is the bridge just before it: a phrase never repeats back to back.
 */
export function sectionBridge(args: {
  digestId: string;
  section: SpokenSection;
  count: number;
  previous: string | null;
}): string {
  const pool = bridgeCandidates(args.section, args.count);
  const first = stableHash(`${args.digestId}:${args.section.id}`) % pool.length;
  for (let step = 0; step < pool.length; step++) {
    const phrase = pool[(first + step) % pool.length] as string;
    if (phrase !== args.previous) return phrase;
  }
  return pool[first] as string;
}

/** Light connectives between two stories of a section. An empty entry is a plain cut. */
function connectivePool(kind: DigestKind): readonly string[] {
  const also =
    kind === "weekly" ? "Also this week." : kind === "on-demand" ? "Also here." : "Also today.";
  return ["Next up.", "", also, "Another one.", "", "Then there's this."];
}

/**
 * What to say before a story that is not the first of its section: empty for a plain cut. Chosen
 * from the item id, and a phrase never repeats the one just before it.
 */
export function storyConnective(args: {
  itemId: string;
  kind: DigestKind;
  previous: string | null;
}): string {
  const pool = connectivePool(args.kind);
  const first = stableHash(args.itemId) % pool.length;
  for (let step = 0; step < pool.length; step++) {
    const phrase = pool[(first + step) % pool.length] as string;
    if (phrase === "" || phrase !== args.previous) return phrase;
  }
  return "";
}

/** The closing line, spoken as the outro. */
export function signOff(kind: DigestKind): string {
  switch (kind) {
    case "weekly":
      return "That's the weekly briefing. Back next week.";
    case "on-demand":
      return "That's the briefing.";
    default:
      return "That's the briefing. More in two days.";
  }
}
