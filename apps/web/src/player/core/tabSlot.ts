/**
 * Things that must exist once per tab, however many copies of the bundle are loaded into it.
 *
 * The player outlives page moves: its island persists, and so does its audio. But a move fetches
 * the next page from the network, and after a deploy that page names new script files. The tab then
 * holds two copies of every module, the old one still driving the persisted bar and the new one
 * driving the page, each with a store and an audio element of its own (a module's top-level `let`
 * is per copy). Play on the page started the new audio while the bar showed the old, and a press on
 * the bar played both. Whatever owns the speaker lives here instead, on the tab's global, so the
 * first copy's instance is the one every later copy gets.
 */

const KEY = "__singularityTab";

type Slots = Record<string, unknown>;

/** The tab's one instance under `name`: `create` runs for the first copy to ask, never again. */
export function tabShared<T>(name: string, create: () => T): T {
  const scope = globalThis as unknown as Record<string, Slots | undefined>;
  const slots = scope[KEY] ?? {};
  scope[KEY] = slots;
  if (!(name in slots)) slots[name] = create();
  return slots[name] as T;
}
