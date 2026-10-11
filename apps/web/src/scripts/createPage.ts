import { startRun } from "./runStatus";

/**
 * The Create form: the button's length, the passphrase dialog (while the form has
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

  const voiceRows = [...form.querySelectorAll<HTMLElement>("[data-voice]")];

  /** The voices are fetched when the panel is first used, and fill the selects they belong to. */
  async function loadVoices(): Promise<void> {
    try {
      const lib = await import("../lib/voices");
      const response = await fetch("/api/voices", { signal: AbortSignal.timeout(10_000) });
      const voices = response.ok ? lib.parseVoices(await response.json()) : null;
      if (!voices) return;
      for (const select of form.querySelectorAll<HTMLSelectElement>("[data-voice] select")) {
        lib.fillVoiceSelect(select, voices, select.value);
      }
    } catch {
      // The default and the saved voice stay: an episode can always be made without the list.
    }
  }

  /** Switching the audience replaces the selection with that audience's preset; chips stay shown. */
  function applyPreset(): void {
    const audience = String(new FormData(form).get("audience"));
    for (const topic of topics) {
      topic.checked = (topic.dataset.presets ?? "").split(" ").includes(audience);
    }
  }

  function sync(): void {
    if (topics.some((topic) => topic.checked)) say("topics");
    // A discussion has two hosts, so it takes Leo's voice as well as Ada's.
    const discussion = new FormData(form).get("format") === "discussion";
    for (const voice of voiceRows) {
      if (voice.dataset.voice === "voice_b") voice.hidden = !discussion;
      voice
        .querySelector<HTMLElement>("[data-voice-caption]")
        ?.toggleAttribute("hidden", !discussion);
    }
    // The button says how long the episode will run; each length carries its own label.
    const length = form.querySelector<HTMLInputElement>('input[name="length"]:checked');
    if (length?.dataset.submitLabel)
      $("[data-submit-text]").textContent = length.dataset.submitLabel;
  }

  /** Each ticked chip adds its ids (Design sends two); an id never appears twice. */
  function topicIds(): string[] {
    const ids = topics
      .filter((topic) => topic.checked)
      .flatMap((topic) => (topic.dataset.ids || topic.value).split(" "));
    return [...new Set(ids)];
  }

  function request() {
    const data = new FormData(form);
    const title = String(data.get("title")).trim();
    return {
      audience: data.get("audience"),
      topic_ids: topicIds(),
      length_minutes: Number(data.get("length")),
      format: data.get("format"),
      window_days: Number(data.get("window")),
      tone: data.get("tone"),
      voice_id: String(data.get("voice") ?? "") || null,
      ...(data.get("format") === "discussion"
        ? { voice_id_b: String(data.get("voice_b") ?? "") || null }
        : {}),
      ...(title ? { title } : {}),
    };
  }

  // True while a request is out. The button is then aria-disabled, not disabled: it keeps its fill
  // and its focus, and a press still submits, so the handlers check this.
  let sending = false;

  /** Marks the button as working (busy, with its spinner) or gives it back. */
  function busy(button: HTMLButtonElement, on: boolean): void {
    sending = on;
    for (const name of ["aria-disabled", "aria-busy", "data-busy"]) {
      if (on) button.setAttribute(name, "true");
      else button.removeAttribute(name);
    }
  }

  /**
   * Sends the request. A refused passphrase is the caller's to explain; every other answer is
   * shown here, and a started run is followed. The button is busy until the answer is shown.
   */
  async function post(passphrase: string, button: HTMLButtonElement): Promise<"wrong" | "done"> {
    busy(button, true);
    try {
      const res = await fetch("/api/podcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase, request: request() }),
      }).catch(() => null);
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
    } finally {
      busy(button, false);
    }
  }

  form.addEventListener("change", (event) => {
    if ((event.target as HTMLInputElement | null)?.name === "audience") applyPreset();
    sync();
  });
  // The title's Enter key reads "Done": it puts the keyboard away and never submits, because a run
  // spends from the allowance. Generate is the one way to start one.
  const title = form.elements.namedItem("title");
  if (title instanceof HTMLInputElement) {
    title.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      title.blur();
    });
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    if (!topics.some((topic) => topic.checked)) {
      say("topics", copy("topics"));
      topics[0]?.focus();
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
      if (sending) return;
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

  applyPreset();
  sync();
  void loadVoices();
}

// On /create the page loads this file and the form is in the page. Elsewhere the sheet calls
// installCreate itself, so only a form inside <main> installs here.
function installOnPage(): void {
  const root = document.querySelector<HTMLElement>("main [data-create]");
  if (root) installCreate(root);
}

document.addEventListener("astro:page-load", installOnPage);
installOnPage();
