import type { KeyboardEvent } from "react";

export interface PlayerTab<Value extends string> {
  value: Value;
  label: string;
}

/**
 * The player's two views as a tablist. It reuses the navigation segmented control's markup
 * (primitives.css, .segmented-nav): from 64rem that control, and below it player.css draws the same
 * buttons as a full-bleed tab line with a bar under the chosen one, as YouTube Music's player does.
 * Left, Right, Home and End move between tabs; the chosen tab is the only one in the Tab order.
 */
export default function PlayerTabs<Value extends string>({
  label,
  idBase,
  tabs,
  value,
  onChange,
}: {
  label: string;
  /** Ties each tab to its panel: `${idBase}-tab-${value}` and `${idBase}-panel-${value}`. */
  idBase: string;
  tabs: readonly PlayerTab<Value>[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const at = tabs.findIndex((tab) => tab.value === value);
    const n = tabs.length;
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: n - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = tabs[(to + n) % n];
    if (!next) return;
    onChange(next.value);
    document.getElementById(`${idBase}-tab-${next.value}`)?.focus();
  }
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: a tablist's keys are on the list
    <div
      className="segmented-nav player-tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          className="segmented-nav-tab"
          type="button"
          role="tab"
          id={`${idBase}-tab-${tab.value}`}
          aria-selected={tab.value === value}
          aria-controls={tab.value === value ? `${idBase}-panel-${tab.value}` : undefined}
          tabIndex={tab.value === value ? 0 : -1}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
