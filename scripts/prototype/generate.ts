/**
 * Generate sheet: passphrase, bot check, simulated progress, and every error state.
 * The real flow posts to /api/generate and polls /api/status; the states and copy are the same.
 * Prototype passphrases: demo (succeeds), nothing (a quiet run), fail (fails while writing),
 * cooldown (refused). Anything else is a wrong passphrase.
 */
import { icon } from "./icons.js";
import { esc } from "./views.js";

const STEPS = [
  "Waiting for a slot",
  "Reading sources",
  "Judging",
  "Writing",
  "Checking",
  "Publishing",
] as const;
const STEP_MS = 1150;
const WRITING = 3;

type RunStatus = "idle" | "running" | "success" | "nothing" | "failed";

export interface GenerateOptions {
  dialog: HTMLDialogElement;
  playSound: (name: "generateStart" | "generateDone" | "error") => void;
  announce: (message: string) => void;
  isOffline: () => boolean;
  /** Called when a run finishes while the sheet is closed. */
  onFinishedInBackground: (status: "success" | "nothing" | "failed") => void;
  onOpenNewBriefing: () => void;
}

export function createGenerate(options: GenerateOptions) {
  const { dialog } = options;
  const form = dialog.querySelector<HTMLFormElement>("#generateForm");
  const input = dialog.querySelector<HTMLInputElement>("#pass");
  const error = dialog.querySelector<HTMLElement>("#passError");
  const button = dialog.querySelector<HTMLButtonElement>("#generateBtn");
  const steps = dialog.querySelector<HTMLElement>("#runSteps");
  const result = dialog.querySelector<HTMLElement>("#runResult");
  const botcheck = dialog.querySelector<HTMLElement>("#botcheck");
  const botcheckText = dialog.querySelector<HTMLElement>("#botcheckText");
  const lede = dialog.querySelector<HTMLElement>("#generateLede");

  let status: RunStatus = "idle";
  let step = 0;
  let timer = 0;
  let botTimer = 0;

  function showError(message: string): void {
    if (!error || !input) return;
    error.innerHTML = `${icon("alert")}<span>${esc(message)}</span>`;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
    options.playSound("error");
  }

  function clearError(): void {
    if (!error || !input) return;
    error.hidden = true;
    input.removeAttribute("aria-invalid");
  }

  function paintSteps(): void {
    if (!steps) return;
    steps.hidden = status === "idle";
    steps.innerHTML = STEPS.map((label, index) => {
      let state = "pending";
      let text = "";
      if (status === "failed" && index === WRITING) {
        state = "failed";
        text = "Failed";
      } else if (index < step || status === "success" || status === "nothing") {
        state = "done";
        text = "Done";
      } else if (index === step && status === "running") {
        state = "active";
        text = "In progress";
      }
      return `<li class="run-step" data-state="${state}"><span>${label}</span><span class="run-step-state">${text}</span></li>`;
    }).join("");
  }

  function paintButton(): void {
    if (!button) return;
    const running = status === "running";
    if (running) {
      button.setAttribute("aria-disabled", "true");
      button.dataset.busy = "true";
    } else {
      button.removeAttribute("aria-disabled");
      delete button.dataset.busy;
    }
    button.innerHTML = running
      ? '<span class="spinner" aria-hidden="true"></span>Generating'
      : "Generate briefing";
    if (form) form.hidden = status === "success" || status === "nothing" || status === "failed";
    if (lede) lede.hidden = status !== "idle" && status !== "running";
  }

  function paintResult(): void {
    if (!result) return;
    if (status === "success") {
      result.innerHTML = `
        <div class="banner" data-tone="success">${icon("check")}<div><p class="banner-title">Briefing ready</p><p class="banner-body">12 items for Wednesday 7 October.</p></div></div>
        <div class="sheet-actions"><button class="btn-primary press press-subtle" type="button" id="runOpen">Open the new briefing</button><button class="btn-secondary press press-subtle" type="button" data-close>Close</button></div>`;
    } else if (status === "nothing") {
      result.innerHTML = `
        <div class="banner" data-tone="info">${icon("info")}<div><p class="banner-title">Nothing cleared the bar.</p><p class="banner-body">No new items since Monday 5 October. The next scheduled run is in about two days.</p></div></div>
        <div class="sheet-actions"><button class="btn-secondary press press-subtle" type="button" data-close>Close</button></div>`;
    } else if (status === "failed") {
      result.innerHTML = `
        <div class="banner" data-tone="danger" role="alert">${icon("alert")}<div><p class="banner-title">The run failed while writing</p><p class="banner-body">Open the run for details, or try again in a few minutes.</p></div></div>
        <div class="sheet-actions"><button class="btn-primary press press-subtle" type="button" id="runRetry">Try again</button><a class="btn-secondary press press-subtle" href="#run">View the run</a></div>`;
    } else {
      result.innerHTML = "";
    }
    result.querySelector("#runOpen")?.addEventListener("click", () => {
      dialog.close();
      options.onOpenNewBriefing();
    });
    result.querySelector("#runRetry")?.addEventListener("click", () => {
      reset();
      input?.focus();
    });
    result
      .querySelector<HTMLAnchorElement>('a[href="#run"]')
      ?.addEventListener("click", (event) => event.preventDefault());
  }

  function paintAll(): void {
    paintSteps();
    paintButton();
    paintResult();
  }

  function reset(): void {
    window.clearTimeout(timer);
    status = "idle";
    step = 0;
    clearError();
    if (input) {
      input.value = "";
      input.disabled = false;
    }
    paintAll();
  }

  function finish(outcome: "success" | "nothing" | "failed"): void {
    window.clearTimeout(timer);
    status = outcome;
    paintAll();
    if (outcome === "success") options.playSound("generateDone");
    if (outcome === "failed") options.playSound("error");
    options.announce(
      outcome === "success"
        ? "Briefing ready."
        : outcome === "nothing"
          ? "Nothing cleared the bar."
          : "The run failed while writing.",
    );
    if (!dialog.open) options.onFinishedInBackground(outcome);
  }

  function run(code: string): void {
    status = "running";
    step = 0;
    if (input) input.disabled = true;
    paintAll();
    options.playSound("generateStart");
    options.announce(`Generating. ${STEPS[0]}.`);
    const advance = (): void => {
      step += 1;
      if (code === "fail" && step === WRITING) {
        status = "failed";
        finish("failed");
        return;
      }
      if (step >= STEPS.length) {
        finish(code === "nothing" ? "nothing" : "success");
        return;
      }
      paintSteps();
      options.announce(`${STEPS[step]}.`);
      timer = window.setTimeout(advance, STEP_MS);
    };
    timer = window.setTimeout(advance, STEP_MS);
  }

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (status === "running") return;
    clearError();
    const value = (input?.value ?? "").trim().toLowerCase();
    if (!value) {
      showError("Enter the passphrase to continue.");
      input?.focus();
      return;
    }
    if (options.isOffline()) {
      showError("You are offline. Reconnect, then try again.");
      return;
    }
    if (value === "cooldown") {
      showError("Generate is on cooldown. Try again in 5 hours 12 minutes.");
      return;
    }
    if (value === "demo" || value === "nothing" || value === "fail") {
      run(value);
      return;
    }
    showError("That passphrase does not match. Check it and try again.");
    input?.focus();
    input?.select();
  });

  input?.addEventListener("input", clearError);

  /** Called every time the sheet opens: restart the bot check, keep any run in progress. */
  function onOpen(): void {
    if (status === "idle") clearError();
    paintAll();
    if (botcheck && botcheckText && status === "idle") {
      botcheck.dataset.state = "pending";
      botcheck.innerHTML =
        '<span class="spinner" aria-hidden="true"></span><span id="botcheckText">Checking you are not a bot</span>';
      window.clearTimeout(botTimer);
      botTimer = window.setTimeout(() => {
        botcheck.dataset.state = "ok";
        botcheck.innerHTML = `${icon("check")}<span>Bot check passed</span>`;
      }, 800);
    }
  }

  paintAll();
  return { onOpen, getStatus: () => status };
}
