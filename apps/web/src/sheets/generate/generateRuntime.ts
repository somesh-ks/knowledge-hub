import { announce } from "../../player/core/announcerDom";
import { digestUrl, directionBetween, navigateTo } from "../../player/core/navigation";
import { getPlayerStore } from "../../player/core/playerRuntime";
import { safeSessionStorage } from "../../player/core/resume";
import { playUiCue } from "../../player/sound/soundController";
import { cueForGenerate } from "../../player/sound/soundMap";
import { requestSheet } from "../sheetEvents";
import { showToast } from "../toastStore";
import { failureTitle } from "./generateSteps";
import { createGenerateStore, type FinishedRun, type GenerateStore } from "./generateStore";

let store: GenerateStore | null = null;

/** Opens a finished briefing, sliding the way time points: newer is forward, older is back. */
export function openBriefing(digestId: string): void {
  const current = getPlayerStore().getPageDigest()?.id ?? null;
  void navigateTo(digestUrl(digestId), { direction: directionBetween(current, digestId) });
}

function toastForFinishedRun(run: FinishedRun, reopen: () => void): void {
  if (run.phase === "published" && run.digestId) {
    const digestId = run.digestId;
    showToast({
      message: "Briefing ready",
      actionLabel: "Open",
      onAction: () => openBriefing(digestId),
    });
    announce("Briefing ready.");
    return;
  }
  if (run.phase === "nothing") {
    showToast({ message: "Nothing cleared the bar." });
    return;
  }
  if (run.phase === "gated") {
    showToast({ message: "The schedule held this run back." });
    return;
  }
  showToast({
    message: failureTitle(null),
    actionLabel: "Details",
    onAction: reopen,
  });
}

/**
 * The Generate store, wired to the real network, sounds, announcements and toast. The toast's
 * "Details" action brings the sheet back by event.
 */
export function getGenerateStore(): GenerateStore {
  store ??= createGenerateStore({
    fetch: (input, init) => fetch(input, init),
    isOnline: () => navigator.onLine,
    storage: safeSessionStorage(),
    onCue: (kind) => playUiCue(cueForGenerate(kind)),
    onAnnounce: announce,
    onFinishedWhileClosed: (run) => toastForFinishedRun(run, () => requestSheet("generate")),
  });
  return store;
}
