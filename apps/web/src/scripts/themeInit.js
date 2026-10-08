(() => {
  try {
    const raw = localStorage.getItem("dispatch:preferences");
    const theme = raw ? JSON.parse(raw).theme : null;
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  } catch {}
})();
// Before the router's popstate, so the Create sheet can take Back (createSheet.ts).
addEventListener("popstate", (e) => {
  if (!dispatchEvent(new Event("dispatch:back", { cancelable: true })))
    e.stopImmediatePropagation();
});
