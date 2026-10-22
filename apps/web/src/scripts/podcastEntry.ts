/**
 * The Podcast page's first-load script: it finds the page and loads the editor (podcastPage.ts) and
 * its option logic side by side, so neither is in the page's first load. The controls stay inert
 * (see daily.css) until the editor has mounted, as they already did while the option logic loaded.
 */
export function installPodcastPage(): void {
  const sync = (): void => {
    const root = document.querySelector<HTMLElement>("[data-manage=podcast]");
    if (!root || root.dataset.mounting !== undefined) return;
    root.dataset.mounting = "";
    void import("./podcastPage").then((editor) => editor.mount(root));
  };
  document.addEventListener("astro:page-load", sync);
  sync();
}
