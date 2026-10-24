// The view this device chose, before the cards are drawn; libraryPage.ts keeps it from then on.
try {
  if (localStorage.getItem("singularity:library-view") === "list") {
    const root = document.currentScript.closest("[data-library]");
    root.dataset.view = "list";
    for (const button of root.querySelectorAll("[data-library-view]"))
      button.setAttribute("aria-pressed", button.dataset.libraryView === "list");
  }
} catch {}
