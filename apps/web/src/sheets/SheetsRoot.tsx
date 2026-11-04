import {
  type ComponentProps,
  type ComponentType,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "../styles/player.css";
import "../styles/drawer.css";
import "../styles/sheets.css";
import { claimEnd, endedRecently, RUN_EVENT, readRunRecord } from "../lib/runRecord";
import { startThemeSync } from "../player/core/themeRuntime";
import { playUiCue } from "../player/sound/soundController";
import { cueForGenerate, cueForSheet } from "../player/sound/soundMap";
import { takeEarlySheet } from "../scripts/islandWake";
import { toastForEndedRun } from "./runEndToast";
import { isSheetName, OPEN_SHEET_EVENT, type SheetName } from "./sheetEvents";
import Toaster from "./Toaster";

/**
 * The sheet's chunk, kept once it has loaded: a sheet opened by a menu pick must be on screen in
 * the frame after the pick, and a lazy component that has to suspend costs it a few.
 */
let loadedGenerate: typeof import("./GenerateSheet") | null = null;
const loadGenerate = () => import("./GenerateSheet").then((module) => (loadedGenerate = module));
const LazyGenerateSheet = lazy(loadGenerate);

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

  // A sheet opened by a pick in a menu takes over the menu's scrim.
  const [handoff, setHandoff] = useState(false);
  // The component is fixed when the sheet first mounts, so it is not replaced while it is open.
  const generateRef = useRef<ComponentType<ComponentProps<typeof LazyGenerateSheet>> | null>(null);

  const openSheet = useCallback((name: SheetName, fromMenu = false) => {
    setMounted((current) => (current[name] ? current : { ...current, [name]: true }));
    generateRef.current ??= loadedGenerate?.default ?? LazyGenerateSheet;
    setHandoff(fromMenu);
    setActive(name);
    playUiCue(cueForSheet(true));
  }, []);

  const closeSheet = useCallback((name: SheetName, open: boolean) => {
    if (open) return;
    setActive((current) => (current === name ? null : current));
    // The sheet's own exit fades; the hand-off is only for the way in.
    setHandoff(false);
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
      openSheet(name, trigger.closest("[popover]") !== null);
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

  // A run finishes in the run script, not in this island. Its end is told here, once for each outcome:
  // the sound a Regenerate always had, and a toast for a failure the open player covers. The queue
  // keeps every run that ended, so there is no "ready" toast.
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

  const Generate = generateRef.current;
  return (
    <>
      <Suspense fallback={null}>
        {mounted.generate && Generate ? (
          <Generate
            open={active === "generate"}
            handoff={handoff}
            onOpenChange={(open) => closeSheet("generate", open)}
          />
        ) : null}
      </Suspense>
      <Toaster />
    </>
  );
}
