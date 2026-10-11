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
// A Play pressed before the player has loaded is kept, shown as preparing, and pressed again once
// it has (player/core/earlyTap.ts). The audio is unlocked inside the tap, so a phone lets it start.
(() => {
  const early = { chip: null, state: null, audio: null };
  const onClick = (e) => {
    const chip = e.target instanceof Element && e.target.closest("[data-play-digest]");
    if (!chip || early.chip || chip.getAttribute("aria-disabled") === "true") return;
    early.chip = chip;
    early.state = chip.dataset.state;
    chip.dataset.state = "preparing";
    chip.setAttribute("aria-busy", "true");
    try {
      const audio = new Audio("/silence.wav");
      early.audio = audio;
      audio.play().then(
        () => audio.pause(),
        () => {},
      );
    } catch {}
  };
  early.stop = () => removeEventListener("click", onClick, true);
  addEventListener("click", onClick, true);
  window.dispatchEarlyPlay = early;
})();
