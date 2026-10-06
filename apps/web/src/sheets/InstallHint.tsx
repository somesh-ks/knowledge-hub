import Icon from "../player/ui/Icon";

interface InstallHintProps {
  onDismiss: () => void;
}

/**
 * Add to Home Screen, in Safari on iOS only. The copy says what you get, then how, and never uses
 * the word "install": nothing is installed, and nobody expects a website to do that.
 */
export default function InstallHint({ onDismiss }: InstallHintProps) {
  return (
    <section className="sheet-group" aria-labelledby="settings-home-screen">
      <h3 id="settings-home-screen">Home Screen</h3>
      <div className="sheet-hint-card">
        <Icon name="share" />
        <div>
          <p className="sheet-hint-title">Add Dispatch to your Home Screen</p>
          <p className="sheet-hint-body">
            In Safari, tap Share, then Add to Home Screen. It opens full screen and keeps playing in
            the background.
          </p>
        </div>
        <button className="sheet-hint-dismiss press" type="button" onClick={onDismiss}>
          Hide this
        </button>
      </div>
    </section>
  );
}
