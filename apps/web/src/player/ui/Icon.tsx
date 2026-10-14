import { useEffect, useState } from "react";
import { whenIdle } from "../../scripts/idle";
import { ICON_PATHS, ICON_VIEW_BOX } from "./iconPaths";
import type { IconName } from "./iconPathsLazy";

interface IconProps {
  name: IconName;
  className?: string;
}

const FIRST_PAINT: Partial<Record<IconName, string>> = ICON_PATHS;
let later: Partial<Record<IconName, string>> | null = null;
let loading: Promise<void> | null = null;

/** The glyphs no first paint draws (a toast's, a notice's, an error's, an ended track's). */
function loadLater(): Promise<void> {
  loading ??= import("./iconPathsLazy").then((module) => {
    later = module.ICON_PATHS;
  });
  return loading;
}

// Ready before the first toast or failure needs one; the chunk is warmed at idle with the sheets.
if (typeof window !== "undefined") whenIdle(() => void loadLater().catch(() => undefined));

/**
 * A player glyph. The bar's glyphs are in the page's first load; any other is drawn once the full
 * registry has loaded, which is normally before anything asks for it.
 */
export default function Icon({ name, className }: IconProps) {
  const [, setLoaded] = useState(later !== null);
  const d = FIRST_PAINT[name] ?? later?.[name];
  useEffect(() => {
    if (d !== undefined) return;
    let live = true;
    loadLater().then(
      () => live && setLoaded(true),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [d]);
  const classes = ["ui-icon", className ?? ""].filter(Boolean).join(" ");
  return (
    <svg className={classes} viewBox={ICON_VIEW_BOX} aria-hidden="true" focusable="false">
      {d !== undefined && <path d={d} />}
    </svg>
  );
}
