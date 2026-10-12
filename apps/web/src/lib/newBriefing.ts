/**
 * The New briefing sheet's lede, worked out in the browser when the sheet opens: a new run covers
 * what came in after the latest briefing's window closed, so it says since when. The same words as
 * the build's sinceLabel (format.ts), without importing the core package into the sheets island
 * (its schema library probes for eval, which the page's CSP refuses).
 */

const ZONE = "Europe/Stockholm";
const isoDay = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE });
const weekdayName = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, weekday: "long" });
const dayMonth = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  day: "numeric",
  month: "long",
});

const DAY_MS = 86_400_000;

export function newBriefingLede(windowTo: string | undefined, now: Date): string {
  const from = windowTo ? new Date(windowTo) : null;
  const days =
    from && !Number.isNaN(from.getTime())
      ? Math.round(
          (Date.parse(`${isoDay.format(now)}T00:00:00Z`) -
            Date.parse(`${isoDay.format(from)}T00:00:00Z`)) /
            DAY_MS,
        )
      : 0;
  const span =
    !from || days <= 0
      ? "since the last briefing"
      : days <= 6
        ? `since ${weekdayName.format(from)}`
        : `since ${dayMonth.format(from)}`;
  return `Covers everything ${span}. Takes a few minutes.`;
}
