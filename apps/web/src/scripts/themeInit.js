(() => {
  try {
    const { theme: t, style: s } =
      JSON.parse(localStorage.getItem("singularity:preferences") || "0") || {};
    const d = document.documentElement.dataset;
    if (t === "light" || t === "dark") d.theme = t;
    if (typeof s === "string" && s !== "default" && /^[a-z][a-z-]{0,23}$/.test(s)) d.style = s;
  } catch {}
})();
addEventListener("popstate", (e) => {
  if (!dispatchEvent(new Event("singularity:back", { cancelable: true })))
    e.stopImmediatePropagation();
});
