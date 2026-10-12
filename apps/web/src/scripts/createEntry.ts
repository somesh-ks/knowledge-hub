/**
 * What the shell knows about Create without loading it: a press on a Create button (a link to
 * /create) opens the sheet when the script is here, and a run kept in sessionStorage is picked up
 * again after a reload or a navigation. Both load their module on demand, so this stays tiny.
 */
export function installCreateEntry(): void {
  const open = (trigger: HTMLElement) =>
    import("./createSheet")
      .then((sheet) => sheet.openCreateSheet(trigger))
      .catch(() => location.assign(trigger.getAttribute("href") ?? "/create"));

  document.addEventListener(
    "click",
    (event) => {
      const trigger = (event.target as Element).closest<HTMLElement>("[data-create-open]");
      const plain = !(
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      );
      if (!trigger || !plain) return;
      // On the Create page itself there is no sheet: the form is the page, and the side column's
      // New episode is marked as the place you are on (AppNav.astro). A press there acts as a
      // press on the current tab does: navigation.ts brings the page to its top, and the focus
      // stays on the button.
      if (!document.getElementById("create-sheet-template")) return;
      event.preventDefault();
      void open(trigger);
      // Captured, so it runs before the router's own click handler, which skips a prevented click.
    },
    true,
  );

  document.addEventListener("astro:page-load", () => {
    try {
      if (sessionStorage.getItem("dispatch:run"))
        void import("./runStatus").then((m) => m.resumeRun());
    } catch {
      // Storage can be blocked; there is then no run to pick up.
    }
  });
}
