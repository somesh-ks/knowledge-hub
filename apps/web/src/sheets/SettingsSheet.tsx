import { Field } from "@base-ui/react/field";
import { Slider } from "@base-ui/react/slider";
import { Switch } from "@base-ui/react/switch";
import { getPlayerStore } from "../player/core/playerRuntime";
import { PLAYBACK_RATES, type PlaybackRate } from "../player/core/playerTypes";
import {
  getPreferences,
  THEME_PREFERENCES,
  type ThemePreference,
} from "../player/core/preferences";
import { usePreferences } from "../player/hooks/usePreferences";
import { playUiCue } from "../player/sound/soundController";
import { cueForSwitch, cueForVolumeRelease } from "../player/sound/soundMap";
import SegmentedControl from "../player/ui/SegmentedControl";
import InstallHint from "./InstallHint";
import SheetFrame from "./SheetFrame";
import { useInstallHint } from "./useInstallHint";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const THEME_OPTIONS = THEME_PREFERENCES.map((value) => ({ value, label: THEME_LABELS[value] }));
const RATE_OPTIONS = PLAYBACK_RATES.map((rate) => ({ value: String(rate), label: `${rate}x` }));

function toRate(value: string): PlaybackRate | null {
  return PLAYBACK_RATES.find((rate) => String(rate) === value) ?? null;
}

/** Theme, interface sounds, default speed, and the Home Screen hint where it applies. */
export default function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const preferences = usePreferences();
  const store = getPreferences();
  const soundsOn = preferences.sounds ?? store.getSoundsEnabled();
  const hint = useInstallHint();

  function changeSounds(checked: boolean): void {
    if (checked) {
      // On: the preference first, so the engine is allowed to play the confirmation.
      store.set({ sounds: true });
      playUiCue(cueForSwitch(true));
    } else {
      // Off: the cue first, a last confirmation, then the engine goes quiet.
      playUiCue(cueForSwitch(false));
      store.set({ sounds: false });
    }
  }

  function changeRate(value: string): void {
    const rate = toRate(value);
    if (rate === null) return;
    store.set({ rate });
    getPlayerStore().setRate(rate);
  }

  return (
    <SheetFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      closeLabel="Close settings"
    >
      <SegmentedControl
        className="sheet-group"
        legend="Theme"
        options={THEME_OPTIONS}
        value={preferences.theme}
        // The runtime watches the preference and crossfades the change; no sound.
        onChange={(theme) => store.set({ theme })}
      />

      <section className="sheet-group" aria-labelledby="settings-sound">
        <h3 id="settings-sound">Sound</h3>
        <Field.Root className="setting-row">
          <span className="setting-text">
            <Field.Label className="setting-label">Interface sounds</Field.Label>
            <Field.Description className="setting-hint">
              Soft cues for play, skips and Generate. Follows your phone's silent switch.
            </Field.Description>
          </span>
          <Switch.Root className="switch" checked={soundsOn} onCheckedChange={changeSounds}>
            <Switch.Thumb className="switch-thumb" />
          </Switch.Root>
        </Field.Root>
        <Slider.Root
          className="range"
          value={preferences.volume}
          min={0}
          max={1}
          step={0.05}
          disabled={!soundsOn}
          thumbAlignment="edge"
          onValueChange={(volume) => store.set({ volume })}
          // Releasing the slider plays a sample, so the level can be judged.
          onValueCommitted={() => playUiCue(cueForVolumeRelease())}
        >
          <Slider.Label className="range-label">Volume</Slider.Label>
          <Slider.Control className="range-control">
            <Slider.Track className="range-track">
              <Slider.Indicator className="range-indicator" />
              <Slider.Thumb className="range-thumb" />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
      </section>

      <SegmentedControl
        className="sheet-group"
        legend="Default speed"
        options={RATE_OPTIONS}
        value={String(preferences.rate)}
        onChange={changeRate}
      />

      {hint.show ? <InstallHint onDismiss={hint.dismiss} /> : null}
    </SheetFrame>
  );
}
