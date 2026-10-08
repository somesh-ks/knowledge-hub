/**
 * The Create page: the live estimate, the six-topic limit, the passphrase dialog, the request and
 * the wait for the episode. Every sentence it shows is in the page (`[data-k]`), not here, and it
 * imports nothing, so it stays a small file that loads with the page.
 */
const KEY = "dispatch:narrate-passphrase";

function install(): void {
  const root = document.querySelector<HTMLElement>("[data-create]");
  if (!root || root.dataset.ready !== undefined) return;
  root.dataset.ready = "";
  const $ = (selector: string) => root.querySelector(selector) as HTMLElement;
  const form = $("[data-create-form]") as HTMLFormElement;
  const dialog = $("[data-dialog]") as HTMLDialogElement;
  const dform = $("[data-dialog-form]") as HTMLFormElement;
  const pass = dform.elements.namedItem("passphrase") as HTMLInputElement;
  const remember = dform.elements.namedItem("remember") as HTMLInputElement;
  const send = $("[data-dialog-submit]") as HTMLButtonElement;
  const box = $("[data-run]");
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
    const line = $(`[data-error="${name}"]`);
    line.hidden = !text;
    if (text && line.lastElementChild) line.lastElementChild.textContent = text;
  };
  const wait = (seconds: number) => {
    const m = Math.max(1, Math.ceil(seconds / 60));
    const h = Math.round(m / 60);
    return m < 60 ? `${m} minute${m === 1 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`;
  };

  function sync(): void {
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
      topic_ids: data.getAll("topic"),
      length_minutes: Number(data.get("length")),
      format: data.get("format"),
      window_days: Number(data.get("window")),
      tone: data.get("tone"),
      ...(title ? { title } : {}),
    };
  }

  function finish(key: string): void {
    $("[data-run-working]").hidden = true;
    $("[data-run-done]").hidden = false;
    $("[data-run-result]").textContent = copy(key);
  }

  async function follow(id: number): Promise<void> {
    for (let turn = 0; turn < 300 && root?.isConnected; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const res = await fetch(`/api/status?run=${id}`).catch(() => null);
      const body = res?.ok ? await res.json().catch(() => null) : null;
      // A run the status route does not know (a 4xx): the episode was started all the same, so say
      // that and stop asking. A hiccup is asked again, until the loop runs out.
      if (res && res.status < 500 && !res.ok) break;
      if (!body?.state) continue;
      $("[data-run-hint]").textContent = copy(body.state === "queued" ? "queued" : "running");
      if (body.state === "completed")
        return finish(body.outcome === "failed" ? "failed" : "started");
    }
    finish("started");
  }

  function begin(id: number): void {
    form.hidden = true;
    box.hidden = false;
    $("[data-run-working]").hidden = false;
    $("[data-run-done]").hidden = true;
    $("[data-run-hint]").textContent = copy("queued");
    box.tabIndex = -1;
    box.focus();
    void follow(id);
  }

  form.addEventListener("change", sync);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!topics.some((topic) => topic.checked)) {
      say("topics", copy("topics"));
      topics[0]?.focus();
      return;
    }
    say("form");
    say("dialog");
    pass.value = String(store((s) => s.getItem(KEY)) ?? "");
    remember.checked = pass.value !== "";
    dialog.showModal();
  });

  $("[data-cancel]").addEventListener("click", () => dialog.close());

  dform.addEventListener("submit", async (event) => {
    event.preventDefault();
    const passphrase = pass.value.trim();
    if (!passphrase) {
      say("dialog", copy("passphrase"));
      pass.focus();
      return;
    }
    send.disabled = true;
    const res = await fetch("/api/podcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase, request: request() }),
    }).catch(() => null);
    send.disabled = false;
    const body = (await res?.json().catch(() => null)) ?? {};
    if (res?.status === 401) {
      store((s) => s.removeItem(KEY));
      say("dialog", copy("401"));
      pass.select();
      return;
    }
    if (res?.status !== 202 || !body.run_id) {
      dialog.close();
      say(
        "form",
        res?.status === 429
          ? `${copy(body.error)} ${wait(body.retry_after_s)}.`
          : copy(!res ? "network" : res.status === 400 ? "400" : "503"),
      );
      return;
    }
    store((s) => (remember.checked ? s.setItem(KEY, passphrase) : s.removeItem(KEY)));
    dialog.close();
    begin(body.run_id);
  });

  $("[data-run-again]").addEventListener("click", () => {
    box.hidden = true;
    form.hidden = false;
    $("h1").focus();
  });
  sync();
}

document.addEventListener("astro:page-load", install);
install();

// Nothing is exported: the page loads this file for what it does. This line makes it a module.
export {};
