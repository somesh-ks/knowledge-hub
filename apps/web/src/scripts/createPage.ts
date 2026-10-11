import type { Voice } from "../lib/voices";
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
  const more = root.querySelector<HTMLDetailsElement>("[data-create-more]");
  const note = root.querySelector<HTMLElement>("[data-preset-note]");
  // The voice each select's Default stands for, once /api/voices has said, and every voice by id.
  const defaultVoices: Record<string, Voice> = {};
  const known = new Map<string, Voice>();
  // The hosts' names are worked out as the engine works them out, from the voices (hosts.ts in core),
  // so the line under the format says the names the episode will use. Loaded with the voice list.
  let hostNames: typeof import("@dispatch/core/hosts").hostNamesFor | null = null;

  /** The voices are fetched when the panel is first used, and fill the selects they belong to. */
  async function loadVoices(): Promise<void> {
    try {
      const [lib, hosts] = await Promise.all([
        import("../lib/voices"),
        import("@dispatch/core/hosts"),
      ]);
      hostNames = hosts.hostNamesFor;
      const response = await fetch("/api/voices", { signal: AbortSignal.timeout(10_000) });
      const body: unknown = response.ok ? await response.json() : null;
      const voices = lib.parseVoices(body);
      if (!voices) return;
      const defaults = lib.parseVoiceDefaults(body);
      for (const voice of voices) known.set(voice.id, voice);
      for (const select of form.querySelectorAll<HTMLSelectElement>("[data-voice] select")) {
        // Default reads "Default (Ada)": the voice it stands for in this host's place.
        const id = select.name === "voice_b" ? defaults?.voice_b : defaults?.voice;
        const fallback = voices.find((voice) => voice.id === id);
        if (fallback) defaultVoices[select.name] = fallback;
        lib.fillVoiceSelect(select, voices, select.value, fallback);
      }
      sync();
    } catch {
      // The default and the saved voice stay: an episode can always be made without the list.
    }
  }

  // True once a chip has been ticked or unticked by hand since the last suggestion was applied.
  let picked = false;

  /** Ticks the chips the chosen audience suggests; chips stay shown. */
  function applyPreset(): void {
    const audience = String(new FormData(form).get("audience"));
    for (const topic of topics) {
      topic.checked = (topic.dataset.presets ?? "").split(" ").includes(audience);
    }
    picked = false;
    if (note) note.hidden = true;
  }

  /**
   * A new audience brings its suggested topics only while the topics are still the last
   * suggestion: picks made by hand are never replaced unseen. They stay, and a line says so and
   * offers the suggestion.
   */
  function audienceChanged(): void {
    if (!picked) applyPreset();
    else if (note) note.hidden = false;
  }

  /** The voice a select stands for, or null when the list has not said what it is. */
  function voiceOf(select: HTMLSelectElement | null): Voice | null {
    if (!select) return null;
    return (select.value === "" ? defaultVoices[select.name] : known.get(select.value)) ?? null;
  }

  function sync(): void {
    if (topics.some((topic) => topic.checked)) say("topics");
    const data = new FormData(form);
    // A discussion has two hosts, so it takes a second voice as well as the first.
    const discussion = data.get("format") === "discussion";
    for (const voice of voiceRows) {
      if (voice.dataset.voice === "voice_b") voice.hidden = !discussion;
      voice
        .querySelector<HTMLElement>("[data-voice-caption]")
        ?.toggleAttribute("hidden", !discussion);
      const select = voice.querySelector("select");
      const label = discussion ? select?.dataset.two : select?.dataset.one;
      if (select && label) select.setAttribute("aria-label", label);
    }
    const heading = root.querySelector<HTMLElement>("[data-voice-heading]");
    const headingText = discussion ? heading?.dataset.two : heading?.dataset.one;
    if (heading && headingText) heading.textContent = headingText;
    // Under the format: who will be heard, by name once the voices are known.
    const hint = root.querySelector<HTMLElement>("[data-format-hint]");
    if (hint) {
      const first = voiceOf(form.querySelector<HTMLSelectElement>('select[name="voice"]'));
      const second = voiceOf(form.querySelector<HTMLSelectElement>('select[name="voice_b"]'));
      const named = discussion ? Boolean(first && second && hostNames) : Boolean(first);
      // A readout is read by the voice, under its own name; a discussion's two hosts take the names
      // the episode will be written with.
      const hosts = discussion && hostNames ? hostNames(first, second) : null;
      const a = hosts ? hosts.a : (first?.name ?? "");
      const b = hosts ? hosts.b : (second?.name ?? "");
      const key = (discussion ? "discussion" : "readout") + (named ? "Named" : "");
      const text = (hint.dataset[key] ?? "").replace("{a}", a).replace("{b}", b);
      if (hint.textContent !== text) hint.textContent = text;
    }
    // The More options line names what it holds.
    const values = root.querySelector<HTMLElement>("[data-more-values]");
    if (values?.dataset.template) {
      const chosen = (name: string) =>
        form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.dataset.label ?? "";
      values.textContent = values.dataset.template
        .replace("{audience}", chosen("audience"))
        .replace("{window}", chosen("window"))
        .replace("{tone}", chosen("tone"));
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

  /**
   * Marks the button as working (busy, with its spinner beside "Starting…") or gives it back, with
   * the words the length gives it.
   */
  function busy(button: HTMLButtonElement, on: boolean): void {
    sending = on;
    for (const name of ["aria-disabled", "aria-busy", "data-busy"]) {
      if (on) button.setAttribute(name, "true");
      else button.removeAttribute(name);
    }
    const words = button.querySelector("[data-submit-text]");
    if (words && on) words.textContent = copy("starting");
    else if (words) sync();
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
    const name = (event.target as HTMLInputElement | null)?.name;
    if (name === "audience") audienceChanged();
    if (name === "topic") picked = true;
    sync();
  });
  root.querySelector("[data-preset-apply]")?.addEventListener("click", () => {
    applyPreset();
    sync();
    // The button is gone with its line: focus goes to the first topic it ticked.
    topics.find((topic) => topic.checked)?.focus();
  });
  // A wide /create page keeps More options open beside the main questions (create.css lays it out);
  // there its row is a heading, not a switch. In the sheet and on narrower pages it opens in place.
  if (more && root.closest("main")) {
    const wide = matchMedia("(min-width: 80rem)");
    const pin = () => {
      if (wide.matches) more.open = true;
      more.toggleAttribute("data-pinned", wide.matches);
    };
    more.querySelector("summary")?.addEventListener("click", (event) => {
      if (more.hasAttribute("data-pinned")) event.preventDefault();
    });
    wide.addEventListener("change", pin);
    pin();
  }
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
