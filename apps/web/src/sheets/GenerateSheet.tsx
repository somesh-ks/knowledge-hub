import { Field } from "@base-ui/react/field";
import { type FormEvent, useEffect, useRef } from "react";
import { OPEN_PASSPHRASE, PASSPHRASE_REQUIRED } from "../lib/access";
import Icon from "../player/ui/LazyIcon";
import GenerateResult from "./GenerateResult";
import GenerateSteps from "./GenerateSteps";
import { getGenerateStore } from "./generate/generateRuntime";
import { useGenerateState } from "./generate/useGenerate";
import SheetFrame from "./SheetFrame";

/** The same cap as an episode's Regenerate feedback (server/podcast.ts). */
const FEEDBACK_MAX = 500;

interface GenerateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Regenerate the latest briefing: a note on what to improve (optional, it reaches the writer), a passphrase while one is asked for (lib/access.ts), a run that takes a
 * few minutes, and an honest outcome. The
 * run lives in a module-level store, so closing the sheet does not stop it and reopening finds it.
 */
export default function GenerateSheet({ open, onOpenChange }: GenerateSheetProps) {
  const state = useGenerateState();
  const store = getGenerateStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
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

  // A wrong passphrase keeps focus on the field and selects its text, so retyping is one motion.
  useEffect(() => {
    if (!state.fieldError) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [state.fieldError]);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) return;
    void store.submit(
      PASSPHRASE_REQUIRED ? (inputRef.current?.value ?? "") : OPEN_PASSPHRASE,
      feedbackRef.current?.value ?? "",
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
          <Field.Root disabled={busy} className="sheet-field">
            <Field.Label className="sr-only">What to improve</Field.Label>
            <textarea
              ref={feedbackRef}
              className="sheet-input"
              name="feedback"
              rows={4}
              maxLength={FEEDBACK_MAX}
              placeholder="What should be better? For example: shorter summaries, more on design systems."
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
