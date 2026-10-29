/**
 * A component page's live preview: the controls make a state, the spec renders it, and the stage is
 * brought to it in place (morph.ts) so the part's own transitions run. The stage also behaves as the
 * component does for the interactions that need script in the app: tabs select, pressed buttons toggle.
 */
import { type DesignState, defaultState } from "../../../web/src/lib/designSpec";
import { designSpecById } from "../../../web/src/lib/designSpecs";
import { prettyMarkup } from "../lib/format";
import { morph } from "../lib/morph";
import "./themeChoice";

const page = document.querySelector<HTMLElement>("[data-spec]");
const spec = page ? designSpecById(page.dataset.spec ?? "") : undefined;
const stage = document.querySelector<HTMLElement>("[data-stage]");
const code = document.querySelector<HTMLElement>("[data-code]");
const form = document.querySelector<HTMLFormElement>("[data-controls]");

if (spec && stage) {
  const read = (): DesignState => {
    const state = defaultState(spec.controls);
    for (const control of spec.controls) {
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(`[data-control="${control.id}"]`),
      );
      if (control.kind === "choice")
        state[control.id] = inputs.find((input) => input.checked)?.value ?? control.value;
      else if (control.kind === "toggle") state[control.id] = inputs[0]?.checked ?? control.value;
      else state[control.id] = inputs[0]?.value ?? control.value;
    }
    return state;
  };

  const draw = (): void => {
    const html = spec.render(read());
    morph(stage, html);
    if (code) code.textContent = prettyMarkup(html);
  };
  form?.addEventListener("input", draw);
  form?.addEventListener("submit", (event) => event.preventDefault());

  stage.addEventListener("click", (event) => {
    const target = event.target as Element;
    // A link in a specimen goes nowhere.
    if (target.closest("a")) event.preventDefault();
    const tab = target.closest<HTMLElement>('[role="tab"]');
    if (tab && tab.getAttribute("aria-disabled") !== "true") {
      const list = tab.closest('[role="tablist"]');
      for (const other of list?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []) {
        const selected = other === tab;
        other.setAttribute("aria-selected", String(selected));
        other.tabIndex = selected ? 0 : -1;
      }
      return;
    }
    const pressable = target.closest<HTMLElement>("button[aria-pressed]");
    if (pressable)
      pressable.setAttribute(
        "aria-pressed",
        String(pressable.getAttribute("aria-pressed") !== "true"),
      );
  });

  document
    .querySelector<HTMLButtonElement>("[data-copy]")
    ?.addEventListener("click", async (event) => {
      const label = (event.currentTarget as HTMLButtonElement).querySelector("span");
      try {
        await navigator.clipboard.writeText(code?.textContent ?? "");
        if (label) label.textContent = "Copied";
        setTimeout(() => {
          if (label) label.textContent = "Copy";
        }, 1600);
      } catch {}
    });
}
