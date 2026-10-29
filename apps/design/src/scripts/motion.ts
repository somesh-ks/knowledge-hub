/** The Motion page: a play button runs its row's motion token (the dot goes to the far end and back). */
export {};

document.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLElement>("[data-run-motion]");
  if (!button) return;
  const track = button.closest("tr")?.querySelector<HTMLElement>(".guide-motion-track");
  if (!track || track.dataset.run === "true") return;
  track.dataset.run = "true";
  // Out, then back: when the dot arrives (or at once with reduced motion, where it never travels).
  const dot = track.querySelector<HTMLElement>(".guide-motion-dot");
  const back = (): void => {
    track.dataset.run = "false";
  };
  dot?.addEventListener("transitionend", back, { once: true });
  setTimeout(back, 2000);
});
