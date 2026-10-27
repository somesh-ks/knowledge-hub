/**
 * The pure parts of the Categories and sources editing: ids from what a person types, web addresses, the
 * words for a refused lookup, whether a topic's details changed, and what a suggested source's +
 * button carries. Free of DOM and of imports, so the page scripts bundle it and the tests read it
 * directly.
 */

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
  if (status >= 500) return "The lookup failed on the server. Try again in a moment.";
  return "Couldn't reach the site to look it up. Check your connection and try again.";
}

/**
 * Why a new topic's details are refused, by field; an empty string is a field that is fine. `taken`
 * is the names of the topics there already, which a new name may not repeat, whatever its case.
 */
export function topicProblems(
  input: { name: string; description: string },
  taken: readonly string[] = [],
): {
  name: string;
  description: string;
} {
  const name = input.name.trim();
  const same = taken.find((other) => other.trim().toLowerCase() === name.toLowerCase());
  return {
    name: !name
      ? "Enter a name."
      : idText(name).length < 2
        ? "Use at least two letters or numbers in the name."
        : same
          ? `You already have a category called ${same.trim()}.`
          : "",
    description: input.description.trim() ? "" : "Say what should count as this category.",
  };
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

/**
 * A suggested source as its + button carries it (data-suggested-add): what pressing it adds, and the
 * topic it is filed under. The page builds the attribute (components/SuggestedSources.astro) and
 * topicsEditor.ts reads it, so the two share this shape.
 */
export interface SuggestedAdd {
  name: string;
  /** The feed the add operation sends. */
  feed_url: string;
  /** The site's icon, for the row that waits to be saved; null when there is none to draw. */
  favicon_url: string | null;
  /** The topic the source is filed under, or "" for none. */
  topic_id: string;
}

/**
 * The suggestion a + button carries, or null when it carries nothing that could be added. The page
 * builds the attribute, but a press must never throw on one that is missing or has been changed.
 */
export function parseSuggestedAdd(json: string | undefined): SuggestedAdd | null {
  let value: unknown;
  try {
    value = JSON.parse(json ?? "");
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { name, feed_url, favicon_url, topic_id } = value as Record<string, unknown>;
  const feed = typeof feed_url === "string" ? webAddress(feed_url) : null;
  if (typeof name !== "string" || name.trim() === "" || feed === null) return null;
  return {
    name: name.trim(),
    feed_url: feed,
    favicon_url:
      typeof favicon_url === "string" && favicon_url.startsWith("https://") ? favicon_url : null,
    topic_id: typeof topic_id === "string" ? topic_id : "",
  };
}

/**
 * The page that shows a topic added since the build, before the build gives it its own (D142):
 * pages/settings/categories/new, built once with these stand-ins for the topic's id, name and what counts,
 * which savedView.ts (fillShell) swaps for the saved topic's. No topic may take its address.
 */
export const NEW_TOPIC_ID = "new";
export const SHELL = { id: "__shell_id__", name: "__shell_name__", about: "__shell_about__" };

/**
 * `text` with the shell's stand-ins swapped for the topic's. The values go in as given: a function
 * replacer, so `$&` or `$$` in a name is kept and not read as a replacement pattern.
 */
export function fillShellText(
  text: string,
  values: { id: string; name: string; about: string },
): string {
  return text
    .replaceAll(SHELL.id, () => values.id)
    .replaceAll(SHELL.name, () => values.name)
    .replaceAll(SHELL.about, () => values.about);
}
