/**
 * The pure parts of the Topics & Sources editing: ids and keywords from what a person types, web
 * addresses, the words for a refused lookup, the panel's button, and which catalogue sources suit a
 * new topic. Free of DOM and of imports beyond sourceMatch.ts, so the page scripts bundle it and the
 * tests read it directly.
 */
import { matchOffers, type Offer } from "./sourceMatch";

/** Most keywords a topic holds (MAX_KEYWORDS in core; the page script does not import core). */
export const MAX_KEYWORDS = 30;

/** What a name leaves for an id: lowercase letters, digits and hyphens. Under two characters is no id. */
export function idText(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

/** A topic's id from its name: lowercase letters, digits and hyphens, unique among `taken`. */
export function slugify(name: string, taken: readonly string[]): string {
  const cleaned = idText(name);
  const base = cleaned.length >= 2 ? cleaned : "topic";
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
}

/** Keywords from a comma-separated line: trimmed, no empties, no repeats, within what a topic holds. */
export function keywordList(text: string): string[] {
  const words = text
    .split(",")
    .map((word) => word.trim().slice(0, 60))
    .filter(Boolean);
  return [...new Set(words)].slice(0, MAX_KEYWORDS);
}

/** A web address from what a person types: "example.com" is "https://example.com/". */
export function webAddress(text: string): string | null {
  const typed = text.trim();
  try {
    const url = new URL(typed.includes("://") ? typed : `https://${typed}`);
    return /^https?:$/.test(url.protocol) && url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

/** One sentence that says what to do about a refused preview. */
export function problemText(status: number): string {
  if (status === 400) return "That address cannot be used. Check it and try again.";
  if (status === 422) return "The address could not be read. Try the site's home page instead.";
  if (status === 429) return "That was a lot of lookups. Wait a minute, then try again.";
  if (status === 504) return "The site took too long to answer. Try again in a moment.";
  return "The lookup could not be reached. Check your connection and try again.";
}

/** Why a new topic's details are refused, by field; an empty string is a field that is fine. */
export function topicProblems(input: { name: string; description: string }): {
  name: string;
  description: string;
} {
  const name = input.name.trim();
  return {
    name: !name
      ? "Enter a name."
      : idText(name).length < 2
        ? "Use at least two letters or numbers in the name."
        : "",
    description: input.description.trim() ? "" : "Say what should count as this topic.",
  };
}

/** What the panel's main button says on the topic's second step: the topic, and how many sources go with it. */
export function addTopicLabel(sources: number): string {
  if (sources <= 0) return "Add topic";
  return `Add topic and ${sources} ${sources === 1 ? "source" : "sources"}`;
}

/** What the panel's main button says on an edited topic's second step. */
export function saveTopicLabel(sources: number): string {
  if (sources <= 0) return "Save";
  return `Save and add ${sources} ${sources === 1 ? "source" : "sources"}`;
}

/** Whether a topic's details differ from what was saved: its name, what counts, or its keywords. */
export function topicChanged(
  saved: { name: string; description: string; keywords: readonly string[] },
  now: { name: string; description: string; keywords: readonly string[] },
): boolean {
  return (
    saved.name.trim() !== now.name.trim() ||
    saved.description.trim() !== now.description.trim() ||
    saved.keywords.join("\n") !== now.keywords.join("\n")
  );
}

/** A catalogue source as the page hands it to the panel. */
export interface OfferData extends Offer {
  id: string;
  name: string;
  feed_url: string;
  host: string;
  /** What it covers and how often it posts. */
  line: string;
}

/**
 * The catalogue sources to offer a new topic: those whose tags meet the words of its name, its
 * description and its keywords, best first. The page has already left out the sources it holds.
 */
export function suggestionsFor(
  topic: { name: string; description: string; keywords: readonly string[] },
  offers: readonly OfferData[],
): OfferData[] {
  return matchOffers(
    { name: topic.name, description: `${topic.description} ${topic.keywords.join(" ")}` },
    offers,
  );
}
