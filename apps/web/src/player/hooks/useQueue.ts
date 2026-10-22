import { useEffect, useState, useSyncExternalStore } from "react";
import { getPlayQueue } from "../core/playerRuntime";
import { loadQueueMeta, type QueueMeta, queueMetaFor } from "../core/queueMeta";

const EMPTY: readonly string[] = [];

/** The queued ids, in order. */
export function useQueue(): readonly string[] {
  return useSyncExternalStore(
    (onChange) => getPlayQueue().subscribe(onChange),
    () => getPlayQueue().getIds(),
    () => EMPTY,
  );
}

/** A queued item's title and cover, read from its page the first time it is drawn. */
export function useQueueMeta(id: string): QueueMeta | null {
  const [meta, setMeta] = useState(() => queueMetaFor(id));
  useEffect(() => {
    let live = true;
    setMeta(queueMetaFor(id));
    void loadQueueMeta(id).then((loaded) => {
      if (live) setMeta(loaded);
    });
    return () => {
      live = false;
    };
  }, [id]);
  return meta;
}
