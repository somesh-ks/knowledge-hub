(() => {
  try {
    const stored = localStorage.getItem("dispatch-theme");
    if (stored === "light" || stored === "dark") document.documentElement.dataset.theme = stored;
  } catch {}
})();
