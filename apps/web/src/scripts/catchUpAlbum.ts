/**
 * The select of a day's Catch ups on an episode page (components/PlayCta.astro, D218). It names
 * each option from the hour it was started in this browser's own time zone, for this visit only:
 * nothing is stored, and the server's day (Stockholm) is unchanged. Choosing an option opens that
 * Catch up's page. The listeners sit on the document, so they outlive a client-side navigation.
 */
import { albumLabels } from "../lib/catchUps";

const SELECT = "select[data-album-pick]";
let installed = false;

/** Names the options for the viewer's zone and puts the select back on the page's own Catch up. */
function sync(): void {
  for (const select of document.querySelectorAll<HTMLSelectElement>(SELECT)) {
    const options = Array.from(select.options);
    try {
      const labels = albumLabels(options.map((option) => option.dataset.at ?? ""));
      options.forEach((option, index) => {
        option.textContent = labels[index] ?? option.textContent;
      });
    } catch {
      // A time Intl cannot read keeps the server's name.
    }
    // Back from another Catch up's page, the browser may have kept the choice made there.
    select.value = select.dataset.current ?? select.value;
  }
}

export function installCatchUpAlbum(): void {
  sync();
  if (installed) return;
  installed = true;
  document.addEventListener("astro:page-load", sync);
  document.addEventListener("change", (event) => {
    const select = (event.target as Element | null)?.closest?.<HTMLSelectElement>(SELECT);
    if (!select || select.value === select.dataset.current) return;
    const path = `/e/${encodeURIComponent(select.value)}`;
    void import("astro:transitions/client").then(
      ({ navigate }) => navigate(path),
      () => location.assign(path),
    );
  });
}
