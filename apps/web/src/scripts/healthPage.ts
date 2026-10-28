/**
 * Health page (/settings/health). Asks /api/health once and fills the rows and tiles the page drew
 * at build (lib/healthRows.ts): a value, a line and a dot per row, by id. The Speed card shows one
 * device at a time; its select repaints from the same answer, with no second fetch. A failed fetch
 * says so in the summary and leaves the rows on "Checking".
 */
import type { HealthBody, HealthRow } from "../lib/healthRows";

const root = document.querySelector<HTMLElement>("[data-health]");
const device = document.querySelector<HTMLSelectElement>("#health-device");
let answer: HealthBody | null = null;

const DEVICE_KEY = "singularity:health-device";

function paintRow(element: HTMLElement, row: HealthRow | undefined): void {
  const value = element.querySelector<HTMLElement>("[data-value]");
  const detail = element.querySelector<HTMLElement>("[data-detail]");
  const dot = element.querySelector<HTMLElement>(".status-dot");
  if (value) value.textContent = row?.value ?? "No data";
  if (detail) detail.textContent = row?.detail ?? "Not checked";
  dot?.setAttribute("data-tone", row?.tone ?? "none");
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
  const words = root.querySelector<HTMLElement>("[data-health-attention]");
  if (words)
    words.textContent =
      count === 0 ? "All good" : `${count} ${count === 1 ? "needs" : "need"} a look`;
  root
    .querySelector("[data-health-attention-dot]")
    ?.setAttribute("data-tone", count === 0 ? "good" : tone);

  const checked = new Date(answer.checked_at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const missing = [
    answer.parts.content === "fallback" && "the content store answered from this build's copy",
    answer.parts.database === "unavailable" && "the database did not answer",
    answer.parts.github === "unavailable" && "GitHub did not answer",
    answer.parts.github === "partial" && "GitHub answered for some workflows only",
  ].filter(Boolean);
  const note = root.querySelector<HTMLElement>("[data-health-note]");
  if (note) {
    note.textContent = `Checked at ${checked}.${missing.length ? ` Partial: ${missing.join("; ")}.` : ""}`;
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
    const words = root.querySelector<HTMLElement>("[data-health-attention]");
    if (words) words.textContent = "Could not check";
    root.querySelector("[data-health-attention-dot]")?.setAttribute("data-tone", "none");
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
