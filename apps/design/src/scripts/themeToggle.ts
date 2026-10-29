/**
 * The guide's theme: dark unless chosen otherwise, kept in this browser under "design:theme" (the
 * reader's own saved theme is neither read nor written, so a choice here never changes the app).
 * The page applies the stored choice before first paint (Shell.astro); this wires the buttons and
 * says so on document as "design:theme", for the color page to measure again.
 */
export {};

const KEY = "design:theme";

const current = (): "light" | "dark" =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

function show(): void {
  const theme = current();
  for (const button of document.querySelectorAll<HTMLElement>("[data-theme-toggle]")) {
    button.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
    );
    button.dataset.theme = theme;
  }
}

document.addEventListener("click", (event) => {
  if (!(event.target as Element).closest("[data-theme-toggle]")) return;
  const next = current() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  show();
  document.dispatchEvent(new CustomEvent("design:theme", { detail: next }));
});

show();
