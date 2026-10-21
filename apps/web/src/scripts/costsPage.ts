/**
 * Settings > Costs. Asks /api/costs for the report and writes it into the page's rows. Plain DOM,
 * no framework: the numbers are one fetch, and this page loads nothing else.
 */
interface Rollup {
  usd: number;
  runs: number;
  shared_usd: number;
}
interface CostResponse {
  time_zone: string;
  prices_as_of: string;
  unconfirmed: string[];
  site: "ok" | "unavailable";
  report: {
    buckets: Array<{ bucket: string; total: Rollup; groups: Record<string, Rollup> }>;
    total: Rollup;
    per_run_usd: number;
    per_user_usd: number;
    users: number;
  };
}

const usd = (n: number): string => `$${n.toFixed(n < 1 ? 4 : 2)}`;

function row(label: string, hint: string, value: string, group = false): HTMLElement {
  const el = document.createElement("div");
  el.className = group ? "settings-row cost-row cost-group" : "settings-row cost-row";
  const text = document.createElement("span");
  text.className = "settings-text";
  const name = document.createElement("span");
  name.className = "settings-label";
  name.textContent = label;
  const sub = document.createElement("span");
  sub.className = "settings-hint";
  sub.textContent = hint;
  text.append(name, sub);
  const amount = document.createElement("span");
  amount.className = "cost-value";
  amount.textContent = value;
  el.append(text, amount);
  return el;
}

function render(data: CostResponse): void {
  const total = document.querySelector("[data-costs-total]");
  const rows = document.querySelector("[data-costs-rows]");
  const note = document.querySelector("[data-costs-note]");
  if (!total || !rows || !note) return;
  const { report } = data;
  total.replaceChildren(
    row(
      "Spent",
      `${report.total.runs} runs, ${usd(report.total.shared_usd)} shared`,
      usd(report.total.usd),
    ),
    row("Per run", "Average over runs", usd(report.per_run_usd)),
    row(
      "Per user",
      `${report.users} user${report.users === 1 ? "" : "s"}`,
      usd(report.per_user_usd),
    ),
  );
  rows.replaceChildren(
    ...[...report.buckets].reverse().flatMap(({ bucket, total: sum, groups }) => [
      row(bucket, `${sum.runs} runs`, usd(sum.usd)),
      ...Object.entries(groups)
        .sort(([, a], [, b]) => b.usd - a.usd)
        .map(([name, group]) => row(name, `${group.runs} runs`, usd(group.usd), true)),
    ]),
  );
  const parts = [`Days in ${data.time_zone}. Prices as of ${data.prices_as_of}.`];
  if (data.unconfirmed.length > 0) parts.push(`Not yet confirmed: ${data.unconfirmed.join(", ")}.`);
  if (data.site === "unavailable")
    parts.push("Narration on Play could not be read, so it is left out.");
  note.textContent = parts.join(" ");
}

async function load(): Promise<void> {
  const period = (document.getElementById("costs-period") as HTMLSelectElement).value;
  const by = (document.getElementById("costs-by") as HTMLSelectElement).value;
  const status = document.querySelector("[data-costs-status]");
  try {
    const response = await fetch(`/api/costs?period=${period}&by=${by}`);
    if (!response.ok) throw new Error(String(response.status));
    render((await response.json()) as CostResponse);
  } catch {
    if (status) status.textContent = "The costs could not be loaded right now.";
  }
}

for (const id of ["costs-period", "costs-by"]) {
  document.getElementById(id)?.addEventListener("change", () => void load());
}
void load();
