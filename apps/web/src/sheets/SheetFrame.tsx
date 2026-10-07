import { Drawer } from "@base-ui/react/drawer";
import type { ComponentProps, ReactNode } from "react";
import Icon from "../player/ui/Icon";

type InitialFocus = ComponentProps<typeof Drawer.Popup>["initialFocus"];

interface SheetFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel: string;
  /** Wraps the sheet in Base UI's virtual-keyboard handling, for sheets with a text field. */
  keyboardAware?: boolean;
  initialFocus?: InitialFocus;
  children: ReactNode;
}

/**
 * A bottom sheet on phones, resting on the screen's edge with a grabber, and a centered dialog from
 * 40rem. Base UI's Drawer provides the dialog semantics, the focus trap, the inert background,
 * Escape, scrim tap, swipe to dismiss and the transition states; the stylesheet gives it the
 * design's surface, curve and radius, and draws the grabber.
 */
export default function SheetFrame({
  open,
  onOpenChange,
  title,
  closeLabel,
  keyboardAware = false,
  initialFocus,
  children,
}: SheetFrameProps) {
  const portal = (
    <Drawer.Portal>
      <Drawer.Backdrop className="sheet-scrim" />
      <Drawer.Viewport className="sheet-viewport">
        <Drawer.Popup className="sheet-popup" initialFocus={initialFocus}>
          {/* Content is what lets a mouse press land on a control inside: outside it, Base UI
              treats the press as the start of a swipe and captures the pointer. */}
          <Drawer.Content className="sheet-panel">
            <div className="sheet-head">
              <Drawer.Title className="sheet-title">{title}</Drawer.Title>
              <Drawer.Close className="icon-btn press" aria-label={closeLabel}>
                <Icon name="close" className="icon-lg" />
              </Drawer.Close>
            </div>
            {children}
          </Drawer.Content>
        </Drawer.Popup>
      </Drawer.Viewport>
    </Drawer.Portal>
  );
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="down">
      {keyboardAware ? (
        <Drawer.VirtualKeyboardProvider>{portal}</Drawer.VirtualKeyboardProvider>
      ) : (
        portal
      )}
    </Drawer.Root>
  );
}
