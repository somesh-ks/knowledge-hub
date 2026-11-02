import { watchAmbientStyle } from "./ambientStyle";

// Eager and tiny: loads the drawing code when the browser is idle, on pages that have the light.
const start = () => {
  const host = document.querySelector<HTMLElement>("[data-ambient]");
  if (host) watchAmbientStyle(host);
  const load = () => import("./ambientLight").then((m) => m.mountAmbient(host as HTMLElement));
  // Safari has no idle callback; a short wait keeps the drawing code out of the page's first moments.
  if (host)
    "requestIdleCallback" in window
      ? requestIdleCallback(load, { timeout: 2e3 })
      : setTimeout(load, 200);
};
start();
document.addEventListener("astro:page-load", start);
