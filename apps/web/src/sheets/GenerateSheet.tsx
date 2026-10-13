import { Field } from "@base-ui/react/field";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { OPEN_PASSPHRASE, PASSPHRASE_REQUIRED } from "../lib/access";
import { ICON_PATHS, ICON_VIEW_BOX } from "../lib/icons";
import { idsOfChips, isChipOn, type RegenChip } from "../lib/regenTopics";
import Icon from "../player/ui/LazyIcon";
import GenerateResult from "./GenerateResult";
import GenerateSteps from "./GenerateSteps";
import { getGenerateStore } from "./generate/generateRuntime";
import { useGenerateState } from "./generate/useGenerate";
import SheetFrame from "./SheetFrame";

/** The same cap as an episode's Regenerate feedback (server/podcast.ts). */
const FEEDBACK_MAX = 500;

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

/**
 * Regenerate a briefing: its topics (this run only, ticked from the original), comments for the writer (optional), a passphrase while one is asked for (lib/access.ts), a run that takes a
 * few minutes, and an honest outcome. The
 * run lives in a module-level store, so closing the sheet does not stop it and reopening finds it.
 */
export default function GenerateSheet({ open, onOpenChange }: GenerateSheetProps) {
  const state = useGenerateState();
  const store = getGenerateStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const [page, setPage] = useState<PageTopics | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [topicError, setTopicError] = useState(false);
  const starting = state.phase === "starting";
  const running = state.phase === "running";
  const busy = starting || running;
  const finished =
    state.phase === "published" ||
    state.phase === "nothing" ||
    state.phase === "gated" ||
    state.phase === "failed";
  const showForm = !finished && !state.lostContact;
  const showList = running || finished;

  useEffect(() => {
    store.setSheetOpen(open);
  }, [open, store]);

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
  }, [open]);

  function toggle(value: string): void {
    setTopicError(false);
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(value)) next.add(value);
      return next;
    });
  }

  // A wrong passphrase keeps focus on the field and selects its text, so retyping is one motion.
  useEffect(() => {
    if (!state.fieldError) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [state.fieldError]);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) return;
    // Topics go only when they differ from the original's, and never touch the saved schedule.
    let topics: string[] | undefined;
    if (page) {
      if (ticked.size === 0) {
        setTopicError(true);
        return;
      }
      const original = new Set(page.chips.filter((c) => isChipOn(c, page.selected)).map((c) => c.value));
      const changed = original.size !== ticked.size || [...ticked].some((v) => !original.has(v));
      if (changed) topics = idsOfChips(page.chips.filter((c) => ticked.has(c.value)));
    }
    void store.submit(
      PASSPHRASE_REQUIRED ? (inputRef.current?.value ?? "") : OPEN_PASSPHRASE,
      feedbackRef.current?.value ?? "",
      topics,
    );
  }

  function tryAgain(): void {
    store.reset();
    // The field remounts empty; focus it once it exists.
    requestAnimationFrame(() => inputRef.current?.focus());
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
      {showForm ? (
        <form className="sheet-form" onSubmit={onSubmit} noValidate>
          {page ? (
            <fieldset className="sheet-field" disabled={busy} aria-labelledby="regen-topics-label">
              <h3 className="sheet-field-label" id="regen-topics-label">
                Topics
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
                    <svg className="icon filter-chip-check" viewBox={ICON_VIEW_BOX} aria-hidden="true" focusable="false">
                      <path d={ICON_PATHS.check} />
                    </svg>
                    <span>{chip.label}</span>
                  </label>
                ))}
              </div>
              {topicError ? (
                <p className="sheet-field-error" role="alert">
                  <Icon name="alert" />
                  <span>Pick at least one topic.</span>
                </p>
              ) : null}
            </fieldset>
          ) : null}
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
          {PASSPHRASE_REQUIRED ? (
            <Field.Root invalid={Boolean(state.fieldError)} disabled={busy} className="sheet-field">
              <Field.Label className="sheet-field-label">Passphrase</Field.Label>
              <Field.Control
                ref={inputRef}
                className="sheet-input"
                type="password"
                name="passphrase"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="go"
                onChange={() => store.clearError()}
              />
              <Field.Description className="sheet-field-hint">
                The passphrase set when Singularity was set up.
              </Field.Description>
              <Field.Error
                match={Boolean(state.fieldError)}
                className="sheet-field-error"
                role="alert"
              >
                <Icon name="alert" />
                <span>{state.fieldError}</span>
              </Field.Error>
            </Field.Root>
          ) : state.fieldError ? (
            <p className="sheet-field-error" role="alert">
              <Icon name="alert" />
              <span>{state.fieldError}</span>
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
      ) : null}

      {showList ? (
        <GenerateSteps
          phase={
            running ? "running" : (state.phase as "published" | "nothing" | "gated" | "failed")
          }
          current={state.step}
          failedAt={state.failedAt}
        />
      ) : null}

      <GenerateResult
        state={state}
        onClose={() => onOpenChange(false)}
        onTryAgain={tryAgain}
        onCheckAgain={() => store.checkNow()}
      />
    </SheetFrame>
  );
}
