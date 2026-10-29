/**
 * The Tokens page: the filter hides token rows and icons that do not match, and a play button runs
 * its row's motion token (the dot goes to the far end and back).
 */
export {};

const field = document.querySelector<HTMLInputElement>("[data-token-filter]");
const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-token-row]"));

field?.addEventListener("input", () => {
  const terms = field.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const row of rows) {
    const text = `${row.dataset.name ?? ""} ${row.textContent ?? ""}`.toLowerCase();
    row.hidden = !terms.every((term) => text.includes(term));
  }
});

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
