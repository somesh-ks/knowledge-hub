import { Drawer } from "@base-ui/react/drawer";
import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";
import Icon from "../player/ui/LazyIcon";

type InitialFocus = ComponentProps<typeof Drawer.Popup>["initialFocus"];

/**
 * Browser Back closes an open sheet and stays on the page, as it does for the Create sheet
 * (createSheet.ts): the sheet takes one history entry while it is open. The head script
 * (themeInit.js) asks first on every pop, and answering "handled" keeps the router out of it.
 */
function useBackCloses(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    let entry = true;
    let shown = true;
    const onBack = (event: Event): void => {
      if (!entry) return;
      entry = false;
      event.preventDefault();
      removeEventListener("dispatch:back", onBack);
      if (shown) closeRef.current();
    };
    history.pushState({ ...history.state, sheet: true }, "");
    addEventListener("dispatch:back", onBack);
    return () => {
      shown = false;
      // Closed any other way: give the entry back. The pop this causes reaches onBack, which
      // swallows it.
      if (entry) history.go(-1);
    };
  }, [open]);
}

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
  useBackCloses(open, () => onOpenChange(false));
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
