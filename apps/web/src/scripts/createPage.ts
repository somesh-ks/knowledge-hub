import { startRun } from "./runStatus";

/**
 * The Create form: the live estimate, the six-topic limit, the passphrase dialog (while the form has
 * one) and the request. The form lives on /create and in the Create sheet; both call `installCreate`.
 * Every sentence it shows is in the markup (`[data-k]`), not here. Once a run has started it hands
 * the run to the status indicator (runStatus.ts), which follows it, and calls `onStart`.
 */
const KEY = "dispatch:narrate-passphrase";

export function installCreate(root: HTMLElement, onStart?: () => void): void {
  if (root.dataset.ready !== undefined) return;
  root.dataset.ready = "";
  const $ = (selector: string) => root.querySelector(selector) as HTMLElement;
  const form = $("[data-create-form]") as HTMLFormElement;
  // Set by the page while no passphrase is asked for: what to send in its place. The page then
  // has no dialog, and the form's own button sends the request.
  const open = root.dataset.openPassphrase;
  const dialog = root.querySelector<HTMLDialogElement>("[data-dialog]");
  const topics = [...form.querySelectorAll<HTMLInputElement>('input[name="topic"]')];
  const max = Number($("[data-max]").dataset.max);
  const copy = (key: string) => root.querySelector(`[data-k="${key}"]`)?.textContent ?? "";
  const store = (run: (s: Storage) => unknown) => {
    try {
      return run(localStorage);
    } catch {
      return null;
    }
  };
  // Shows a line of error text, or hides the line when given none.
  const say = (name: string, text?: string) => {
    const line = root.querySelector<HTMLElement>(`[data-error="${name}"]`);
    if (!line) return;
    line.hidden = !text;
    if (text && line.lastElementChild) line.lastElementChild.textContent = text;
  };
  const wait = (seconds: number) => {
    const m = Math.max(1, Math.ceil(seconds / 60));
    const h = Math.round(m / 60);
    return m < 60 ? `${m} minute${m === 1 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`;
  };

  function sync(): void {
    // Each mode offers its own topics: the other mode's chips are hidden and unticked, so a request
    // only ever holds ids of the chosen mode.
    const mode = new FormData(form).get("audience");
    for (const topic of topics) {
      const chip = topic.closest<HTMLElement>("[data-mode]");
      if (!chip) continue;
      chip.hidden = chip.dataset.mode !== mode;
      if (chip.hidden) topic.checked = false;
    }
    const picked = form.querySelector<HTMLInputElement>('input[name="audience"]:checked');
    $("[data-audience-hint]").textContent = picked?.dataset.hint ?? "";
    $("[data-top-hint]").textContent = picked?.dataset.top ?? "";
    const n = topics.filter((topic) => topic.checked).length;
    for (const topic of topics) topic.disabled = !topic.checked && n >= max;
    $("[data-topics-count]").textContent = n ? `${n} chosen.` : "None chosen yet.";
    if (n) say("topics");
    const minutes = Number(new FormData(form).get("length"));
    const characters = (minutes * Number(root?.dataset.pace)).toLocaleString("en-US");
    $("[data-estimate]").textContent =
      `About ${minutes} minutes, roughly ${characters} characters of narration.`;
  }

  function request() {
    const data = new FormData(form);
    const title = String(data.get("title")).trim();
    return {
      audience: data.get("audience"),
      topic_ids: data.getAll("topic"),
      length_minutes: Number(data.get("length")),
      format: data.get("format"),
      window_days: Number(data.get("window")),
      tone: data.get("tone"),
      ...(title ? { title } : {}),
    };
  }

  /**
   * Sends the request. A refused passphrase is the caller's to explain; every other answer is
   * shown here, and a started run is followed.
   */
  async function post(passphrase: string, button: HTMLButtonElement): Promise<"wrong" | "done"> {
    button.disabled = true;
    const res = await fetch("/api/podcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase, request: request() }),
    }).catch(() => null);
    button.disabled = false;
    const body = (await res?.json().catch(() => null)) ?? {};
    if (res?.status === 401) return "wrong";
    dialog?.close();
    if (res?.status !== 202 || !body.run_id) {
      say(
        "form",
        res?.status === 429
          ? `${copy(body.error)} ${wait(body.retry_after_s)}.`
          : copy(!res ? "network" : res.status === 400 ? "400" : "503"),
      );
      return "done";
    }
    startRun(body.run_id);
    onStart?.();
    return "done";
  }

  form.addEventListener("change", sync);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!topics.some((topic) => topic.checked)) {
      say("topics", copy("topics"));
      topics.find((topic) => !topic.closest("[hidden]"))?.focus();
      return;
    }
    say("form");
    if (open !== undefined || !dialog) {
      // Nothing was asked, so a refusal here is the service's, not a mistyped passphrase.
      const sent = await post(open ?? "", $("[data-submit]") as HTMLButtonElement);
      if (sent === "wrong") say("form", copy("503"));
      return;
    }
    say("dialog");
    const pass = dialog.querySelector<HTMLInputElement>('[name="passphrase"]');
    const remember = dialog.querySelector<HTMLInputElement>('[name="remember"]');
    if (pass) pass.value = String(store((s) => s.getItem(KEY)) ?? "");
    if (remember) remember.checked = pass?.value !== "";
    dialog.showModal();
  });

  if (dialog) {
    const dform = $("[data-dialog-form]") as HTMLFormElement;
    const pass = dform.elements.namedItem("passphrase") as HTMLInputElement;
    const remember = dform.elements.namedItem("remember") as HTMLInputElement;
    const send = $("[data-dialog-submit]") as HTMLButtonElement;
    $("[data-cancel]").addEventListener("click", () => dialog.close());

    dform.addEventListener("submit", async (event) => {
      event.preventDefault();
      const passphrase = pass.value.trim();
      if (!passphrase) {
        say("dialog", copy("passphrase"));
        pass.focus();
        return;
      }
      if ((await post(passphrase, send)) === "wrong") {
        store((s) => s.removeItem(KEY));
        say("dialog", copy("401"));
        pass.select();
        return;
      }
      store((s) => (remember.checked ? s.setItem(KEY, passphrase) : s.removeItem(KEY)));
    });
  }

  sync();
}

// On /create the page loads this file and the form is in the page. Elsewhere the sheet calls
// installCreate itself, so only a form inside <main> installs here.
function installOnPage(): void {
  const root = document.querySelector<HTMLElement>("main [data-create]");
  if (root) installCreate(root);
}

document.addEventListener("astro:page-load", installOnPage);
installOnPage();
