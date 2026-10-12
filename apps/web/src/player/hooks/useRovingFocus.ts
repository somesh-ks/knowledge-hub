import { type RefObject, useEffect, useRef } from "react";
import { installRovingFocus, type RovingList } from "../core/rovingFocus";

/**
 * Makes the items `selector` matches inside `ref` one Tab stop, moved with the arrow keys. `shown`
 * is false while the component renders nothing, so the wiring waits for the list to exist.
 */
export function useRovingFocus(
  ref: RefObject<HTMLElement | null>,
  selector: string,
  shown: boolean,
): void {
  const list = useRef<RovingList | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!shown || !root) return;
    list.current = installRovingFocus(root, selector);
    return () => {
      list.current?.dispose();
      list.current = null;
    };
  }, [ref, selector, shown]);
  // Every render may add items or move the current one: the stop follows.
  useEffect(() => {
    list.current?.sync();
  });
}
