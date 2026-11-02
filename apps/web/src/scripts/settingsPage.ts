/**
 * The settings page's one script. The page is static HTML with native controls, because the React
 * controls the old settings sheet used would not fit the first-load budget. This reads the
 * preferences store into the controls, keeps them in step with it, and writes changes back.
 *
 * The pure parts (parsing a control's value, what the controls should show, the order of the sound
 * cue and the preference) are exported and tested; the rest is wiring.
 */
import { hasSaved, storeOn } from "../lib/savedKey";
import {
  dismissInstallHint,
  isStandaloneDisplay,
  readDismissed,
  recordInstallVisit,
  shouldShowInstallHint,
} from "../player/core/installHint";
import {
  getPreferences,
  HUE_MAX,
  type Preferences,
  THEME_PREFERENCES,
  type ThemePreference,
  toHue,
} from "../player/core/preferences";
import { safeLocalStorage } from "../player/core/resume";
import { startThemeSync } from "../player/core/themeRuntime";
import { getHaptics, playUiCue, settleSoundSession } from "../player/sound/soundController";
import { type Cue, cueForSwitch, cueForVolumeRelease } from "../player/sound/soundMap";
import { installPromptReady, onInstallPromptChange, requestInstall } from "./installPrompt";

const ROOT_SELECTOR = "[data-settings]";

export function toTheme(value: string): ThemePreference | null {
  return THEME_PREFERENCES.find((theme) => theme === value) ?? null;
}

/** A slider's reading as a volume, or null when the control holds something that is not a number. */
export function toVolume(value: string): number | null {
  const volume = Number(value);
  if (value.trim() === "" || !Number.isFinite(volume)) return null;
  return Math.min(1, Math.max(0, volume));
}

/** "80%": how far along the slider is, for the filled part of its track and for a screen reader. */
export function volumePercent(volume: number): string {
  return `${Math.round(Math.min(1, Math.max(0, volume)) * 100)}%`;
}

/** What every control on the page should show for a set of preferences. */
export interface ControlState {
  theme: ThemePreference;
  sounds: boolean;
  /** The slider's value, as the text a range input holds. */
  volume: string;
  volumePercent: string;
  /** The volume has nothing to set while sounds are off. */
  volumeDisabled: boolean;
}

/**
 * `soundsEnabled` is passed in rather than read from `preferences.sounds`, which stays null until
 * the reader chooses: the store resolves that to on, or to off under reduced motion.
 */
export function controlState(preferences: Preferences, soundsEnabled: boolean): ControlState {
  return {
    theme: preferences.theme,
    sounds: soundsEnabled,
    volume: String(preferences.volume),
    volumePercent: volumePercent(preferences.volume),
    volumeDisabled: !soundsEnabled,
  };
}

export interface SoundsSink {
  setSounds(enabled: boolean): void;
  play(cue: Cue): void;
  /** Called after the preference changes, so the audio session follows it without waiting for a gesture. */
  settle(): void;
}

/**
 * The engine reads the preference at the moment it plays, so the order decides whether the switch is
 * heard. On: the preference first, so the confirmation is allowed to play. Off: the cue first, a last
 * confirmation, then the engine goes quiet.
 */
export function changeSounds(turningOn: boolean, sink: SoundsSink): void {
  if (turningOn) {
    sink.setSounds(true);
    sink.play(cueForSwitch(true));
  } else {
    sink.play(cueForSwitch(false));
    sink.setSounds(false);
    sink.settle();
  }
}

/**
 * The same decision the settings sheet's hook makes, from the same pure function. The player counts
 * a visit when it hydrates, which is after this runs on a page load, so the visit is counted here
 * too: counting is once per document whoever asks first, and the answer must not depend on who did.
 */
function installHintApplies(): boolean {
  const storage = safeLocalStorage();
  return shouldShowInstallHint({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    isStandalone: isStandaloneDisplay(),
    dismissed: readDismissed(storage),
    visits: recordInstallVisit(storage),
  });
}

