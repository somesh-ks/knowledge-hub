/**
 * Analytics page (/admin/analytics). Asks the admin function (api/analytics.ts) once and fills the
 * tiles and the four loop rows the page drew at build, by id. A store with no key says "Not
 * connected", any other failure "Unavailable", and the rows keep their names.
 */
import { type Counts, loopFigures } from "../lib/analyticsStats";
import { href } from "../lib/sections";

const root = document.querySelector<HTMLElement>("[data-analytics]");

function say(text: string): void {
  const note = root?.querySelector<HTMLElement>("[data-an-note]");
  if (note) note.textContent = text;
}

function paint(counts: Counts): void {
  if (!root) return;
  const tiles: Record<string, number> = {
    visitors: counts.visitors,
    pageviews: counts.pageviews,
    listens: counts.events.listen_half,
    shares: counts.events.share,
  };
  for (const element of root.querySelectorAll<HTMLElement>("[data-an-tile]")) {
    element.textContent = String(tiles[element.dataset.anTile ?? ""] ?? "No data");
  }
  const figures = loopFigures(counts);
  for (const row of root.querySelectorAll<HTMLElement>("[data-an-row]")) {
    const figure = figures[row.dataset.anRow ?? ""];
    const value = row.querySelector<HTMLElement>("[data-value]");
    const detail = row.querySelector<HTMLElement>("[data-detail]");
    if (value) value.textContent = figure?.value ?? "No data";
    if (detail && figure) detail.textContent = figure.line;
  }
}

async function load(): Promise<void> {
  if (!root) return;
  try {
    const response = await fetch(href("/api/analytics"), {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (response.status === 503) return say("Not connected");
    if (!response.ok) throw new Error(String(response.status));
    paint((await response.json()) as Counts);
  } catch {
    say("Unavailable");
  } finally {
    delete root.dataset.loading;
  }
}

void load();
