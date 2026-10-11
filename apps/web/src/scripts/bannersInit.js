// The offline banner before the page is first drawn, so it never pushes the page down once it has
// shown; deviceBanners.ts keeps it in step from then on. The offline page says it itself and asks
// for no banner (data-device-banner="off").
try {
  if (!navigator.onLine) {
    document.documentElement.setAttribute("data-offline", "");
    if (document.documentElement.dataset.deviceBanner !== "off") {
      const banner = document
        .getElementById("banner-offline")
        .content.firstElementChild.cloneNode(true);
      banner.dataset.banner = "offline";
      document.getElementById("banners").prepend(banner);
    }
  }
} catch {}
// A Play pressed before the player has loaded is kept, shown as preparing, and pressed again once
// it has (player/core/earlyTap.ts). The audio is unlocked inside the tap, so a phone lets it start.
// Once per document: a navigation runs this again, and by then the player is listening.
if (!window.dispatchEarlyPlay) {
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
}
