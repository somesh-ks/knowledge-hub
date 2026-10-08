import { longDateFromDigestId } from "../player/core/formatTime";
import { openBriefing } from "./generate/generateRuntime";
import { failureTitle } from "./generate/generateSteps";
import type { GenerateState } from "./generate/generateStore";
import SheetBanner from "./SheetBanner";

interface GenerateResultProps {
  state: GenerateState;
  onClose: () => void;
  onTryAgain: () => void;
  onCheckAgain: () => void;
}

/** The outcome of a run: ready, nothing to publish, held back, failed, or out of contact. */
export default function GenerateResult({
  state,
  onClose,
  onTryAgain,
  onCheckAgain,
}: GenerateResultProps) {
  if (state.lostContact) {
    return (
      <div className="sheet-result">
        <SheetBanner
          tone="danger"
          title="Lost contact with the run"
          body="It may still be going. Check your connection, then check again."
        />
        <div className="sheet-actions">
          <button className="btn-primary press press-subtle" type="button" onClick={onCheckAgain}>
            Check again
          </button>
        </div>
      </div>
    );
  }

  switch (state.phase) {
    case "published":
      return (
        <div className="sheet-result">
          <SheetBanner
            tone="success"
            title="Briefing ready"
            body={
              state.digestId
                ? `The briefing for ${longDateFromDigestId(state.digestId)} is ready to read.`
                : "The new briefing is ready to read."
            }
          />
          <div className="sheet-actions">
            {state.digestId ? (
              <button
                className="btn-primary press press-subtle"
                type="button"
                onClick={() => {
                  if (state.digestId) openBriefing(state.digestId);
                  onClose();
                }}
              >
                Open the new briefing
              </button>
            ) : null}
            <button className="btn press" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      );
    case "nothing":
      return (
        <div className="sheet-result">
          <SheetBanner
            tone="info"
            title="Nothing cleared the bar."
            body="No new items since the last briefing. The next scheduled run is in about two days."
          />
          <div className="sheet-actions">
            <button className="btn press" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      );
    case "gated":
      return (
        <div className="sheet-result">
          <SheetBanner
            tone="info"
            title="A new briefing is not due yet"
            body="The schedule held this run back. The next scheduled run is in about two days."
          />
          <div className="sheet-actions">
            <button className="btn press" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      );
    case "failed":
      return (
        <div className="sheet-result">
          <SheetBanner
            tone="danger"
            title={failureTitle(state.failedAt)}
            body="Open the run for details, or try again in a few minutes."
          />
          <div className="sheet-actions">
            <button className="btn-primary press press-subtle" type="button" onClick={onTryAgain}>
              Try again
            </button>
            {state.runUrl ? (
              <a
                className="btn press"
                href={state.runUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View the run
              </a>
            ) : null}
          </div>
        </div>
      );
    default:
      return null;
  }
}
