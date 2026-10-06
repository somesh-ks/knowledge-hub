import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import "../styles/player.css";
import "../styles/sheets.css";
import { startThemeSync } from "../player/core/themeRuntime";
import { playUiCue } from "../player/sound/soundController";
import { cueForSheet } from "../player/sound/soundMap";
import { getGenerateStore } from "./generate/generateRuntime";
import Toaster from "./Toaster";

type SheetName = "generate" | "settings";

const loadGenerate = () => import("./GenerateSheet");
const loadSettings = () => import("./SettingsSheet");
const GenerateSheet = lazy(loadGenerate);
const SettingsSheet = lazy(loadSettings);

function isSheetName(value: string | undefined): value is SheetName {
  return value === "generate" || value === "settings";
}

function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(task, { timeout: 5_000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 2_500);
  return () => clearTimeout(handle);
}

/**
 * The sheets island. Header buttons carry `data-open-sheet="generate"` or `"settings"` and are
 * handled by delegation, so the page needs no wiring. Each sheet is its own chunk, fetched when the
 * browser is idle and mounted on first open.
 */
export default function SheetsRoot() {
  const [active, setActive] = useState<SheetName | null>(null);
  const [mounted, setMounted] = useState<Record<SheetName, boolean>>({
    generate: false,
    settings: false,
  });

  const openSheet = useCallback((name: SheetName) => {
    setMounted((current) => (current[name] ? current : { ...current, [name]: true }));
    setActive(name);
    playUiCue(cueForSheet(true));
  }, []);

  const closeSheet = useCallback((name: SheetName, open: boolean) => {
    if (open) return;
    setActive((current) => (current === name ? null : current));
    playUiCue(cueForSheet(false));
  }, []);

  useEffect(() => startThemeSync(), []);

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return;
      const trigger = event.target.closest<HTMLElement>("[data-open-sheet]");
      const name = trigger?.dataset.openSheet;
      if (!trigger || !isSheetName(name)) return;
      event.preventDefault();
      openSheet(name);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [openSheet]);

  // A run remembered from before a reload is picked up, so its toast can still arrive.
  useEffect(() => {
    getGenerateStore(() => openSheet("generate")).resume();
  }, [openSheet]);

  useEffect(
    () =>
      whenIdle(() => {
        void loadGenerate();
        void loadSettings();
      }),
    [],
  );

  return (
    <>
      <Suspense fallback={null}>
        {mounted.generate ? (
          <GenerateSheet
            open={active === "generate"}
            onOpenChange={(open) => closeSheet("generate", open)}
          />
        ) : null}
      </Suspense>
      <Suspense fallback={null}>
        {mounted.settings ? (
          <SettingsSheet
            open={active === "settings"}
            onOpenChange={(open) => closeSheet("settings", open)}
          />
        ) : null}
      </Suspense>
      <Toaster />
    </>
  );
}
