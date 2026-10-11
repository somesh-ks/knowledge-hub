import { Field } from "@base-ui/react/field";
import { type FormEvent, useRef, useState, useSyncExternalStore } from "react";
import { PASSPHRASE_REQUIRED } from "../lib/access";
import {
  answerPassphrase,
  pendingQuestion,
  subscribeQuestion,
} from "../narration/passphrasePrompt";
import Icon from "../player/ui/LazyIcon";
import SheetFrame from "./SheetFrame";

interface NarrateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const isWrong = (): boolean => pendingQuestion()?.wrong ?? false;

/**
 * Asks for the passphrase before a briefing is narrated for the first time. Making audio spends
 * from a monthly allowance, so it is the one step on the Play path that is guarded. Closing the
 * sheet answers "not now" and nothing is spent.
 */
export default function NarrateSheet({ open, onOpenChange }: NarrateSheetProps) {
  const wrong = useSyncExternalStore(subscribeQuestion, isWrong, () => false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = useState(false);
  const error = empty
    ? "Enter the passphrase to make the audio."
    : wrong
      ? PASSPHRASE_REQUIRED
        ? "That passphrase is not right. Check it and try again."
        : "The audio was refused. Try again in a few minutes."
      : null;

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = String(form.get("passphrase") ?? "").trim();
    if (value === "") {
      setEmpty(true);
      inputRef.current?.focus();
      return;
    }
    answerPassphrase({ value, remember: form.get("remember") === "on" });
    onOpenChange(false);
  }

  function onChange(next: boolean): void {
    // Closed without an answer: the question is withdrawn, so the Play control settles back.
    if (!next) answerPassphrase(null);
    onOpenChange(next);
  }

  return (
    <SheetFrame
      open={open}
      onOpenChange={onChange}
      title="Make the audio"
      closeLabel="Close"
      keyboardAware
      initialFocus={(openType) => (openType === "touch" ? true : inputRef.current)}
    >
      <p className="sheet-lede">
        {PASSPHRASE_REQUIRED
          ? "This briefing has not been read aloud yet. Making its audio takes a few seconds and needs the passphrase. After that it plays for everyone."
          : "This briefing has not been read aloud yet. Making its audio takes a few seconds. After that it plays for everyone."}
      </p>
      <form className="sheet-form" onSubmit={onSubmit} noValidate>
        <Field.Root invalid={Boolean(error)} className="sheet-field">
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
            onChange={() => setEmpty(false)}
          />
          <Field.Error match={Boolean(error)} className="sheet-field-error" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </Field.Error>
        </Field.Root>
        <label className="sheet-check">
          <input type="checkbox" name="remember" />
          <span>Remember on this device</span>
        </label>
        <div className="sheet-actions">
          <button className="btn-primary" type="submit">
            Make audio and play
          </button>
        </div>
      </form>
    </SheetFrame>
  );
}
