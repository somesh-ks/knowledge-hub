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
