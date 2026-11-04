/**
 * The Health page's stage bars. Asks the admin function (api/stages.ts) and puts each kind's stages in
 * that kind's Pipeline card (health.astro), under its run columns; a kind with no card of its own
 * (Catch up) gets one from the page's template after them. A bar is as long as its stage's slowest
 * tenth against the slowest in its card, its median laid solid on it. A store that does not answer
 * says so in the banner (lib/problem.ts), and the run columns stand on their own.
 */

import { askKept } from "../lib/kept";
import { href } from "../lib/sections";
import { duration, groupTimings, type StageGroup, type StageTimingRow } from "../lib/stageTimings";

const holder = document.querySelector<HTMLElement>("[data-stage-groups]");
const cardTemplate = document.querySelector<HTMLTemplateElement>("template[data-stage-card]");
const rowTemplate = document.querySelector<HTMLTemplateElement>("template[data-stage-row]");

const part = (root: ParentNode, name: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[${name}]`);

function drawRow(stage: StageGroup["stages"][number], longest: number): Node | null {
  const row = rowTemplate?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
  if (!row) return null;
  const words = `Median ${duration(stage.p50)}, slowest tenth ${duration(stage.p90)}`;
  const name = part(row, "data-st-name");
  const bar = part(row, "data-st-bar");
  const figure = part(row, "data-st-figure");
  if (name) name.textContent = stage.label;
  if (figure) figure.textContent = duration(stage.p50);
  if (bar) {
    bar.setAttribute("aria-label", words);
    bar.style.setProperty("--median", String(stage.p50 / longest));
    bar.style.setProperty("--reach", String(stage.p90 / longest));
  }
  row.title = words;
  return row;
}

/** The kind's own card when the page has one, else a new card from the template. */
function cardFor(group: StageGroup): HTMLElement | null {
  const kind = group.id.split(".").at(-1) ?? "";
  const own = holder?.querySelector<HTMLElement>(`[data-kind-card="${CSS.escape(kind)}"]`);
  if (own) return own;
  const card = cardTemplate?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
  if (!card) return null;
  card.dataset.stageCard = "";
  const title = part(card, "data-st-title");
  const runs = part(card, "data-st-runs");
  if (title) title.textContent = group.title;
  if (runs) runs.textContent = `${group.runs} ${group.runs === 1 ? "run" : "runs"}`;
  return card;
}

function drawGroups(groups: StageGroup[]): void {
  if (!holder) return;
  for (const made of holder.querySelectorAll("[data-stage-card]")) made.remove();
  // After the runs card, before the jobs.
  const jobs =
    holder.querySelector("[data-kind-card]")?.closest(".card-group")?.nextElementSibling ?? null;
  for (const group of groups) {
    const card = cardFor(group);
    if (!card) continue;
    const longest = Math.max(1, ...group.stages.map((stage) => stage.p90));
    part(card, "data-st-list")?.replaceChildren(
      ...group.stages.flatMap((stage) => drawRow(stage, longest) ?? []),
    );
    if (!card.isConnected) holder.insertBefore(card, jobs);
  }
}

async function load(): Promise<void> {
  if (!holder) return;
  // This device's last answer first, the fresh one when it lands (lib/kept.ts).
  await askKept<{ timings: StageTimingRow[] }>(
    href("/api/stages"),
    "stages",
    (body) => drawGroups(groupTimings(body.timings)),
    { title: "Stage times didn't load" },
  );
}

void load();
