import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import "../styles/player.css";
import "../styles/sheets.css";
import { safeSessionStorage } from "../player/core/resume";
import { startThemeSync } from "../player/core/themeRuntime";
import { playUiCue } from "../player/sound/soundController";
import { cueForSheet } from "../player/sound/soundMap";
import { RUN_STORAGE_KEY } from "./generate/runKey";
import { isSheetName, OPEN_SHEET_EVENT, type SheetName } from "./sheetEvents";
import Toaster from "./Toaster";

const loadGenerate = () => import("./GenerateSheet");
const loadSettings = () => import("./SettingsSheet");
const GenerateSheet = lazy(loadGenerate);
const SettingsSheet = lazy(loadSettings);

function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(task, { timeout: 5_000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 2_500);
  return () => clearTimeout(handle);
}

/**
 * The sheets island. Header buttons carry `data-open="generate"` (or `data-open-sheet`) or `"settings"` and are
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
      // The reader markup uses `data-open`; `data-open-sheet` is accepted too.
      const trigger = event.target.closest<HTMLElement>("[data-open-sheet], [data-open]");
      const name = trigger?.dataset.openSheet ?? trigger?.dataset.open;
      if (!trigger || !isSheetName(name)) return;
      event.preventDefault();
      openSheet(name);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [openSheet]);

  // A toast, or any other part of the app, can ask for a sheet by event.
  useEffect(() => {
    const onRequest = (event: Event): void => {
      const name = event instanceof CustomEvent ? event.detail : null;
      if (isSheetName(name)) openSheet(name);
    };
    window.addEventListener(OPEN_SHEET_EVENT, onRequest);
    return () => window.removeEventListener(OPEN_SHEET_EVENT, onRequest);
  }, [openSheet]);

  // A run remembered from before a reload is picked up, so its toast can still arrive. Only then
  // is the Generate code needed before the sheet is opened.
  useEffect(() => {
    let remembered = false;
    try {
      remembered = safeSessionStorage()?.getItem(RUN_STORAGE_KEY) != null;
    } catch {
      remembered = false;
    }
    if (!remembered) return;
    void import("./generate/generateRuntime").then(({ getGenerateStore }) => {
      getGenerateStore().resume();
    });
  }, []);

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
