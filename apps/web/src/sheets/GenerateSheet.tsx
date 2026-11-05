import { Field } from "@base-ui/react/field";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { buttonClass } from "../design-system/button";
import { fieldClass } from "../design-system/field";
import { rememberCancelToken } from "../lib/cancelTokens";
import { createCommentAsker } from "../lib/regenAsk";
import {
  type Answer,
  desiredChip,
  desiredLength,
  NO_ANSWER,
  wantedControls,
} from "../lib/regenFollow";
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
  // What the listener changed by hand: those categories and that length stay as they left them.
  // Every other control follows the comment (D371).
  const [picked, setPicked] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [topicError, setTopicError] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const [asked, setAsked] = useState(String(DEFAULT_REGEN_LENGTH));
  const [lengthPick, setLengthPick] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [answer, setAnswer] = useState<Answer>(NO_ANSWER);
  // The categories a refusal had to show stay shown.
  const [keepTopics, setKeepTopics] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  // The words answer at once; once the typing pauses, Jev and Haiku add what the words missed. The
  // controls follow the comment both ways (D371): one appears when the words call for it and goes
  // when they no longer do, unless the listener has touched it.
  const [asker] = useState(() => createCommentAsker(setAnswer));

  // Each opening starts from the topics of the briefing on the page. Off a briefing's page (a
  // toast's Details) there are none, and the run keeps its own.
  useEffect(() => {
    if (!open) return;
    const topics = readPageTopics();
    setPage(topics);
    setPicked(new Map());
    setTopicError(false);
    setKeepTopics(false);
    setFieldError(null);
    setAsked(startLength());
    setLengthPick(null);
    // Words kept from an earlier opening still call for their controls, and are read again.
    const kept = feedbackRef.current?.value ?? "";
    setComment(kept);
    asker.note(kept, topics?.chips.map((chip) => chip.label) ?? []);
  }, [open, asker]);

  useEffect(() => {
    if (open) return;
    asker.stop();
    setAnswer(NO_ANSWER);
  }, [open, asker]);

  const chips = page?.chips ?? [];
  const wanted = wantedControls(
    comment,
    chips.map((chip) => chip.label),
    answer,
  );
  const shownTopics = Boolean(page) && (wanted.topics || keepTopics || picked.size > 0);
  const shownLength = wanted.length || lengthPick !== null;
  const length = lengthPick ?? String(desiredLength(Number(asked), answer.values));
  const isOn = (chip: RegenChip): boolean =>
    picked.get(chip.value) ??
    desiredChip(chip.label, page ? isChipOn(chip, page.selected) : false, answer.values);

  function onNote(text: string): void {
    setComment(text);
    asker.note(
      text,
      chips.map((chip) => chip.label),
    );
  }

  function toggle(chip: RegenChip): void {
    setTopicError(false);
    setPicked((current) => new Map(current).set(chip.value, !isOn(chip)));
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
      const ticked = new Set(page.chips.filter(isOn).map((c) => c.value));
      if (ticked.size === 0) {
        // The categories wait for a cue (D337); a refusal about them must show them.
        setKeepTopics(true);
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
            <Field.Label>What went wrong?</Field.Label>
          </h2>
          <textarea
            ref={feedbackRef}
            className={fieldClass()}
            name="feedback"
            rows={4}
            maxLength={FEEDBACK_MAX}
            placeholder="Too short, missed business news, too much hype"
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
              <span>Say what went wrong.</span>
            </p>
          ) : null}
        </Field.Root>
        {page && shownTopics ? (
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
                    checked={isOn(chip)}
                    onChange={() => toggle(chip)}
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
        {shownLength ? (
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
                    onChange={() => setLengthPick(choice.value)}
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
