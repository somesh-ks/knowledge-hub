import { useId } from "react";

export interface SegmentOption<Value extends string> {
  value: Value;
  label: string;
}

interface SegmentedControlProps<Value extends string> {
  /** The group's visible name, rendered as the fieldset's legend. */
  legend: string;
  options: readonly SegmentOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /** Hides the legend visually when the surrounding heading already names the group. */
  legendHidden?: boolean;
  className?: string;
}

/**
 * Native radios inside labels: arrow keys, form state and the accessible group come free. The
 * selected segment is raised and ringed, so selection never depends on color alone.
 */
export default function SegmentedControl<Value extends string>({
  legend,
  options,
  value,
  onChange,
  legendHidden = false,
  className,
}: SegmentedControlProps<Value>) {
  const name = useId();
  return (
    <fieldset className={["segmented-group", className ?? ""].filter(Boolean).join(" ")}>
      <legend className={legendHidden ? "sr-only" : "segmented-legend"}>{legend}</legend>
      <div className="segmented">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
