import { rememberCancelToken } from "../lib/cancelTokens";
import { isSiteAnswer, withErrorRef } from "../lib/errorRef";
import { isChipOn } from "../lib/regenTopics";
import { hasSaved, storeOn } from "../lib/savedKey";
import { navigateTo } from "../player/core/navigation";
import { libraryAddress } from "./libraryAddress";
import { dismissOnScrim, sheetGestures } from "./pullDismiss";
import { forgetRunAbout, startRun } from "./runStatus";

/**
 * Regenerate and Delete on an episode page. Loaded on the first pick of either menu item, never with
 * the page. Each is a dialog cloned from a template in EpisodeActions.astro: the rewrite panel looks
 * like the Create sheet, and the removal is a small confirm. Every sentence it shows is in the
 * markup (`[data-k]`). A started run is handed to the run indicator (runStatus.ts), which follows it.
 */
const NEAR_LIMIT = 50;

type Kind = "regenerate" | "delete";

/** A confirm whose delete went through: its close leaves for the Library (openEpisodeAction). */
const leaving = new WeakSet<HTMLDialogElement>();

/** The row a dialog is open for: the Library shares one dialog between all its rows. */
const rootOf = new WeakMap<HTMLDialogElement, HTMLElement>();

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
  if (kind === "regenerate") void overlaySaved(clone);
  return clone;
}

/** The topic chips as saved in Settings, not as built (D173): new topics, new names, none removed. */
async function overlaySaved(dialog: HTMLDialogElement): Promise<void> {
  const list = dialog.querySelector<HTMLElement>("[data-built-topics]");
  if (!list || (!hasSaved() && !storeOn())) return;
  const view = await import("./savedView").catch(() => null);
  if (!view) return;
  if (storeOn()) await view.loadStore();
  view.overlayChips(list, view.readSaved());
}

function bind(kind: Kind, dialog: HTMLDialogElement, root: HTMLElement): void {
  const form = dialog.querySelector<HTMLFormElement>("form");
  const submit = dialog.querySelector<HTMLButtonElement>("[data-submit]");
  const error = dialog.querySelector<HTMLElement>("[data-error]");
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
  // The rewrite panel is a sheet: pulled down or tapped outside it closes. The confirm is a small
  // dialog and closes on a tap outside only.
  if (dialog.classList.contains("regen-sheet")) sheetGestures(dialog);
  else dismissOnScrim(dialog);

  dialog.addEventListener("change", () => say());

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
    const current = rootOf.get(dialog) ?? root;
    // On a briefing page the root names a digest and the request goes to /api/generate.
    const briefing = current.dataset.briefing ?? current.dataset.libraryBriefing;
    const id = briefing ?? current.dataset.episode ?? "";
    let body: Record<string, unknown>;
    if (kind === "regenerate") {
      // The ticked chips are this regeneration's topics and nothing else: the saved schedule,
      // weights and Create defaults are not touched. They are sent only when they differ from the
      // topics the original was made with. Comments are optional.
      // A chip of a topic removed since the build is disabled (savedView.ts) and never sent.
      const chips = [
        ...dialog.querySelectorAll<HTMLInputElement>('input[name="topic"]:not(:disabled)'),
      ];
      const ticked = chips.filter((chip) => chip.checked);
      if (chips.length > 0 && ticked.length === 0) {
        say(copy("topics"));
        chips[0]?.focus();
        return;
      }
      const changed = chips.some((chip) => chip.checked !== chip.defaultChecked);
      const topics = [...new Set(ticked.flatMap((chip) => (chip.dataset.ids ?? "").split(" ")))];
      const text = feedback?.value.trim() ?? "";
      body = {
        action: "regenerate",
        id,
        ...(text ? { feedback: text } : {}),
        ...(changed ? (briefing ? { topics } : { topic_ids: topics }) : {}),
      };
    } else {
      body = { action: "delete", id };
    }

    submit.disabled = true;
    const res = await fetch(briefing ? "/api/generate" : "/api/podcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    submit.disabled = false;
    const reply = (await res?.json().catch(() => null)) ?? {};
    if (res?.status !== 202 || !reply.run_id) {
      say(
        !res
          ? copy("network")
          : res.status === 429
            ? `${copy(reply.error)} ${wait(reply.retry_after_s)}.`
            : res.status === 409
              ? copy("regeneration_limit")
              : res.status === 400
                ? copy("400")
                : isSiteAnswer(reply)
                  ? withErrorRef(copy("503"), reply)
                  : copy("crashed"),
      );
      return;
    }
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
    rememberCancelToken(reply.run_id, reply.cancel_token);
    startRun(reply.run_id, { kind, episode: id }, { body });
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
  rootOf.set(dialog, root);
  // One dialog serves every row of the Library, so it is set for the row that opened it.
  if (kind === "delete") {
    const noun = root.dataset.libraryBriefing || root.dataset.briefing ? "podcast" : "episode";
    const title = dialog.querySelector("#delete-title");
    if (title) title.textContent = `Delete this ${noun}?`;
  } else if (root.dataset.topics !== undefined) {
    const original = root.dataset.topics.split(" ").filter(Boolean);
    for (const chip of dialog.querySelectorAll<HTMLInputElement>('input[name="topic"]')) {
      const ids = (chip.dataset.ids ?? "").split(" ");
      chip.checked = chip.defaultChecked = !chip.disabled && isChipOn({ ids }, original);
    }
  }
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
    removeEventListener("singularity:back", onBack);
    if (dialog.open) dialog.close();
  };
  history.pushState({ ...history.state, episodeAction: kind }, "");
  addEventListener("singularity:back", onBack);
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
      document.dispatchEvent(new CustomEvent("singularity:sound", { detail: "success" }));
      removeEventListener("singularity:back", onBack);
      void navigateTo(libraryAddress(), { history: "replace" });
    },
    { once: true },
  );
  dialog.showModal();
}
