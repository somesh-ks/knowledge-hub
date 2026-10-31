(() => {
  try {
    const p = JSON.parse(localStorage.getItem("singularity:preferences") || "null") || {};
    const d = document.documentElement.dataset;
    if (p.theme === "light" || p.theme === "dark") d.theme = p.theme;
    if (typeof p.style === "string" && p.style !== "default" && /^[a-z][a-z-]{0,23}$/.test(p.style))
      d.style = p.style;
  } catch {}
})();
