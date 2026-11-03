// The view this device chose, before the cards are drawn; libraryPage.ts keeps it from then on.
// The markup is the list; only a saved Gallery is set here.
try {
  if (localStorage.getItem("singularity:library-view") === "gallery") {
    const root = document.currentScript.closest("[data-library]");
    root.dataset.view = "gallery";
    for (const button of root.querySelectorAll("[data-library-view]"))
      button.setAttribute("aria-pressed", button.dataset.libraryView === "gallery");
  }
} catch {}
