import { type PointerEvent, useDeferredValue, useEffect, useSyncExternalStore } from "react";
import { longDateFromDigestId } from "./core/formatTime";
import { recordingCaption } from "./core/playerCopy";
import { classifyKeyTarget, shouldToggleOnKey } from "./core/playerKeys";
import { getPlayerStore } from "./core/playerRuntime";
import { playerSheet } from "./core/playerSheet";
import { KEY_SEEK_SECONDS, KEY_SEEK_SHIFT_SECONDS } from "./core/scrubberMath";
import type { GestureZone, PointerInput } from "./core/sheetController";
import { usePlayerState } from "./hooks/usePlayer";
import PlayerBar, { PLAYER_PAGE_ID } from "./PlayerBar";
import {
  getPageContent,
  getServerPageContent,
  loadPageContent,
  type PageContentSnapshot,
  subscribePageContent,
} from "./pageContentLoader";
import SourceLink from "./SourceLink";
import Icon from "./ui/Icon";
import PlayerCover, { PlayerCoverGlow } from "./ui/PlayerCover";

const TITLE_ID = "dispatch-player-title";

/** Which part of the surface a pointer went down on. Null is a control with a job of its own. */
function zoneOf(target: EventTarget): GestureZone | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-player-open]")) return "dock";
  if (target.closest("[data-player-drag]")) return "drag";
  return target.closest("[data-player-page]") ? "page" : null;
}

function toInput(event: PointerEvent<HTMLElement>, zone: GestureZone): PointerInput {
  return {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    t: event.timeStamp,
    zone,
    touch: event.pointerType !== "mouse",
  };
}

