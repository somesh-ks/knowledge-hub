(() => {
  try {
    // One preferences object, shared with the settings sheet (player/core/preferences.ts). Anything
    // other than light or dark means "follow the system", so no attribute is set.
    const raw = localStorage.getItem("dispatch:preferences");
    const theme = raw ? JSON.parse(raw).theme : null;
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  } catch {}
})();

// Back with the Create sheet open closes it and stays on the page. Registered here, ahead of the
// router's own popstate listener, so the sheet (scripts/createSheet.ts) can stop that one.
addEventListener("popstate", (event) => {
  if (!document.dispatchEvent(new Event("dispatch:back", { cancelable: true }))) {
    event.stopImmediatePropagation();
  }
});
