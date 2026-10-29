/**
 * The page's theme for this tab: System leaves the reader's saved choice alone, Light and Dark set
 * data-theme on the page and remember it in this tab only (sessionStorage), so the other pages open
 * the same way. Nothing is written to the reader's preferences.
 */
const KEY = "design:theme";

const read = (): string => {
  try {
    return sessionStorage.getItem(KEY) ?? "system";
  } catch {
    return "system";
  }
};

function apply(theme: string): void {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else if (theme === "system") {
    // Back to the reader's saved theme, which themeInit.js applied on load.
    delete root.dataset.theme;
    try {
      const raw = localStorage.getItem("singularity:preferences");
      const saved = raw ? JSON.parse(raw).theme : null;
      if (saved === "light" || saved === "dark") root.dataset.theme = saved;
    } catch {}
  }
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
