import { track } from "../lib/analytics";
import { rememberCancelToken } from "../lib/cancelTokens";
import { isSiteAnswer, withErrorRef } from "../lib/errorRef";
import { hasSaved, storeOn } from "../lib/savedKey";
import type { Voice } from "../lib/voices";
import { startRun } from "./runStatus";

/**
 * The Create form: the button's length and the request. The form lives on /create and in the Create sheet; both call `installCreate`.
 * Every sentence it shows is in the markup (`[data-k]`), not here. Once a run has started it hands
 * the run to the status indicator (runStatus.ts), which follows it, and calls `onStart`.
 */
/** Said in a voice list that could not be filled: the voice service did not answer, or has no voices. */
const VOICES_UNAVAILABLE = "Couldn't load the voice list. Default and your saved voice stay.";

export function installCreate(root: HTMLElement, onStart?: () => void): void {
  if (root.dataset.ready !== undefined) return;
  root.dataset.ready = "";
  const $ = (selector: string) => root.querySelector(selector) as HTMLElement;
  const form = $("[data-create-form]") as HTMLFormElement;
  // Read again once the saved settings are laid over the form, which can add a topic's chip.
  let topics = [...form.querySelectorAll<HTMLInputElement>('input[name="topic"]')];
  const copy = (key: string) => root.querySelector(`[data-k="${key}"]`)?.textContent ?? "";
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
  // The voice each select's Default stands for, once /api/voices has said, and every voice by id.
  const defaultVoices: Record<string, Voice> = {};
  const known = new Map<string, Voice>();
  // The hosts' names are worked out as the engine works them out, from the voices (hosts.ts in core),
  // so the line under the format says the names the episode will use. Loaded with the voice list.
  let hostNames: typeof import("@singularity/core/hosts").hostNamesFor | null = null;

  /** Why a voice list is short, said in its open list. */
  const noteVoices = (text: string): void => {
    for (const select of form.querySelectorAll<HTMLSelectElement>("[data-voice] select")) {
      if (text) select.dataset.note = text;
      else delete select.dataset.note;
    }
  };

  /** The voices are fetched when the panel is first used, and fill the selects they belong to. */
  async function loadVoices(): Promise<void> {
    try {
      // The hosts' names are a nicety: a voice list is still filled when their code cannot load.
      const hosts = await import("@singularity/core/hosts").catch(() => null);
      hostNames = hosts?.hostNamesFor ?? null;
      const lib = await import("../lib/voices");
      const response = await fetch("/api/voices", { signal: AbortSignal.timeout(10_000) });
      const body: unknown = response.ok ? await response.json() : null;
      const voices = lib.parseVoices(body);
      if (!voices) {
        noteVoices(VOICES_UNAVAILABLE);
        return;
      }
      noteVoices(voices.length === 0 ? VOICES_UNAVAILABLE : "");
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
      noteVoices(VOICES_UNAVAILABLE);
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
    other.dispatchEvent(new Event("picker:sync"));
  }

  function sync(): void {
    if (topics.some((topic) => topic.checked)) say("topics");
    const data = new FormData(form);
    // A discussion has two hosts, so it takes a second voice as well as the first.
    const discussion = data.get("format") === "discussion";
    // The voices, and the hosts' names once the voices are known (D76): a discussion's captions
    // and labels say "Ada's voice", "Leo's voice"; before that, "Primary voice", "Secondary voice".
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
    // The More options line names what it holds.
    const values = root.querySelector<HTMLElement>("[data-more-values]");
    if (values?.dataset.template) {
      const chosen = (name: string) =>
        form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.dataset.label ?? "";
      values.textContent = values.dataset.template
        .replace("{format}", chosen("format"))
        .replace("{tone}", chosen("tone"));
    }
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
    // The button's own words come back when the request ends: they no longer follow the length.
    if (words && on) {
      words.setAttribute("data-rest", words.textContent ?? "");
      words.textContent = copy("starting");
    } else if (words) words.textContent = words.getAttribute("data-rest") ?? words.textContent;
  }

  /**
   * Sends the request. Every answer is shown here, and a started run is followed. The button is
   * busy until the answer is shown.
   */
  async function post(button: HTMLButtonElement): Promise<void> {
    busy(button, true);
    const sent = request();
    try {
      const res = await fetch("/api/podcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: sent }),
      }).catch(() => null);
      const body = (await res?.json().catch(() => null)) ?? {};
      // Asked for, and what came of it: a cap that turns readers away (429) shows up here first.
      track("create_episode", {
        outcome:
          res?.status === 202 && body.run_id
            ? "started"
            : res?.status === 429
              ? "limited"
              : "failed",
      });
      if (res?.status !== 202 || !body.run_id) {
        say(
          "form",
          res?.status === 429
            ? `${copy(body.error)} ${wait(body.retry_after_s)}.`
            : !res
              ? copy("network")
              : res.status === 400
                ? copy("400")
                : isSiteAnswer(body)
                  ? withErrorRef(copy("503"), body)
                  : copy("crashed"),
        );
        return;
      }
      // The request goes with the run, so a failure can send it again (Try again).
      rememberCancelToken(body.run_id, body.cancel_token);
      void import("../lib/pushClient")
        .then((push) => push.watchRun(body.run_id, "catch_up"))
        .catch(() => {});
      startRun(body.run_id, undefined, { body: { request: sent } });
      onStart?.();
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
    sync();
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
      for (const [name, value] of <[string, string][]>[
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
    await post($("[data-submit]") as HTMLButtonElement);
  });

  /**
   * The panel starts from the settings as saved, not as built (D173): a voice, format or length
   * chosen in Settings, and a topic added, renamed or removed there, show without a deploy.
   */
  async function overlaySaved(): Promise<void> {
    if (!hasSaved() && !storeOn()) return;
    const view = await import("./savedView").catch(() => null);
    if (!view) return;
    if (storeOn()) await view.loadStore();
    const changed = view.overlayCreate(form, view.readSaved());
    topics = [...form.querySelectorAll<HTMLInputElement>('input[name="topic"]')];
    if (!changed) return;
    for (const select of voiceSelects) {
      select.dispatchEvent(new Event("picker:sync"));
    }
    sync();
  }

  // While a run is going the form says so from the start, and the line goes once the run is over.
  const reflectRun = () => {
    if (!root.isConnected) {
      document.removeEventListener("singularity:run", reflectRun);
      return;
    }
    const line = root.querySelector<HTMLElement>('[data-error="form"]');
    const showing = line && !line.hidden && line.lastElementChild?.textContent === busyLine();
    if (!running() && showing) say("form");
  };
  document.addEventListener("singularity:run", reflectRun);

  sync();
  if (running()) say("form", busyLine());
  void overlaySaved();
  void loadVoices();
  // The voices are chosen from a list with a search field.
  void import("./picker").then((module) => module.mountPickers(form));
}

/** True while a run is queued, running or adding its episode to the Library (runStatus.ts). */
function running(): boolean {
  return ["queued", "running", "updating"].includes(document.documentElement.dataset.run ?? "");
}

/** The form's line while a run is going; the indicator's markup holds it (RunStatus.astro). */
function busyLine(): string {
  return document.querySelector<HTMLElement>("[data-run-status]")?.dataset.busyCreate ?? "";
}

// On /create the page loads this file and the form is in the page. Elsewhere the sheet calls
// installCreate itself, so only a form inside <main> installs here.
function installOnPage(): void {
  const root = document.querySelector<HTMLElement>("main [data-create]");
  if (root) installCreate(root);
}

document.addEventListener("astro:page-load", installOnPage);
installOnPage();
