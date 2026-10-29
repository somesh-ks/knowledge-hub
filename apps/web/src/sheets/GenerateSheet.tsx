import { Field } from "@base-ui/react/field";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ICON_PATHS, ICON_VIEW_BOX } from "../lib/icons";
import { idsOfChips, isChipOn, type RegenChip } from "../lib/regenTopics";
import { playUiCue } from "../player/sound/soundController";
import { cueForGenerate } from "../player/sound/soundMap";
import Icon from "../player/ui/LazyIcon";
import { MESSAGES, startGenerate } from "./generate/generateClient";
import SheetFrame from "./SheetFrame";

/** The same cap as an episode's Regenerate feedback (server/podcast.ts). */
const FEEDBACK_MAX = 500;

/** The lengths the schedule offers; "Usual" asks for none, so the run keeps the schedule's own. */
const LENGTHS = [
  { value: "", label: "Usual" },
  { value: "3", label: "3 min" },
  { value: "5", label: "5 min" },
  { value: "10", label: "10 min" },
  { value: "15", label: "15 min" },
] as const;

/** The topics the briefing page offers (EpisodeActions.astro): its chips and the ids it was made with. */
interface PageTopics {
  chips: RegenChip[];
  selected: string[];
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
  onOpenChange: (open: boolean) => void;
}

/** Said when another run is still going: the run indicator holds one run at a time. */
const BUSY = "A podcast or an episode is still being made. You can start another when it's ready.";

/**
 * Regenerate a briefing: its topics (this run only, ticked from the original), optional length in
 * minutes (Usual keeps the schedule's), and optional comments for the writer. Pressing Regenerate
 * starts the run and closes the sheet; the run is followed by the run indicator (scripts/runStatus.ts),
 * the same line and bar a Catch up has, above the
 * navigation on a phone and at the foot of the side column from 64rem, so it goes on across pages.
 */
export default function GenerateSheet({ open, onOpenChange }: GenerateSheetProps) {
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const [page, setPage] = useState<PageTopics | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [topicError, setTopicError] = useState(false);
  const [length, setLength] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

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
    setLength("");
  }, [open]);

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
    // Topics go only when they differ from the original's, and never touch the saved schedule.
    let topics: string[] | undefined;
    if (page) {
      if (ticked.size === 0) {
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
        length === "" ? undefined : Number(length),
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
      title="Regenerate"
      closeLabel="Close"
      keyboardAware
      // A keyboard or a mouse lands in the note. A touch lands on the sheet, so the keyboard does
      // not cover half of it before the listener has read it.
      initialFocus={(openType) => (openType === "touch" ? true : (feedbackRef.current ?? true))}
    >
      <form className="sheet-form" onSubmit={(event) => void onSubmit(event)} noValidate>
        {page ? (
          <fieldset className="sheet-field" disabled={busy} aria-labelledby="regen-topics-label">
            <h3 className="sheet-field-label" id="regen-topics-label">
              Categories
            </h3>
            <div className="filter-chips">
              {page.chips.map((chip) => (
                <label className="filter-chip" key={chip.value}>
                  <input
                    type="checkbox"
                    name="topic"
                    value={chip.value}
                    checked={ticked.has(chip.value)}
                    onChange={() => toggle(chip.value)}
                  />
                  <svg
                    className="icon filter-chip-check"
                    viewBox={ICON_VIEW_BOX}
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d={ICON_PATHS.check} />
                  </svg>
                  <span>{chip.label}</span>
                </label>
              ))}
            </div>
            {topicError ? (
              <p className="sheet-field-error" role="alert">
                <Icon name="alert" />
                <span>Pick at least one category.</span>
              </p>
            ) : null}
          </fieldset>
        ) : null}
        <fieldset className="sheet-field" disabled={busy} aria-labelledby="regen-length-label">
          <h3 className="sheet-field-label" id="regen-length-label">
            Length
          </h3>
          <div className="segmented-choice" role="radiogroup" aria-labelledby="regen-length-label">
            {LENGTHS.map((choice) => (
              <label className="segmented-choice-item" key={choice.value}>
                <input
                  type="radio"
                  name="length"
                  value={choice.value}
                  checked={length === choice.value}
                  onChange={() => setLength(choice.value)}
                />
                <span>{choice.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field.Root disabled={busy} className="sheet-field">
          <Field.Label className="sheet-field-label">Comments (optional)</Field.Label>
          <textarea
            ref={feedbackRef}
            className="sheet-input"
            name="feedback"
            rows={4}
            maxLength={FEEDBACK_MAX}
            placeholder="For example: shorter summaries, more on design systems."
            disabled={busy}
          />
        </Field.Root>
        {fieldError ? (
          <p className="sheet-field-error" role="alert">
            <Icon name="alert" />
            <span>{fieldError}</span>
          </p>
        ) : null}
        <div className="sheet-actions">
          <button
            className="btn-primary"
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
