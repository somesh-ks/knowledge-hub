/**
 * Settings > Default playback speed: the value is a button that opens the player's speed screen
 * (player/ui/SpeedPanel.tsx: a big readout, a stepper and a slider in 0.25x steps) in a Menu sheet,
 * a bottom sheet on a phone and a popover under the value from 40rem (D338). Each change is saved at
 * once, snapped by toPlaybackRate, with the player's other preferences on this device; the player reads it
 * when an episode starts. React and the panel load the first time the sheet opens, so the page's first
 * load stays light (checkBundle); the value on the button is drawn at once.
 */
import { MENU_SELECTORS } from "../design-system/menu";
import { toPlaybackRate } from "../player/core/playerTypes";
import { getPreferences } from "../player/core/preferences";
import { rateLabel } from "../player/rateLabels";
import { installHeroMenu } from "./heroMenu";

const mounted = new WeakSet<Element>();

/** The select shows the speed: an option is added for one the presets do not hold (1.05x). */
function show(select: HTMLSelectElement, rate: number): void {
  if (![...select.options].some((option) => Number(option.value) === rate)) {
    select.add(new Option(rateLabel(rate), String(rate)), 0);
  }
  select.value = String(rate);
}

function mount(): void {
  const select = document.querySelector<HTMLSelectElement>("select[data-default-speed]");
  const root = document.querySelector<HTMLElement>("[data-speed-root]");
  const sheet = root?.closest<HTMLElement>(MENU_SELECTORS.list);
  if (!select || !root || !sheet || mounted.has(sheet)) return;
  mounted.add(sheet);
  const preferences = getPreferences();
  let rate = toPlaybackRate(preferences.get().rate);
  show(select, rate);

  let draw: (() => void) | null = null;
  const load = async (): Promise<void> => {
    const [{ createElement }, { createRoot }, { default: SpeedPanel }] = await Promise.all([
      import("react"),
      import("react-dom/client"),
      import("../player/ui/SpeedPanel"),
    ]);
    const react = createRoot(root);
    draw = (): void => {
      react.render(
        createElement(SpeedPanel, {
          rate,
          onRate: (next: number) => {
            rate = toPlaybackRate(next);
            preferences.set({ rate });
            show(select, rate);
            draw?.();
          },
        }),
      );
    };
    draw();
  };

  let loading: Promise<void> | null = null;
  sheet.addEventListener("beforetoggle", (event) => {
    if ((event as ToggleEvent).newState === "open") loading ??= load();
  });
}

export function installDefaultSpeed(): void {
  installHeroMenu();
  document.addEventListener("astro:page-load", mount);
  mount();
}
