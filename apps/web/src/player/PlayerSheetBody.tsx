import { Drawer } from "@base-ui/react/drawer";
import { type RefObject, useEffect, useRef } from "react";
import ChapterList from "./ChapterList";
import { longDateFromDigestId } from "./core/formatTime";
import { getPlayerStore } from "./core/playerRuntime";
import { playerSheet } from "./core/playerSheet";
import { usePlayerState } from "./hooks/usePlayer";
import PlayerNotice from "./PlayerNotice";
import Scrubber from "./Scrubber";
import SpeedControl from "./SpeedControl";
import TransportControls from "./TransportControls";
import UpNext from "./UpNext";
import Icon from "./ui/Icon";
import PlayerCover from "./ui/PlayerCover";

interface PlayerSheetBodyProps {
  panelRef: RefObject<HTMLDivElement | null>;
  scrimRef: RefObject<HTMLDivElement | null>;
}

/**
 * Everything inside the Drawer's popup. It hands its elements to the sheet controller on mount, so
 * the controller can drive them from `p` and the cover can morph from the mini player's cover.
 */
export default function PlayerSheetBody({ panelRef, scrimRef }: PlayerSheetBodyProps) {
  const state = usePlayerState();
  const dragRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const track = state.track;

  useEffect(() => {
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    const dragZone = dragRef.current;
    if (!panel || !scrim || !dragZone) return;
    // Focus returns to what opened the sheet. Base UI's own return is off: the sheet unmounts when
    // the exit spring rests, and this one knows the element is still in the document.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const detach = playerSheet.attach({
      panel,
      scrim,
      dragZone,
      cover: coverRef.current?.querySelector<HTMLElement>(".player-cover-frame") ?? null,
    });
    return () => {
      detach();
      if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, [panelRef, scrimRef]);

  if (!track) return null;
  const { digest, timeline } = track;
  const item = timeline?.items[state.itemIndex];
  const section = timeline?.sections[state.sectionIndex];
  const itemCount = timeline?.items.length ?? 0;
  const sourceLine = item?.source ?? "";

  return (
    <>
      <div className="player-drag" ref={dragRef}>
        <div className="player-handle" aria-hidden="true" />
        <div className="player-bar">
          <Drawer.Title className="player-bar-date">
            {digest.title || longDateFromDigestId(digest.id)}
          </Drawer.Title>
          <Drawer.Close className="player-close press" aria-label="Close the player">
            <Icon name="chevronDown" className="icon-lg" />
          </Drawer.Close>
        </div>
        <div className="player-cover" ref={coverRef}>
          <PlayerCover cover={digest.cover} weekly={digest.kind === "weekly"} size="player" />
        </div>
        <div className="player-meta">
          <p className="player-section">
            {section && itemCount > 0
              ? `${section.title}, ${state.itemIndex + 1} of ${itemCount}`
              : digest.title}
          </p>
          <p className="player-title">{item?.headline ?? digest.title}</p>
          {sourceLine ? <p className="player-source">{sourceLine}</p> : null}
        </div>
      </div>
      <div className="player-controls">
        <Scrubber />
        <TransportControls />
      </div>
      <div className="player-scroll scroll-area">
        <PlayerNotice onRetry={() => getPlayerStore().retry()} />
        <SpeedControl />
        <UpNext />
        <ChapterList />
      </div>
    </>
  );
}
