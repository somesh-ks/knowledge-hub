import { Drawer } from "@base-ui/react/drawer";
import { type CSSProperties, useRef } from "react";
import { playerSheet } from "./core/playerSheet";
import { usePlayerState } from "./hooks/usePlayer";
import PlayerSheetBody from "./PlayerSheetBody";

/**
 * The expanded player. Base UI's Drawer supplies the dialog semantics, the focus trap, the inert
 * background and the scroll lock; the sheet controller supplies the motion (see sheetController.ts
 * for why the two are kept apart). The Drawer is open for as long as this component is mounted, and
 * the controller unmounts it when the exit spring comes to rest.
 */
export default function ExpandedPlayer() {
  const state = usePlayerState();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const coverKey = state.track?.digest.cover.key;
  const style = coverKey ? ({ "--cover-key": coverKey } as CSSProperties) : undefined;

  return (
    <Drawer.Root
      open
      modal
      swipeDirection="down"
      onOpenChange={(open) => {
        // Escape, the scrim and the close button all land here. The sheet closes along its spring
        // and unmounts when it rests; the Drawer never closes itself.
        if (!open) playerSheet.close();
      }}
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="player-scrim" ref={scrimRef} />
        <Drawer.Viewport className="player-viewport">
          <Drawer.Popup
            className="player-panel"
            ref={panelRef}
            initialFocus={panelRef}
            finalFocus={false}
            data-cover-key={coverKey ? "" : undefined}
            // The gesture belongs to the controller, not to Base UI's swipe-to-dismiss.
            data-base-ui-swipe-ignore=""
            style={style}
          >
            <PlayerSheetBody panelRef={panelRef} scrimRef={scrimRef} />
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
