import { ICON_PATHS, ICON_VIEW_BOX, type IconName, SOLID_ICONS } from "./iconPaths";

interface IconProps {
  name: IconName;
  className?: string;
}

export default function Icon({ name, className }: IconProps) {
  const classes = ["ui-icon", SOLID_ICONS.has(name) ? "ui-icon-solid" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <svg className={classes} viewBox={ICON_VIEW_BOX} aria-hidden="true" focusable="false">
      {ICON_PATHS[name]}
    </svg>
  );
}
