import { type IconSize, iconClass } from "../../design-system/icon";
import { ICON_PATHS, ICON_VIEW_BOX, type IconName } from "./iconPaths";

interface IconProps {
  name: IconName;
  size?: IconSize;
  className?: string;
}

export default function Icon({ name, size, className }: IconProps) {
  const classes = [iconClass(size), className ?? ""].filter(Boolean).join(" ");
  return (
    <svg className={classes} viewBox={ICON_VIEW_BOX} aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
