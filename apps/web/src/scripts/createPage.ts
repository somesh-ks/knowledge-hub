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
  // The ticks a suggestion replaced, while its line offers Undo.
  let undoTicks: boolean[] | null = null;

  /**
   * The line under Written for: what a suggestion did ("Topics set for General", with Undo), that
   * the picks made by hand were kept (with the suggestion), or nothing.
   */
  function showNote(mode: "applied" | "kept" | null): void {
    if (!note) return;
    if (mode !== "applied") undoTicks = null;
    note.hidden = mode === null;
    if (mode === null) return;
    const audience =
      form.querySelector<HTMLInputElement>('input[name="audience"]:checked')?.dataset.label ?? "";
    const text = note.querySelector("[data-preset-text]");
    if (text) text.textContent = (note.dataset[mode] ?? "").replace("{audience}", audience);
    note.querySelector("[data-preset-apply]")?.toggleAttribute("hidden", mode !== "kept");
    note.querySelector("[data-preset-undo]")?.toggleAttribute("hidden", mode !== "applied");
  }

  /** Scrolls the form, in the page or in the sheet, until the line is above the foot. */
  function revealNote(): void {
    const foot = root.querySelector<HTMLElement>(".create-submit");
    if (!note || !foot) return;
    const over = note.getBoundingClientRect().bottom - foot.getBoundingClientRect().top;
    if (over <= 0 || getComputedStyle(foot).position !== "sticky") return;
    const scroller = root.closest<HTMLElement>(".create-sheet-body");
    const by = over + note.offsetHeight;
    if (scroller) scroller.scrollBy({ top: by });
    else scrollBy({ top: by });
  }

  /** Whether the audience's suggestion ticks this topic. */
  function suggests(topic: HTMLInputElement, audience: string): boolean {
    return (topic.dataset.presets ?? "").split(" ").includes(audience);
  }

  /** Ticks the chips the chosen audience suggests; chips stay shown. */
  function applyPreset(): void {
    const audience = String(new FormData(form).get("audience"));
    for (const topic of topics) {
      topic.checked = suggests(topic, audience);
    }
    picked = false;
    showNote(null);
  }

  /**
   * A new audience brings its suggested topics only while the topics are still the last
   * suggestion, and says so with a way back, since the chips may be out of view. Picks made by
   * hand are never replaced unseen: they stay, and a line says so and offers the suggestion.
   */
  function audienceChanged(): void {
    const audience = String(new FormData(form).get("audience"));
    // The ticks already are this audience's suggestion (after an Undo, or picks that happen to match):
    // there is nothing to replace and nothing to offer, so no line and no button that does nothing.
    if (topics.every((topic) => topic.checked === suggests(topic, audience))) {
      picked = false;
      showNote(null);
      return;
    }
    if (picked) {
      showNote("kept");
      return;
    }
    const before = topics.map((topic) => topic.checked);
    applyPreset();
    if (topics.some((topic, index) => topic.checked !== before[index])) {
      showNote("applied");
      undoTicks = before;
      // In view, so what changed and the way back are seen where the choice was made: clear of the
      // foot with Generate, which stays stuck over the form below it.
      revealNote();
    }
  }

  /** The voice a select stands for, or null when the list has not said what it is. */
  function voiceOf(select: HTMLSelectElement | null): Voice | null {
    if (!select) return null;
    return (select.value === "" ? defaultVoices[select.name] : known.get(select.value)) ?? null;
  }

  // The voice each voice select stood for after the last sync, so that choosing the voice the other
  // host has hands this host's old voice over instead of leaving one voice for two named hosts.
  const lastVoice: Record<string, string | null> = {};
  const voiceSelects = [...form.querySelectorAll<HTMLSelectElement>("[data-voice] select")];

  function rememberVoices(): void {
    for (const select of voiceSelects) lastVoice[select.name] = voiceOf(select)?.id ?? null;
  }

  /** A discussion's two hosts never share a voice: taking the other host's voice swaps them. */
  function keepHostsApart(changed: HTMLSelectElement): void {
    const other = voiceSelects.find((select) => select !== changed);
    const mine = voiceOf(changed);
    const theirs = voiceOf(other ?? null);
    const before = lastVoice[changed.name];
    if (!other || !mine || !theirs || mine.id !== theirs.id || !before || before === mine.id)
      return;
    // Only a voice the list offers can be handed over.
    if (![...other.options].some((option) => option.value === before)) return;
    other.value = before;
  }

  function sync(): void {
    if (topics.some((topic) => topic.checked)) say("topics");
    const data = new FormData(form);
    // A discussion has two hosts, so it takes a second voice as well as the first.
    const discussion = data.get("format") === "discussion";
    // The voices, and the hosts' names once the voices are known (D76): a discussion's captions
    // and labels say "Ada's voice", "Leo's voice"; before that, "First host", "Second host".
    const first = voiceOf(form.querySelector<HTMLSelectElement>('select[name="voice"]'));
    const second = voiceOf(form.querySelector<HTMLSelectElement>('select[name="voice_b"]'));
    const hosts = discussion && hostNames && first && second ? hostNames(first, second) : null;
    for (const voice of voiceRows) {
      if (voice.dataset.voice === "voice_b") voice.hidden = !discussion;
      const caption = voice.querySelector<HTMLElement>("[data-voice-caption]");
      const name = hosts ? (caption?.dataset.host === "b" ? hosts.b : hosts.a) : "";
      if (caption) {
        caption.toggleAttribute("hidden", !discussion);
        const words = name
          ? (caption.dataset.named ?? "").replace("{name}", name)
          : (caption.dataset.unnamed ?? "");
        if (caption.textContent !== words) caption.textContent = words;
      }
      const select = voice.querySelector("select");
      const label = !discussion
        ? select?.dataset.one
        : name
          ? select?.dataset.twoNamed?.replace("{name}", name)
          : select?.dataset.two;
      if (select && label) select.setAttribute("aria-label", label);
    }
    const heading = root.querySelector<HTMLElement>("[data-voice-heading]");
    const headingText = discussion ? heading?.dataset.two : heading?.dataset.one;
    if (heading && headingText) heading.textContent = headingText;
    // Under the format: who will be heard, by name, once the voices are known; nothing before
    // that (the format's own name says the rest). A readout is read by the voice under its own
    // name; a discussion's two hosts take the names the episode will be written with.
    const hint = root.querySelector<HTMLElement>("[data-format-hint]");
    if (hint) {
      const named = discussion ? hosts !== null : Boolean(first);
      const a = hosts ? hosts.a : (first?.name ?? "");
      const b = hosts ? hosts.b : "";
      const key = discussion ? "discussionNamed" : "readoutNamed";
      const text = named ? (hint.dataset[key] ?? "").replace("{a}", a).replace("{b}", b) : "";
      if (hint.textContent !== text) hint.textContent = text;
      hint.hidden = !named;
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
    rememberVoices();
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
    const sent = request();
    try {
      const res = await fetch("/api/podcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase, request: sent }),
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
      // The request goes with the run, so a failure can send it again (Try again).
      startRun(body.run_id, undefined, {
        body: { request: sent },
        ...(open !== undefined ? { open } : {}),
      });
      onStart?.();
      return "done";
    } finally {
      busy(button, false);
    }
  }

  form.addEventListener("change", (event) => {
    const name = (event.target as HTMLInputElement | null)?.name;
    if (
      (name === "voice" || name === "voice_b") &&
      new FormData(form).get("format") === "discussion"
    )
      keepHostsApart(event.target as HTMLSelectElement);
    if (name === "audience") audienceChanged();
    if (name === "topic") {
      picked = true;
      // A tick by hand after a suggestion: there is nothing left to undo.
      if (undoTicks) showNote(null);
    }
    sync();
  });
  root.querySelector("[data-preset-undo]")?.addEventListener("click", () => {
    const before = undoTicks;
    if (!before) return;
    topics.forEach((topic, index) => {
      topic.checked = before[index] ?? topic.checked;
    });
    // The ticks are the person's again; a new audience must not replace them unseen. The button
    // goes with its line, so the focus goes back to the audience it came from.
    picked = true;
    form.querySelector<HTMLInputElement>('input[name="audience"]:checked')?.focus();
    showNote(null);
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
    const summary = more.querySelector("summary");
    const submitRow = form.querySelector(".create-submit");
    const pin = () => {
      const on = wide.matches;
      if (on) more.open = true;
      more.toggleAttribute("data-pinned", on);
      // The options stand in their own column, after the main questions and Generate: in the
      // source as well, so Tab goes down the first column before it moves to the second.
      if (on && submitRow && submitRow.nextElementSibling !== more) {
        submitRow.after(more);
      } else if (!on && submitRow && more.nextElementSibling !== submitRow) {
        submitRow.before(more);
      }
      // Pinned, its row is the column's heading, not a switch that does nothing: out of the Tab
      // order and named as a heading.
      if (!summary) return;
      for (const [name, value] of [
        ["tabindex", "-1"],
        ["role", "heading"],
        ["aria-level", "2"],
      ]) {
        if (on) summary.setAttribute(name, value);
        else summary.removeAttribute(name);
      }
    };
    more.querySelector("summary")?.addEventListener("click", (event) => {
      if (more.hasAttribute("data-pinned")) event.preventDefault();
    });
    wide.addEventListener("change", pin);
    pin();
  }
  // On /create the foot with Generate sticks to the bottom of the window, and wears its top line
  // only while it is stuck there with the form running on under it (create.css). It is stuck when
  // the place it would have in the page, the form's end, lies below the edge it sticks to.
  const foot = root.querySelector<HTMLElement>(".create-submit");
  if (foot && root.closest("main")) {
    const stuck = () => {
      if (!root.isConnected) {
        removeEventListener("scroll", stuck);
        removeEventListener("resize", stuck);
        return;
      }
      const style = getComputedStyle(foot);
      const edge = innerHeight - Number.parseFloat(style.insetBlockEnd);
      const on = style.position === "sticky" && form.getBoundingClientRect().bottom > edge + 1;
      if (on !== foot.hasAttribute("data-stuck")) foot.toggleAttribute("data-stuck", on);
    };
    addEventListener("scroll", stuck, { passive: true });
    addEventListener("resize", stuck, { passive: true });
    new ResizeObserver(stuck).observe(form);
    stuck();
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
    // One run at a time: a second would be refused by the cooldown, and the indicator follows one.
    if (running()) {
      say("form", busyLine());
      return;
    }
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

  // While a run is going the form says so from the start, and the line goes once the run is over.
  const reflectRun = () => {
    if (!root.isConnected) {
      document.removeEventListener("dispatch:run", reflectRun);
      return;
    }
    const line = root.querySelector<HTMLElement>('[data-error="form"]');
    const showing = line && !line.hidden && line.lastElementChild?.textContent === busyLine();
    if (!running() && showing) say("form");
  };
  document.addEventListener("dispatch:run", reflectRun);

  /** Puts a request back into the form: Try again opens it this way when it cannot send itself. */
  fillers.set(root, (sent) => {
    for (const [name, value] of [
      ["audience", sent.audience],
      ["length", sent.length_minutes],
      ["format", sent.format],
      ["window", sent.window_days],
      ["tone", sent.tone],
    ] as const) {
      const input = form.querySelector<HTMLInputElement>(
        `input[name="${name}"][value="${CSS.escape(String(value))}"]`,
      );
      if (input) input.checked = true;
    }
    const ids = new Set(Array.isArray(sent.topic_ids) ? sent.topic_ids.map(String) : []);
    for (const topic of topics) {
      topic.checked = (topic.dataset.ids || topic.value).split(" ").every((id) => ids.has(id));
    }
    for (const [name, value] of [
      ["voice", sent.voice_id],
      ["voice_b", sent.voice_id_b],
    ] as const) {
      const select = form.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
      if (!select || typeof value !== "string") continue;
      // The voice list may not be in yet: the voice is kept as an option of its own until it is.
      if (![...select.options].some((option) => option.value === value)) {
        select.add(new Option(value, value));
      }
      select.value = value;
    }
    const title = form.elements.namedItem("title");
    if (title instanceof HTMLInputElement) {
      title.value = typeof sent.title === "string" ? sent.title : "";
    }
    // These are the person's own picks: a new audience must not replace them unseen.
    picked = true;
    showNote(null);
    sync();
  });

  applyPreset();
  sync();
  if (running()) say("form", busyLine());
  void loadVoices();
}

/** True while a run is queued, running or adding its episode to the Library (runStatus.ts). */
function running(): boolean {
  return ["queued", "running", "updating"].includes(document.documentElement.dataset.run ?? "");
}

/** The form's line while a run is going; the indicator's markup holds it (RunStatus.astro). */
function busyLine(): string {
  return document.querySelector<HTMLElement>("[data-run-status]")?.dataset.busyCreate ?? "";
}

type Request = Record<string, unknown>;
const fillers = new WeakMap<HTMLElement, (sent: Request) => void>();

/** Fills an installed form with a request it sent before. */
export function fillCreate(root: HTMLElement, sent: unknown): void {
  if (sent && typeof sent === "object") fillers.get(root)?.(sent as Request);
}

// On /create the page loads this file and the form is in the page. Elsewhere the sheet calls
// installCreate itself, so only a form inside <main> installs here.
function installOnPage(): void {
  const root = document.querySelector<HTMLElement>("main [data-create]");
  if (root) installCreate(root);
}

document.addEventListener("astro:page-load", installOnPage);
installOnPage();
