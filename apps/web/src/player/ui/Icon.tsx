import { ICON_PATHS, ICON_VIEW_BOX, type IconName } from "./iconPaths";

interface IconProps {
  name: IconName;
  className?: string;
}

export default function Icon({ name, className }: IconProps) {
  const classes = ["ui-icon", className ?? ""].filter(Boolean).join(" ");
  return (
    <svg className={classes} viewBox={ICON_VIEW_BOX} aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
