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
      // On the Create page itself there is no sheet: the form is the page. New episode then takes
      // the person to the form's first control (navigation.ts brings the page to its top), so the
      // press is never a link to the page already on screen that does nothing.
      if (!document.getElementById("create-sheet-template")) {
        const first = document.querySelector<HTMLElement>(
          "main [data-create-form] :is(input, select, textarea, button)",
        );
        if (!first) return;
        event.preventDefault();
        first.focus({ preventScroll: true });
        return;
      }
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
