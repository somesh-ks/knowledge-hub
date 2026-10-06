import type { ReactNode } from "react";
import Icon from "../player/ui/Icon";
import type { IconName } from "../player/ui/iconPaths";

type Tone = "info" | "success" | "danger";

const TONE_ICON: Record<Tone, IconName> = {
  info: "info",
  success: "check",
  danger: "alert",
};

interface SheetBannerProps {
  tone: Tone;
  title: string;
  body?: string;
  children?: ReactNode;
}

/**
 * Icon, title, body. Tone sets the tint and the icon color; the body text stays on-surface so grey
 * on color never happens. An error is an `alert`; the rest are quiet `status` regions.
 */
export default function SheetBanner({ tone, title, body, children }: SheetBannerProps) {
  return (
    <div className="sheet-banner" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={TONE_ICON[tone]} />
      <div>
        <p className="sheet-banner-title">{title}</p>
        {body ? <p className="sheet-banner-body">{body}</p> : null}
      </div>
      {children}
    </div>
  );
}
