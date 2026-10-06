import { useSyncExternalStore } from "react";
import { playerSheet } from "../core/playerSheet";

/** Whether the expanded player should be mounted. True until the exit spring comes to rest. */
export function useSheetPresence(): boolean {
  return useSyncExternalStore(playerSheet.subscribePresence, playerSheet.getPresence, () => false);
}
