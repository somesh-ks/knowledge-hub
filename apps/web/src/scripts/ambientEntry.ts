// Eager and tiny: loads the drawing code when the browser is idle, on pages that have the light.
const start = () => {
  const host = document.querySelector<HTMLElement>("[data-ambient]");
  const load = () => import("./ambientLight").then((m) => m.mountAmbient(host as HTMLElement));
  if (host) "requestIdleCallback" in window ? requestIdleCallback(load, { timeout: 2e3 }) : load();
};
start();
document.addEventListener("astro:page-load", start);
