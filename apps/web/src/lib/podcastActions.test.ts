import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

/** Every .astro and .tsx file under src, as [path, source]. */
function sources(dir = SRC): [string, string][] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(astro|tsx)$/.test(entry.name)
      ? [[relative(SRC, path).replaceAll("\\", "/"), readFileSync(path, "utf8")]]
      : [];
  });
}

// The two files that draw a podcast's actions: the Astro sheet (Library card, page ⋮, Downloads,
// Favorites) and the queue row's React sheet. Both order by lib/podcastActions.ts.
const DRAWS_PODCAST_ACTIONS = new Set([
  "components/PodcastMenuItem.astro",
  "player/QueueRowMenu.tsx",
]);

// Bug it prevents: a surface builds its own podcast menu and shows other actions, in another order,
// than a Library card (owner, 2026-11-05: the page's ⋮ offered 3 actions where the Library offers 7).
describe("podcast sheets", () => {
  it("are drawn only by the two files that read the one list", () => {
    const own = sources()
      .filter(([path]) => !DRAWS_PODCAST_ACTIONS.has(path))
      .filter(([, text]) => /data-menu=|data-episode-action=/.test(text))
      .map(([path]) => path);
    expect(own).toEqual([]);
  });

  // PodcastMenuItems.astro picks and orders the items; a page that drew a PodcastMenuItem itself would
  // show a partial menu without carrying any marker above.
  it("reach a page only through PodcastMenuItems", () => {
    const direct = sources()
      .filter(([path]) => path !== "components/PodcastMenuItems.astro")
      .filter(([, text]) => /from "[^"]*PodcastMenuItem\.astro"/.test(text))
      .map(([path]) => path);
    expect(direct).toEqual([]);
  });

  it("order their actions by the one list", () => {
    for (const path of ["components/PodcastMenuItems.astro", "player/QueueRowMenu.tsx"]) {
      const text = readFileSync(join(SRC, path), "utf8");
      expect(text, path).toContain("inPodcastOrder(");
    }
  });
});
