import { navigateTo } from "../player/core/navigation";
import { libraryAddress } from "./libraryAddress";
import { forgetRunAbout, startRun } from "./runStatus";

/**
 * Regenerate and Delete on an episode page. Loaded on the first pick of either menu item, never with
 * the page. Each is a dialog cloned from a template in EpisodeActions.astro: the rewrite panel looks
 * like the Create sheet, and the removal is a small confirm. Every sentence it shows is in the
 * markup (`[data-k]`). A started run is handed to the run indicator (runStatus.ts), which follows it.
 */
const KEY = "dispatch:narrate-passphrase";
const NEAR_LIMIT = 50;

type Kind = "regenerate" | "delete";

/** A confirm whose delete went through: its close leaves for the Library (openEpisodeAction). */
const leaving = new WeakSet<HTMLDialogElement>();

const store = (run: (s: Storage) => unknown) => {
  try {
    return run(localStorage);
  } catch {
    return null;
  }
};

function build(kind: Kind, root: HTMLElement): HTMLDialogElement | null {
  const template = document.getElementById(
    `episode-${kind === "delete" ? "delete" : "regenerate"}-template`,
  );
  const clone = (template as HTMLTemplateElement | null)?.content.firstElementChild?.cloneNode(
    true,
  );
  if (!(clone instanceof HTMLDialogElement)) return null;
  document.body.append(clone);
  bind(kind, clone, root);
  return clone;
}

function bind(kind: Kind, dialog: HTMLDialogElement, root: HTMLElement): void {
  const form = dialog.querySelector<HTMLFormElement>("form");
  const submit = dialog.querySelector<HTMLButtonElement>("[data-submit]");
  const error = dialog.querySelector<HTMLElement>("[data-error]");
  const pass = dialog.querySelector<HTMLInputElement>('[name="passphrase"]');
  const feedback = dialog.querySelector<HTMLTextAreaElement>('[name="feedback"]');
  const count = dialog.querySelector<HTMLElement>("[data-count]");
  if (!form || !submit) return;
  const copy = (key: string) => dialog.querySelector(`[data-k="${key}"]`)?.textContent ?? "";
  const say = (text = "") => {
    const line = error?.querySelector("span");
    if (!error || !line) return;
    line.textContent = text;
    error.hidden = !text;
  };
  const wait = (seconds: number) => {
    const minutes = Math.ceil(seconds / 60);
    return seconds < 60
      ? `${seconds} second${seconds === 1 ? "" : "s"}`
      : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  };

  dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });
  // A press on the scrim lands on the dialog itself; everything else is inside its panel. A press
  // that starts inside and ends outside (selecting the feedback text) also clicks the dialog, so
  // only one that began on the scrim closes it.
  let fromScrim = false;
  dialog.addEventListener("pointerdown", (event) => {
    fromScrim = event.target === dialog;
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && fromScrim) dialog.close();
    fromScrim = false;
  });

  if (pass) pass.value = String(store((s) => s.getItem(KEY)) ?? "");

  if (feedback && count) {
    const max = Number(feedback.dataset.max);
    feedback.addEventListener("input", () => {
      feedback.removeAttribute("aria-invalid");
      say();
      const left = max - feedback.value.length;
      count.hidden = left > NEAR_LIMIT;
      count.textContent = `${left} ${copy("left")}`;
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    say();
    let passphrase = root.dataset.openPassphrase ?? "";
    if (pass) {
      passphrase = pass.value.trim();
      if (!passphrase) {
        say(copy("passphrase"));
        pass.focus();
        return;
      }
    }
    const id = root.dataset.episode ?? "";
    let body: Record<string, string>;
    if (kind === "regenerate") {
      const text = feedback?.value.trim() ?? "";
      if (!text) {
        feedback?.setAttribute("aria-invalid", "true");
        say(copy("empty"));
        feedback?.focus();
        return;
      }
      body = { passphrase, action: "regenerate", id, feedback: text };
    } else {
      body = { passphrase, action: "delete", id };
    }

    submit.disabled = true;
    const res = await fetch("/api/podcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    submit.disabled = false;
    const reply = (await res?.json().catch(() => null)) ?? {};
    if (res?.status === 401 && pass) {
      store((s) => s.removeItem(KEY));
      say(copy("401"));
      pass.select();
      return;
    }
    if (res?.status !== 202 || !reply.run_id) {
      say(
        res?.status === 429
          ? `${copy(reply.error)} ${wait(reply.retry_after_s)}.`
          : copy(!res ? "network" : res.status === 400 ? "400" : "503"),
      );
      return;
    }
    if (pass) store((s) => s.setItem(KEY, passphrase));
    if (kind === "delete") {
      // Instant: the redeploy takes minutes, so this device hides the episode meanwhile and the
      // person lands on the Library with no progress to watch.
      (await import("./deletedEpisodes")).rememberDeleted(id);
      // A rewrite's line about this episode ("Live in about a minute") would outlive it.
      forgetRunAbout(id);
      // Back may have closed the confirm while the request was out, taking its history entry.
      if (dialog.open) {
        leaving.add(dialog);
        dialog.close();
      } else void navigateTo("/library");
      return;
    }
    // The request goes with the run, so a failure can send it again (Try again).
    const { passphrase: _sent, ...again } = body;
    startRun(
      reply.run_id,
      { kind, episode: id },
      { body: again, ...(pass ? {} : { open: passphrase }) },
    );
    form.reset();
    if (count) count.hidden = true;
    dialog.close();
  });
}

/** Opens the panel or the confirm for the pressed button. Both are built on first use. */
export function openEpisodeAction(trigger: HTMLElement): void {
  const kind = trigger.dataset.episodeAction as Kind;
  const root = trigger.closest<HTMLElement>("[data-episode-actions]");
  if (!root || (kind !== "regenerate" && kind !== "delete")) return;
  const selector = kind === "delete" ? "dialog.confirm-dialog" : "dialog.regen-sheet";
  const dialog = document.querySelector<HTMLDialogElement>(selector) ?? build(kind, root);
  if (!dialog || dialog.open) return;
  // A pick from the menu hands focus back to the More button; the menu itself is closed by then.
  const back = () => {
    const target = trigger.closest("[popover]")
      ? root.querySelector<HTMLElement>("[data-hero-more]")
      : trigger;
    if (target?.isConnected) target.focus();
  };
  // Browser Back closes the panel or the confirm and stays on the page, so typed feedback is not
  // lost to it. The dialog takes one history entry, as the Create sheet does (createSheet.ts): the
  // head script (themeInit.js) asks first on every pop, and answering "handled" keeps the router out.
  let entry = true;
  const onBack = (event: Event): void => {
    if (!entry) return;
    entry = false;
    event.preventDefault();
    removeEventListener("dispatch:back", onBack);
    if (dialog.open) dialog.close();
  };
  history.pushState({ ...history.state, episodeAction: kind }, "");
  addEventListener("dispatch:back", onBack);
  dialog.addEventListener(
    "close",
    () => {
      back();
      if (!entry) return;
      if (!leaving.delete(dialog)) {
        // Closed any other way: give the entry back. The pop this causes reaches onBack, which
        // swallows it.
        history.go(-1);
        return;
      }
      // A delete went through: the Library takes this entry's place, so no pop follows. Giving the
      // entry back first could land after the Library's own and turn the move around.
      entry = false;
      document.dispatchEvent(new CustomEvent("dispatch:sound", { detail: "success" }));
      removeEventListener("dispatch:back", onBack);
      void navigateTo(libraryAddress(), { history: "replace" });
    },
    { once: true },
  );
  dialog.showModal();
}
