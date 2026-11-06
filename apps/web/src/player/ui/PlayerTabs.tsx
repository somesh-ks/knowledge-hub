import type { KeyboardEvent } from "react";

export interface PlayerTab<Value extends string> {
  value: Value;
  label: string;
}

/**
 * The player's two views as a tablist, drawn as the podcast page's section tabs are (primitives.css,
 * .tabs-bar, .tabs and .tab, as a filter's buttons are in a tablist): the chosen label in the accent
 * with a bar under its words, the others muted, at every width (owner, 2026-11-02; amends D169). Left,
 * Right, Home and End move between tabs; the chosen tab is the only one in the Tab order.
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
    <div className="tabs-bar player-tabs-bar">
      <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.value}
            className="tab"
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
    </div>
  );
}