/** Wires one settings page. Returns a teardown for when the router swaps the page away. */
function mountSettings(root: HTMLElement): () => void {
  const preferences = getPreferences();
  const theme = root.querySelector<HTMLSelectElement>('select[name="theme"]');
  const style = root.querySelector<HTMLSelectElement>('select[name="style"]');
  const hue = root.querySelector<HTMLInputElement>('input[name="hue"]');
  const sounds = root.querySelector<HTMLInputElement>('input[name="sounds"]');
  const haptics = root.querySelector<HTMLInputElement>('input[name="haptics"]');
  const hapticsSection = root.querySelector<HTMLElement>("[data-haptics-section]");
  const volume = root.querySelector<HTMLInputElement>('input[name="volume"]');
  const autoplay = root.querySelector<HTMLInputElement>('input[name="autoplay"]');
  const hint = root.querySelector<HTMLElement>("[data-install-hint]");
  const hasNotifications =
    root.hasAttribute("data-notifications-page") || root.querySelector("[data-notifications-hint]");
  const installApp = root.querySelector<HTMLElement>("[data-install-app]");

  // An edit saved in the last few minutes is not in this page until the next build: the rows' lines
  // say it, so Back from a page never lands on a summary that contradicts it. With the config store
  // on (D149), so does what it holds.
  if (hasSaved() || storeOn()) {
    void import("./settingsSaved").then((index) => index.showSaved(root)).catch(() => {});
  }

  const render = (): void => {
    const state = controlState(preferences.get(), preferences.getSoundsEnabled());
    if (theme) theme.value = state.theme;
    // A stored style tokens.json no longer holds looks like Default (the CSS has nothing for it).
    if (style) {
      const stored = preferences.get().style;
      style.value = [...style.options].some((option) => option.value === stored)
        ? stored
        : "default";
    }
    if (hue) {
      const turn = preferences.get().hue;
      hue.value = String(turn);
      // A style is what has a hue to turn: Default stays blue, so the slider waits for one.
      hue.disabled = !style || style.value === "default";
      hue.setAttribute("aria-valuetext", `${turn} degrees`);
      hue.style.setProperty("--range-fill", `${(turn / HUE_MAX) * 100}%`);
    }
    if (sounds) sounds.checked = state.sounds;
    if (haptics) haptics.checked = preferences.get().haptics;
    if (autoplay) autoplay.checked = preferences.get().autoplay;
    if (volume) {
      volume.value = state.volume;
      volume.disabled = state.volumeDisabled;
      volume.setAttribute("aria-valuetext", state.volumePercent);
      // WebKit has no pseudo-element for the filled part of a range, so the track paints it from this.
      volume.style.setProperty("--range-fill", state.volumePercent);
    }
  };

  const onChange = (event: Event): void => {
    const input = event.target;
    if (input === theme && theme) {
      const chosen = toTheme(theme.value);
      // The theme runtime watches the preference and crossfades the change; no sound.
      if (chosen) preferences.set({ theme: chosen });
      return;
    }
    if (input === style && style) {
      // The same crossfade as a theme change; no sound.
      preferences.set({ style: style.value });
      return;
    }
    if (input === haptics && haptics) {
      const on = haptics.checked;
      preferences.set({ haptics: on });
      // Turning it on is felt once, so the choice can be judged; turning it off is silent.
      if (on) getHaptics().fire("select");
      else getHaptics().cancel();
      return;
    }
    if (!(input instanceof HTMLInputElement)) return;
    if (input === autoplay) {
      preferences.set({ autoplay: input.checked });
    } else if (input === sounds) {
      changeSounds(input.checked, {
        setSounds: (enabled) => preferences.set({ sounds: enabled }),
        play: playUiCue,
        settle: settleSoundSession,
      });
    } else if (input === volume) {
      // A range reports a change when it is let go: a sample, so the level can be judged.
      playUiCue(cueForVolumeRelease());
    }
  };

  const onInput = (event: Event): void => {
    if (hue && event.target === hue) {
      // Follows the thumb, so the page, the covers and the light turn as it is dragged.
      preferences.set({ hue: toHue(Number(hue.value)) });
      return;
    }
    if (!volume || event.target !== volume) return;
    const next = toVolume(volume.value);
    if (next !== null) preferences.set({ volume: next });
  };

  const onClick = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest("[data-install-app-button]")) {
      void requestInstall();
      return;
    }
    if (!hint || !(event.target instanceof Element)) return;
    if (!event.target.closest("[data-install-dismiss]")) return;
    dismissInstallHint(safeLocalStorage());
    hint.hidden = true;
    // The button that held focus is gone with its section; the page heading is the nearest landmark.
    root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  };

  root.addEventListener("change", onChange);
  root.addEventListener("input", onInput);
  root.addEventListener("click", onClick);
  const unsubscribe = preferences.subscribe(render);
  // The islands also run this, but they hydrate when the browser is idle. Holding a share of the same
  // subscription means a theme chosen before then still applies at once.
  const stopTheme = startThemeSync();

  if (hint) hint.hidden = !installHintApplies();
  const showInstallApp = (): void => {
    if (installApp) installApp.hidden = !installPromptReady() || isStandaloneDisplay();
  };
  showInstallApp();
  const stopInstallWatch = onInstallPromptChange(showInstallApp);
  render();
  // The stylesheet keeps the switch's thumb and the slider's thumb hidden, with no transition, until
  // the page is marked ready. Reading a layout value here settles the first state under those rules,
  // so the controls appear where they belong instead of sliding there from the off position.
  void root.offsetWidth;
  // The Theme select has waited inert for the listener above (settings.astro).
  if (theme) theme.inert = false;
  if (style) style.inert = false;
  // Only a device that can answer is offered the choice (D273).
  if (hapticsSection) hapticsSection.hidden = getHaptics().support === "none";
  root.dataset.ready = "true";

  // The Notifications row's state is the browser's (D284); its code loads only where the row is.
  let stopNotifications: (() => void) | null = null;
  let gone = false;
  if (hasNotifications) {
    void import("./notificationsSettings")
      .then((page) => {
        if (gone) return;
        stopNotifications = page.mountNotifications(root);
      })
      .catch(() => {});
  }

  return () => {
    gone = true;
    stopNotifications?.();
    root.removeEventListener("change", onChange);
    root.removeEventListener("input", onInput);
    root.removeEventListener("click", onClick);
    unsubscribe();
    stopTheme();
    stopInstallWatch();
  };
}

let installed = false;

/**
 * Call once from the page's script. A bundled module script runs once per session, and the page can
 * arrive by a client-side navigation as well as by a load, so the wiring follows the router: mount on
 * astro:page-load, unmount before the page is swapped away.
 */
export function installSettingsPage(): void {
  if (installed) return;
  installed = true;
  let mounted: { root: HTMLElement; stop: () => void } | null = null;

  const unmount = (): void => {
    mounted?.stop();
    mounted = null;
  };

  const sync = (): void => {
    const root = document.querySelector<HTMLElement>(ROOT_SELECTOR);
    if (mounted && mounted.root === root) return;
    unmount();
    if (root) mounted = { root, stop: mountSettings(root) };
  };

  document.addEventListener("astro:page-load", sync);
  document.addEventListener("astro:before-swap", unmount);
  // On a full load the event waits for every resource. The markup is already here, so start now.
  sync();
}
