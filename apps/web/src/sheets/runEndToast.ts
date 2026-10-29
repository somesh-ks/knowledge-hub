import type { RunRecord } from "../lib/runRecord";
import { briefingFailureLine } from "../lib/runStages";
import { digestUrl, directionBetween, navigateTo } from "../player/core/navigation";
import { getPlayerStore } from "../player/core/playerRuntime";
import { showToast } from "./toastStore";

/** Opens a finished briefing, sliding the way time points: newer is forward, older is back. */
function openBriefing(digestId: string): void {
  const current = getPlayerStore().getPageDigest()?.id ?? null;
  void navigateTo(digestUrl(digestId), { direction: directionBetween(current, digestId) });
}

/**
 * Says a briefing run has ended when its card cannot be seen: the player's open page covers it, and
 * a run can end while the person is listening (it took the toast the Regenerate sheet used to raise).
 * Anywhere else the run indicator already says it.
 */
export function toastForEndedRun(run: RunRecord, ended: "finished" | "failed"): void {
  if (document.documentElement.dataset.player !== "open") return;
  if (ended === "failed") {
    showToast({
      message: briefingFailureLine(run.step) ?? "The podcast couldn't be made.",
      kind: "error",
    });
    return;
  }
  const digestId = /^\/d\/([\w-]+)$/.exec(run.href ?? "")?.[1];
  if (digestId) {
    showToast({
      message: "Podcast ready",
      kind: "success",
      actionLabel: "Open",
      onAction: () => openBriefing(digestId),
    });
    return;
  }
  showToast({
    message:
      run.outcome === "gated" ? "The schedule held this run back." : "Nothing cleared the bar.",
  });
}
