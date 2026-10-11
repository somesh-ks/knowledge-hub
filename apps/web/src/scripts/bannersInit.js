// The device banners before the page is first drawn, so neither pushes it down once it has shown;
// deviceBanners.ts keeps them in step from then on. The stale rule and its words come from
// staleness.ts, through this script's attributes (BaseLayout.astro).
try {
  const { digestDate, staleFrom, timeZone, title } = document.currentScript.dataset;
  const stack = document.getElementById("banners");
  const add = (kind, text) => {
    const banner = document
      .getElementById(`banner-${kind}`)
      .content.firstElementChild.cloneNode(true);
    banner.dataset.banner = kind;
    if (text) banner.querySelector(".banner-title").textContent = text;
    stack.prepend(banner);
  };
  if (!navigator.onLine) {
    document.documentElement.setAttribute("data-offline", "");
    add("offline");
  }
  if (staleFrom) {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const days = Math.round((Date.parse(today) - Date.parse(digestDate)) / 86400000);
    if (today >= staleFrom) add("stale", title.replace("{days}", days));
  }
} catch {}
