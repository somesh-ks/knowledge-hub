import { useSyncExternalStore } from "react";

/** A wide window with a mouse: the bar keeps its transport and the page keeps the skips and the speed. */
const QUERY = "(min-width: 64rem) and (hover: hover) and (pointer: fine)";

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** True in a wide window with a mouse. The server and the first paint say false: a phone's order. */
export function useMouseWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