function PageFallback({ status }: { status: PageContentSnapshot["status"] }) {
  if (status === "failed") {
    return (
      <div className="player-fallback" role="alert">
        <p>The controls did not load. Check your connection.</p>
        <button
          className="player-fallback-action"
          type="button"
          onClick={() => void loadPageContent()}
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="player-fallback" role="status">
      <span className="spinner" aria-hidden="true" />
      <p>Loading the controls</p>
    </div>
  );
}

/**
 * The player, as one surface: a bar docked at the bottom that grows into a full page. Below 64rem,
 * where motion is allowed, the bar's thumbnail flies into the page's cover as the page rises, one
 * cover on screen at a time; elsewhere the bar keeps its own thumbnail and the page has its own
 * cover. It is always mounted, inside the persisted island and never in a portal, so a navigation
 * cannot separate the page from the code that moves it.
 *
 *   .player          the surface. One set of pointer listeners, for both directions of travel.
 *     .player-stage  the clip box the page rises in. On a wide screen it ends at the bar's top.
 *       .player-page a dialog while open, inert while collapsed, and the one scroll container.
 *     .player-art    the one cover in flight between the bar and the page.
 *     .player-dock   the bar.
 *
 * The attributes that say where the page is (data-state, data-open, inert, aria-expanded, the
 * dialog role) belong to the surface controller, which writes them the instant they change. They
 * are rendered here only in their collapsed form, which is what the server sends.
 */
/**
 * The page's controls, or the way to them. Controls that arrive after the surface mounted render in
 * a pass React can pause for a press, and only this slot renders again: in one go they blocked a
 * throttled phone for about 140 ms at idle. Already loaded, they render in the surface's first pass.
 */
function PageBody() {
  const { Content, status } = useDeferredValue(
    useSyncExternalStore(subscribePageContent, getPageContent, getServerPageContent),
  );
  return Content ? <Content /> : <PageFallback status={status} />;
}

export default function PlayerSurface() {
  const state = usePlayerState();

  // Nodes that React has just made are told where the page is.
  useEffect(() => playerSheet.sync(), []);

  const digest = state.track?.digest;
  const timeline = state.track?.timeline;
  const item = timeline?.items[state.itemIndex];
  const title = digest ? digest.title || longDateFromDigestId(digest.id) : "";
  const visible = state.hasStarted && Boolean(digest?.audio);
  const cover = digest ? (
    <PlayerCover cover={digest.cover} weekly={digest.kind === "weekly"} size="player" />
  ) : null;

  return (
    <div
      className="player"
      data-player-surface
      data-state="collapsed"
      data-open="false"
      data-visible={visible ? "true" : "false"}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        const zone = zoneOf(event.target);
        if (!zone) return;
        // The first touch on the bar is the last chance to have the controls ready in time.
        if (zone === "dock") void loadPageContent();
        playerSheet.pointerDown(toInput(event, zone));
      }}
      onPointerMove={(event) => playerSheet.pointerMove(toInput(event, "page"))}
      onPointerUp={(event) => playerSheet.pointerEnd(toInput(event, "page"), false)}
      onPointerCancel={(event) => playerSheet.pointerEnd(toInput(event, "page"), true)}
      onLostPointerCapture={(event) => {
        // Only the surface's own capture counts. A finger's implicit capture on the element it
        // touched is lost, harmlessly, the moment the surface takes the drag over.
        if (event.target === event.currentTarget) {
          playerSheet.pointerEnd(toInput(event, "page"), true);
        }
      }}
    >
      <div className="player-stage" data-player-stage>
        <section
          className="player-page"
          id={PLAYER_PAGE_ID}
          data-player-page
          aria-labelledby={TITLE_ID}
          tabIndex={-1}
          inert
          onKeyDown={(event) => {
            const target = classifyKeyTarget(
              event.target instanceof Element ? event.target : null,
              event.currentTarget,
            );
            // The bar carries the seek control on a wide screen, so the arrows seek from the page.
            if (
              (target === "panel" || target === "other") &&
              (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              event.preventDefault();
              const step = event.shiftKey ? KEY_SEEK_SHIFT_SECONDS : KEY_SEEK_SECONDS;
              getPlayerStore().skip(event.key === "ArrowLeft" ? -step : step);
              return;
            }
            if (!shouldToggleOnKey(event, target)) return;
            // Only here, with focus in the open player: no page-wide Space shortcut.
            event.preventDefault();
            getPlayerStore().toggle();
          }}
        >
          <div className="player-page-inner">
            <div className="player-drag" data-player-drag>
              {/* A chevron at the top left on a phone (owner, 2026-10-20), so a listener who does not
                  know the page pulls down still sees how to put it away. From 64rem it shows only on
                  keyboard focus, as before: the bar is on screen there. */}
              <button
                className="icon-btn player-collapse"
                type="button"
                aria-label="Close the player"
                onClick={() => void playerSheet.collapse()}
              >
                <Icon name="chevronDown" className="icon" />
              </button>
              <div className="player-cover-slot">
                <div className="player-cover-box" data-player-cover>
                  {digest ? <PlayerCoverGlow cover={digest.cover} /> : null}
                  {cover}
                </div>
              </div>
              {/* Room for a changing story is kept only where the story changes: a recording with
                  no timeline of stories has one fixed line, and no empty gap under it. */}
              <div
                className="player-meta"
                data-stories={(timeline?.items.length ?? 0) > 0 ? "" : undefined}
                data-sourced={(timeline?.items.length ?? 0) > 0 ? "" : undefined}
              >
                <h2 className="player-title" id={TITLE_ID} title={title}>
                  {title}
                </h2>
                {/* The story being read, and where it came from. A recording without stories says
                    what it is, and so does an episode's rundown, before story 1: no story is being
                    read, and the line is the one story 1 will fill, so nothing moves when it starts.
                    A failure or an interruption takes the same room: its notice (PlayerNotice.tsx)
                    is put here in their place, so nothing below the title moves when it comes or
                    goes. */}
                <div className="player-meta-line" data-notice-slot>
                  {state.error || state.interrupted ? null : (
                    <>
                      <p className="player-story" key={item?.id ?? "story"}>
                        {item?.headline ?? recordingCaption(digest, state.duration)}
                      </p>
                      <SourceLink />
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="player-body">
              <PageBody />
            </div>
          </div>
        </section>
      </div>
      <div className="player-art" data-player-art aria-hidden="true">
        {cover}
      </div>
      <PlayerBar />
    </div>
  );
}
