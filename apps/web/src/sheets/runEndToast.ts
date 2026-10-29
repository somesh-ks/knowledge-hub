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

/** True when `href` is the page on screen. */
const onPage = (href: string): boolean =>
  new URL(href, location.href).pathname.replace(/\/$/, "") === location.pathname.replace(/\/$/, "");

/**
 * Says a run has ended. The podcast queue lets go of a run that finished, so the toast is how it is
 * found: "Podcast ready" or "Episode ready" with Open (it stays until used or dismissed), or what
 * a rewrite or a removal did. A run that failed stays in the queue with its reason; the toast adds
 * to that only while the player's open page covers the queue.
 */
export function toastForEndedRun(run: RunRecord, ended: "finished" | "failed"): void {
  const briefing = run.what === "briefing";
  if (ended === "failed") {
    if (document.documentElement.dataset.player !== "open") return;
    showToast({
      message: briefing
        ? (briefingFailureLine(run.step) ?? "The podcast couldn't be made.")
        : "The episode couldn't be made.",
      kind: "error",
    });
    return;
  }
  if (run.kind === "delete") {
    showToast({ message: "Episode removed", kind: "success" });
    return;
  }
  if (run.kind === "regenerate") {
    showToast({ message: "Rewritten. Live in about a minute.", kind: "success" });
    return;
  }
  if (briefing) {
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
    return;
  }
  // A new episode found on the page already on screen has nothing left to open.
  const href = run.href;
  if (!href || onPage(href)) {
    showToast({ message: "Episode ready", kind: "success" });
    return;
  }
  showToast({
    message: "Episode ready",
    kind: "success",
    actionLabel: "Open",
    onAction: () => void navigateTo(href),
  });
}
