import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { getPlayerStore } from "./core/playerRuntime";
import { PLAYBACK_RATES } from "./core/playerTypes";
import { usePlayerState } from "./hooks/usePlayer";
import Icon from "./ui/LazyIcon";

/** The gap between the button and its menu. */
const MENU_GAP_PX = 8;

/**
 * The speed: a small button that shows it, and a menu of the four to pick from in one step (1x,
 * 1.25x, 1.5x, 2x, pitch preserved). The menu is a native popover, so it sits in the top layer,
 * closes on an outside press and on Escape, and needs no layering code. The choice is remembered
 * and shared with Settings, where the same four are laid out.
 */
export default function SpeedControl() {
  const state = usePlayerState();
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    // Placed against the button just before it is shown: above it, ending where the button ends.
    const place = (event: Event): void => {
      if ((event as ToggleEvent).newState !== "open") return;
      const button = buttonRef.current?.getBoundingClientRect();
      if (!button) return;
      menu.style.setProperty("--menu-bottom", `${window.innerHeight - button.top + MENU_GAP_PX}px`);
      menu.style.setProperty("--menu-right", `${window.innerWidth - button.right}px`);
    };
    const settle = (event: Event): void => {
      const isOpen = (event as ToggleEvent).newState === "open";
      setOpen(isOpen);
      if (isOpen) {
        menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
      }
    };
    menu.addEventListener("beforetoggle", place);
    menu.addEventListener("toggle", settle);
    return () => {
      menu.removeEventListener("beforetoggle", place);
      menu.removeEventListener("toggle", settle);
    };
  }, []);

  function close(): void {
    menuRef.current?.hidePopover();
    buttonRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    switch (event.key) {
      case "ArrowDown":
        next = (at + 1) % items.length;
        break;
      case "ArrowUp":
        next = (at - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      case "Escape":
      case "Tab":
        // Escape belongs to the menu while it is open: the player behind it stays.
        event.preventDefault();
        close();
        return;
      default:
        return;
    }
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <div className="speed">
      <button
        ref={buttonRef}
        className="speed-btn press num"
        type="button"
        popoverTarget={menuId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Playback speed ${state.rate}x`}
      >
        <Icon name="gauge" />
        <span aria-hidden="true">{state.rate}x</span>
      </button>
      <div
        ref={menuRef}
        id={menuId}
        className="speed-menu"
        popover="auto"
        role="menu"
        aria-label="Playback speed"
        onKeyDown={onKeyDown}
      >
        {PLAYBACK_RATES.map((rate) => (
          <button
            key={rate}
            className="speed-item press num"
            type="button"
            role="menuitemradio"
            aria-checked={state.rate === rate}
            tabIndex={state.rate === rate ? 0 : -1}
            onClick={() => {
              getPlayerStore().setRate(rate);
              close();
            }}
          >
            <span className="speed-item-mark" aria-hidden="true">
              {state.rate === rate ? <Icon name="check" /> : null}
            </span>
            {rate}x
          </button>
        ))}
      </div>
    </div>
  );
}
