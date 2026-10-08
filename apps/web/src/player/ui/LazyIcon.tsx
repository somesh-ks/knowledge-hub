import { ICON_PATHS, ICON_VIEW_BOX, type IconName } from "./iconPathsLazy";

interface IconProps {
  name: IconName;
  className?: string;
}

/**
 * Any player glyph. Only for components that load on demand (the expanded player's controls, the
 * sheets): it pulls in the whole registry, which would otherwise weigh on every page load.
 */
export default function LazyIcon({ name, className }: IconProps) {
  const classes = ["ui-icon", className ?? ""].filter(Boolean).join(" ");
  return (
    <svg className={classes} viewBox={ICON_VIEW_BOX} aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
