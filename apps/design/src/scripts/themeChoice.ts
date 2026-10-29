/**
 * The page's theme for this tab: Light and Dark set data-theme on the page and are remembered in
 * this tab only (sessionStorage), so the other pages open the same way; System removes it, so the
 * page follows the operating system. With no choice made in this tab the page opens in the reader's
 * saved theme (themeInit.js) and the choice shows that. Nothing is written to the reader's preferences.
 */
export {};

const KEY = "design:theme";

/** What the page is drawn in now: this tab's choice, else the reader's saved theme, else the system's. */
const read = (): string => {
  try {
    const chosen = sessionStorage.getItem(KEY);
    if (chosen === "light" || chosen === "dark" || chosen === "system") return chosen;
  } catch {}
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "system";
};

function apply(theme: string): void {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
  document.dispatchEvent(new CustomEvent("design:theme", { detail: theme }));
}

for (const group of document.querySelectorAll<HTMLElement>("[data-theme-choice]")) {
  const current = read();
  for (const input of group.querySelectorAll<HTMLInputElement>("input"))
    input.checked = input.value === current;
  group.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    try {
      sessionStorage.setItem(KEY, input.value);
    } catch {}
    apply(input.value);
    // The same choice on every other group on the page.
    for (const other of document.querySelectorAll<HTMLInputElement>("[data-theme-choice] input"))
      other.checked = other.value === input.value;
  });
}
