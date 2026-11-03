import { Field } from "@base-ui/react/field";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { buttonClass } from "../design-system/button";
import { fieldClass } from "../design-system/field";
import { switchClass } from "../design-system/switch";
import { rememberCancelToken } from "../lib/cancelTokens";
import { currentReadyView, setReady } from "../lib/readyNotice";
import { hintsFor } from "../lib/regenHints";
import { DEFAULT_REGEN_LENGTH, nearestRegenLength, REGEN_LENGTHS } from "../lib/regenLength";
import { idsOfChips, isChipOn, type RegenChip } from "../lib/regenTopics";
import { playUiCue } from "../player/sound/soundController";
import { cueForGenerate } from "../player/sound/soundMap";
import Icon from "../player/ui/LazyIcon";
import { MESSAGES, startGenerate } from "./generate/generateClient";
import SheetFrame from "./SheetFrame";
import "../styles/field.css";

/** The same cap as an episode's Regenerate feedback (server/podcast.ts). */
const FEEDBACK_MAX = 500;

const LENGTHS = REGEN_LENGTHS.map((minutes) => ({
  value: String(minutes),
  label: `${minutes} min`,
}));

/** The topics the briefing page offers (EpisodeActions.astro): its chips and the ids it was made with. */
interface PageTopics {
  chips: RegenChip[];
  selected: string[];
}

/**
 * The length the sheet starts on: the one the podcast aired at. The page's own podcast (a briefing's
 * hero menu) or the Library row being regenerated carries it as `data-minutes`, on the element that
 * names the briefing.
 */
function startLength(): string {
  const minutes = document.querySelector<HTMLElement>("[data-briefing]")?.dataset.minutes;
  return String(nearestRegenLength(minutes));
}

