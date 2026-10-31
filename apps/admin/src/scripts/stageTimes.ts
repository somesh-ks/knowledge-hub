/**
 * The Health page's Stage times card. Asks the admin function (api/stages.ts) once and copies the
 * page's card and row templates, a card for each kind of run and a bar for each stage. A bar is as
 * long as its stage's slowest tenth against the slowest in its card, its median laid solid on it.
 * A store that does not answer says so in the card's one line, and the page keeps the rest.
 */

import { href } from "../lib/sections";
import { duration, groupTimings, type StageGroup, type StageTimingRow } from "../lib/stageTimings";

const holder = document.querySelector<HTMLElement>("[data-stage-groups]");
const cardTemplate = document.querySelector<HTMLTemplateElement>("template[data-stage-card]");
const rowTemplate = document.querySelector<HTMLTemplateElement>("template[data-stage-row]");

const part = (root: ParentNode, name: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[${name}]`);

function say(text: string): void {
  const line = holder ? part(holder, "data-stage-status") : null;
  if (line) line.textContent = text;
}

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

function drawCard(group: StageGroup): Node | null {
  const card = cardTemplate?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
  if (!card) return null;
  const title = part(card, "data-st-title");
  const runs = part(card, "data-st-runs");
  if (title) title.textContent = group.title;
  if (runs) runs.textContent = `${group.runs} ${group.runs === 1 ? "run" : "runs"}`;
  const longest = Math.max(1, ...group.stages.map((stage) => stage.p90));
  const list = part(card, "data-st-list");
  list?.replaceChildren(...group.stages.flatMap((stage) => drawRow(stage, longest) ?? []));
  return card;
}

async function load(): Promise<void> {
  if (!holder) return;
  try {
    const response = await fetch(href("/api/stages"), {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (response.status === 503) return say("Not connected");
    if (!response.ok) throw new Error(String(response.status));
    const body = (await response.json()) as { timings: StageTimingRow[] };
    const groups = groupTimings(body.timings);
    if (groups.length === 0) return say("No finished runs yet");
    holder.replaceChildren(...groups.flatMap((group) => drawCard(group) ?? []));
  } catch {
    say("Unavailable");
  }
}

void load();
