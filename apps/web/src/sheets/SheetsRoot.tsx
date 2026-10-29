import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import "../styles/player.css";
import "../styles/sheets.css";
import { claimEnd, endedRecently, RUN_EVENT, readRunRecord } from "../lib/runRecord";
import { startThemeSync } from "../player/core/themeRuntime";
import { playUiCue } from "../player/sound/soundController";
import { cueForGenerate, cueForSheet } from "../player/sound/soundMap";
import { takeEarlySheet } from "../scripts/islandWake";
import { toastForEndedRun } from "./runEndToast";
import { isSheetName, OPEN_SHEET_EVENT, type SheetName } from "./sheetEvents";
import Toaster from "./Toaster";

const loadGenerate = () => import("./GenerateSheet");
const GenerateSheet = lazy(loadGenerate);

function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(task, { timeout: 5_000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 2_500);
  return () => clearTimeout(handle);
}

/**
 * The sheets island. Buttons carry `data-open="generate"` (or `data-open-sheet`) and are
 * handled by delegation, so the page needs no wiring. The sheet is its own chunk, mounted on first
 * open and fetched ahead when the browser is idle.
 */
export default function SheetsRoot() {
  const [active, setActive] = useState<SheetName | null>(null);
  const [mounted, setMounted] = useState<Record<SheetName, boolean>>({ generate: false });

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
    // A press that woke this island (islandWake.ts) opens its sheet now.
    const early = takeEarlySheet();
    if (early) openSheet(early);
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

  // A run finishes in the run script, not in this island, and the queue lets go of it. Its end is
  // told here, once for each outcome: a toast for every run, and the sound a Regenerate always had.
  useEffect(() => {
    const onRun = (): void => {
      const run = readRunRecord(() => localStorage);
      const end = claimEnd(run, () => sessionStorage);
      if (!run || !end) return;
      if (end.sound) playUiCue(cueForGenerate(end.ended));
      toastForEndedRun(run, end.ended);
    };
    document.addEventListener(RUN_EVENT, onRun);
    // A run that ended while this island was loading sent its event to nobody.
    if (endedRecently(readRunRecord(() => localStorage))) onRun();
    return () => document.removeEventListener(RUN_EVENT, onRun);
  }, []);

  useEffect(() => whenIdle(() => void loadGenerate()), []);

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
      <Toaster />
    </>
  );
}
