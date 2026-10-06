(() => {
  try {
    // One preferences object, shared with the settings sheet (player/core/preferences.ts). Anything
    // other than light or dark means "follow the system", so no attribute is set.
    const raw = localStorage.getItem("dispatch:preferences");
    const theme = raw ? JSON.parse(raw).theme : null;
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  } catch {}
})();
