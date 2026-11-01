(() => {
  try {
    const {
      theme: t,
      style: s,
      hue: h,
    } = JSON.parse(localStorage.getItem("singularity:preferences") || "0") || {};
    const d = document.documentElement.dataset;
    if (t === "light" || t === "dark") d.theme = t;
    if (typeof s === "string" && s !== "default" && /^[a-z][a-z-]{0,23}$/.test(s)) {
      d.style = s;
      // The reader's turn of the style's hue (D312), in the slider's own steps.
      const turn = Math.min(355, Math.max(0, Math.round(h / 5) * 5));
      if (turn > 0) document.documentElement.style.setProperty("--hue-shift", String(turn));
    }
  } catch {}
})();
addEventListener("popstate", (e) => {
  if (!dispatchEvent(new Event("singularity:back", { cancelable: true })))
    e.stopImmediatePropagation();
});