function readPageTopics(): PageTopics | null {
  try {
    const text = document.getElementById("regenerate-topics")?.textContent;
    const parsed = text ? (JSON.parse(text) as PageTopics) : null;
    return parsed && parsed.chips.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

interface GenerateSheetProps {
  open: boolean;
  /** Opened by a pick in a menu: the sheet's scrim takes over from the menu's. */
  handoff?: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Said when another run is still going: the run indicator holds one run at a time. */
const BUSY = "A podcast or an episode is still being made. You can start another when it's ready.";

/**
 * Regenerate a briefing: its topics (this run only, ticked from the original), the length in
 * minutes (starting on the one it was made at) and the comment that says why (required, D340). It is a
 * full sheet like Catch up: the whole screen on a phone, a side panel from 40rem. Pressing
 * Regenerate starts the run and closes the sheet; the run is followed by the podcast queue
 * (scripts/queue.ts), above the navigation on a phone and at the foot of the side column from 64rem,
 * so it goes on across pages.
 */
export default function GenerateSheet({ open, handoff, onOpenChange }: GenerateSheetProps) {
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const [page, setPage] = useState<PageTopics | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [topicError, setTopicError] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const [length, setLength] = useState(String(DEFAULT_REGEN_LENGTH));
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // The sheet opens on the comment alone; Length and Categories appear as the words reach for them
  // (D337) and stay once they have, so the form does not shift as the text is edited.
  const [shown, setShown] = useState({ length: false, topics: false });
  // "Notify me when it's ready": shown where this browser can deliver, read again at each opening.
  const [ready, setReadyView] = useState({ show: false, checked: false });

  // Each opening starts from the topics of the briefing on the page. Off a briefing's page (a
  // toast's Details) there are none, and the run keeps its own.
  useEffect(() => {
    if (!open) return;
    const topics = readPageTopics();
    setPage(topics);
    setTicked(
      new Set(topics?.chips.filter((c) => isChipOn(c, topics.selected)).map((c) => c.value)),
    );
    setTopicError(false);
    setFieldError(null);
    setLength(startLength());
    setReadyView(currentReadyView());
    // Words kept from an earlier opening still call for their controls.
    setShown(
      hintsFor(feedbackRef.current?.value ?? "", topics?.chips.map((chip) => chip.label) ?? []),
    );
  }, [open]);

  function onNote(text: string): void {
    const hints = hintsFor(text, page?.chips.map((chip) => chip.label) ?? []);
    setShown((current) =>
      (hints.length && !current.length) || (hints.topics && !current.topics)
        ? { length: current.length || hints.length, topics: current.topics || hints.topics }
        : current,
    );
  }

  function toggle(value: string): void {
    setTopicError(false);
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(value)) next.add(value);
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    // The comment is how the writer learns why this is being redone (D340): no comment, no run.
    if (!feedbackRef.current?.value.trim()) {
      setNoteError(true);
      feedbackRef.current?.focus();
      return;
    }
    // Topics go only when they differ from the original's, and never touch the saved schedule.
    let topics: string[] | undefined;
    if (page) {
      if (ticked.size === 0) {
        // The categories wait for a cue (D337); a refusal about them must show them.
        setShown((current) => ({ ...current, topics: true }));
        setTopicError(true);
        return;
      }
      const original = new Set(
        page.chips.filter((c) => isChipOn(c, page.selected)).map((c) => c.value),
      );
      const changed = original.size !== ticked.size || [...ticked].some((v) => !original.has(v));
      if (changed) topics = idsOfChips(page.chips.filter((c) => ticked.has(c.value)));
    }
    setBusy(true);
    setFieldError(null);
    let indicator: typeof import("../scripts/runStatus");
    let result: Awaited<ReturnType<typeof startGenerate>>;
    try {
      indicator = await import("../scripts/runStatus");
      if (indicator.isRunGoing()) {
        setFieldError(BUSY);
        return;
      }
      result = await startGenerate(
        { fetch: (input, init) => fetch(input, init), isOnline: () => navigator.onLine },
        feedbackRef.current?.value ?? "",
        topics,
        Number(length),
      );
    } catch {
      // The indicator's chunk failed to load (offline, a stale deploy): say so, never stay busy.
      setFieldError(MESSAGES.network);
      return;
    } finally {
      setBusy(false);
    }
    if (result.kind === "rejected") {
      setFieldError(result.message);
      playUiCue(cueForGenerate("failed"));
      return;
    }
    playUiCue(cueForGenerate("started"));
    // As Catch up and the episode Regenerate do: the token lets the queue offer Cancel, and the
    // message when the podcast is ready (if that is on here) needs it.
    rememberCancelToken(result.runId, result.cancelToken);
    void import("../lib/pushClient")
      .then((push) => push.watchRun(result.runId, "regenerate"))
      .catch(() => {});
    indicator.startRun(
      result.runId,
      { what: "briefing" },
      { body: { ...result.request }, endpoint: "/api/generate" },
    );
    onOpenChange(false);
  }

  return (
    <SheetFrame
      open={open}
      onOpenChange={onOpenChange}
      handoff={handoff}
      title="Regenerate"
      closeLabel="Close"
      keyboardAware
      // A keyboard or a mouse lands in the note. A touch lands on the sheet, so the keyboard does
      // not cover half of it before the listener has read it. A pick in the More menu opens this
      // sheet from a script, with no opener to say it was a touch: the device's pointer says it.
      initialFocus={(openType) =>
        openType === "touch" || matchMedia("(pointer: coarse)").matches
          ? true
          : (feedbackRef.current ?? true)
      }
    >
      <form
        className="sheet-form create-view"
        onSubmit={(event) => void onSubmit(event)}
        noValidate
      >
        <Field.Root disabled={busy} className="create-group">
          <h2 className="section-head text-heading">
            <Field.Label>Comments</Field.Label>
          </h2>
          <textarea
            ref={feedbackRef}
            className={fieldClass()}
            name="feedback"
            rows={4}
            maxLength={FEEDBACK_MAX}
            placeholder="What should change?"
            required
            aria-invalid={noteError || undefined}
            aria-describedby={noteError ? "regen-note-error" : undefined}
            disabled={busy}
            onChange={(event) => {
              setNoteError(false);
              onNote(event.currentTarget.value);
            }}
          />
          {noteError ? (
            <p className="create-error" id="regen-note-error" role="alert">
              <Icon name="alert" />
              <span>Say what to change.</span>
            </p>
          ) : null}
        </Field.Root>
        {page && shown.topics ? (
          <section className="create-group" aria-labelledby="regen-topics-label">
            <h2 className="section-head text-heading" id="regen-topics-label">
              Categories
            </h2>
            <fieldset className="filter-chips" disabled={busy} aria-labelledby="regen-topics-label">
              {page.chips.map((chip) => (
                <label className="filter-chip" key={chip.value}>
                  <input
                    type="checkbox"
                    name="topic"
                    value={chip.value}
                    checked={ticked.has(chip.value)}
                    onChange={() => toggle(chip.value)}
                  />
                  <Icon name="check" className="filter-chip-check" />
                  <span>{chip.label}</span>
                </label>
              ))}
            </fieldset>
            {topicError ? (
              <p className="create-error" role="alert">
                <Icon name="alert" />
                <span>Pick at least one category.</span>
              </p>
            ) : null}
          </section>
        ) : null}
        {shown.length ? (
          <section className="create-group" aria-labelledby="regen-length-label">
            <h2 className="section-head text-heading" id="regen-length-label">
              Length
            </h2>
            <div
              className="segmented-choice create-choice"
              role="radiogroup"
              aria-labelledby="regen-length-label"
            >
              {LENGTHS.map((choice) => (
                <label className="segmented-choice-item" key={choice.value}>
                  <input
                    type="radio"
                    name="length"
                    value={choice.value}
                    disabled={busy}
                    checked={length === choice.value}
                    onChange={() => setLength(choice.value)}
                  />
                  <span>{choice.label}</span>
                </label>
              ))}
            </div>
          </section>
        ) : null}
        {fieldError ? (
          <p className="sheet-field-error" role="alert">
            <Icon name="alert" />
            <span>{fieldError}</span>
          </p>
        ) : null}
        {ready.show ? (
          <div className="settings-row">
            <label className="settings-label" htmlFor="regen-ready">
              Notify me when it's ready
            </label>
            <input
              id="regen-ready"
              type="checkbox"
              role="switch"
              aria-checked={ready.checked}
              className={switchClass()}
              checked={ready.checked}
              disabled={busy}
              onChange={(event) => {
                const wanted = event.currentTarget.checked;
                setReadyView({ show: true, checked: wanted });
                void setReady(wanted).then(setReadyView);
              }}
            />
          </div>
        ) : null}
        <div className="sheet-actions">
          <button
            className={buttonClass("filled")}
            type="submit"
            aria-disabled={busy || undefined}
            data-busy={busy ? "true" : undefined}
          >
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Regenerating
              </>
            ) : (
              "Regenerate"
            )}
          </button>
        </div>
      </form>
    </SheetFrame>
  );
}
