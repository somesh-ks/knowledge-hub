(() => {
  try {
    const raw = localStorage.getItem("singularity:preferences");
    const stored = raw ? JSON.parse(raw) : null;
    const theme = stored?.theme;
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    // The same shape preferences.ts accepts; "default" is the absence of the attribute.
    const style = stored?.style;
    if (typeof style === "string" && style !== "default" && /^[a-z][a-z-]{0,23}$/.test(style)) {
      document.documentElement.dataset.style = style;
    }
  } catch {}
})();
// Before the router's popstate, so the Create sheet can take Back (createSheet.ts).
addEventListener("popstate", (e) => {
  if (!dispatchEvent(new Event("singularity:back", { cancelable: true })))
    e.stopImmediatePropagation();
});
