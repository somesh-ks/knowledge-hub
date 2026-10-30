/**
 * Health page (/admin/health). Asks /api/health once and fills the rows and tiles the page drew
 * at build (lib/healthRows.ts): a value, a line and, on a row that needs a look, a glyph, by id.
 * The Speed card shows one device at a time; its select repaints from the same answer, with no
 * second fetch. A failed fetch says so in the summary and leaves the rows on "Checking".
 */
import type { HealthBody, HealthRow, HealthTone } from "../../../web/src/lib/healthRows";

const root = document.querySelector<HTMLElement>("[data-health]");
const device = document.querySelector<HTMLSelectElement>("#health-device");
let answer: HealthBody | null = null;

const DEVICE_KEY = "singularity:health-device";

/** The title says how it stands, never what to do about it. */
const STATES = { good: "Healthy", warn: "Degraded", bad: "Failing", none: "Healthy" } as const;

/** A copy of a status glyph from the page's template (StatusGlyphs.astro), so no markup is drawn here. */
function setMark(mark: Element | null, tone: HealthTone): void {
  if (!mark) return;
  mark.setAttribute("data-tone", tone);
  const copy = document
    .querySelector<HTMLTemplateElement>("template[data-glyphs]")
    ?.content.querySelector(`[data-glyph="${tone}"] > svg`)
    ?.cloneNode(true);
  mark.replaceChildren(...(copy ? [copy] : []));
}

/** Only a row that needs a look carries a glyph: a fine row is quiet. */
function paintRow(element: HTMLElement, row: HealthRow | undefined): void {
  const value = element.querySelector<HTMLElement>("[data-value]");
  const detail = element.querySelector<HTMLElement>("[data-detail]");
  if (value) value.textContent = row?.value ?? "No data";
  if (detail) detail.textContent = row?.detail ?? "Not checked";
  const tone = row?.tone === "warn" || row?.tone === "bad" ? row.tone : "none";
  setMark(element.querySelector("[data-mark]"), tone);
}

function paint(): void {
  if (!root || !answer) return;
  const byId = new Map(answer.rows.map((row) => [row.id, row]));
  const chosen = device?.value ?? "mobile";
  for (const element of root.querySelectorAll<HTMLElement>("[data-health-row]")) {
    const id = element.dataset.healthRow ?? "";
    paintRow(element, byId.get("speed" in element.dataset ? `${id}.${chosen}` : id));
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-health-tile]")) {
    element.textContent =
      answer.tiles[element.dataset.healthTile as keyof HealthBody["tiles"]] ?? "No data";
  }
  const { count, tone } = answer.attention;
  const state = count === 0 ? "good" : tone;
  const words = root.querySelector<HTMLElement>("[data-health-state]");
  if (words) words.textContent = STATES[state];
  setMark(root.querySelector("[data-health-state-mark]"), state);

  const checked = new Date(answer.checked_at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const sub = root.querySelector<HTMLElement>("[data-health-sub]");
  if (sub)
    sub.textContent = count > 0 ? `${count} flagged · checked ${checked}` : `Checked ${checked}`;
  const missing = [
    answer.parts.content === "fallback" && "the content store answered from this build's copy",
    answer.parts.content === "saved" && "the content store answered from its last saved list",
    answer.parts.database === "unavailable" && "the database did not answer",
    answer.parts.github === "unavailable" && "GitHub did not answer",
    answer.parts.github === "partial" && "GitHub answered for some workflows only",
  ].filter(Boolean);
  const note = root.querySelector<HTMLElement>("[data-health-note]");
  if (note) {
    note.textContent = missing.length ? `Partial: ${missing.join("; ")}.` : "";
  }
}

async function load(): Promise<void> {
  if (!root) return;
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    answer = (await response.json()) as HealthBody;
    paint();
  } catch {
    const words = root.querySelector<HTMLElement>("[data-health-state]");
    if (words) words.textContent = "No answer";
    setMark(root.querySelector("[data-health-state-mark]"), "none");
  } finally {
    delete root.dataset.loading;
  }
}

if (device) {
  // The device last chosen on this browser; a convenience, so a blocked storage changes nothing.
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored && [...device.options].some((option) => option.value === stored))
      device.value = stored;
  } catch {
    // Storage blocked: the first option stands.
  }
  device.addEventListener("change", () => {
    try {
      localStorage.setItem(DEVICE_KEY, device.value);
    } catch {
      // Storage blocked: the choice lasts this page.
    }
    paint();
  });
}

void load();
