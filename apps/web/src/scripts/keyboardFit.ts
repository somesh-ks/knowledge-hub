/**
 * Keeps a full-screen sheet above a phone's on-screen keyboard (2026-10-20). Left alone, Android
 * Chrome keeps the sheet full height under the keyboard and pans the whole screen up to show the
 * focused field, so the sheet's head slides off the top. Here the sheet ends where the keyboard
 * begins: its body scrolls the field into view and the head stays put.
 *
 * Where the browser has the VirtualKeyboard API (Chrome), the keyboard overlays the page while the
 * sheet is open, so nothing pans, and the sheet takes the keyboard's height off its own. Elsewhere
 * (Safari) the visual viewport says where the visible part of the screen is, and the sheet follows
 * it. Writes --keyboard (the height under the sheet) and --keyboard-top (where it starts); the
 * returned function undoes it all when the sheet closes.
 */

interface VirtualKeyboard extends EventTarget {
  overlaysContent: boolean;
  readonly boundingRect: DOMRect;
}

export function fitAboveKeyboard(sheet: HTMLElement): () => void {
  const keyboard = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard;
  const reveal = (): void => {
    const field = document.activeElement;
    if (field instanceof HTMLElement && sheet.contains(field))
      field.scrollIntoView({ block: "nearest" });
  };
  const write = (below: number, top: number): void => {
    sheet.style.setProperty("--keyboard", `${Math.max(0, Math.round(below))}px`);
    sheet.style.setProperty("--keyboard-top", `${Math.max(0, Math.round(top))}px`);
  };
  const clear = (): void => {
    sheet.style.removeProperty("--keyboard");
    sheet.style.removeProperty("--keyboard-top");
  };

  if (keyboard) {
    const before = keyboard.overlaysContent;
    keyboard.overlaysContent = true;
    const onChange = (): void => {
      const height = keyboard.boundingRect.height;
      write(height, 0);
      if (height > 0) requestAnimationFrame(reveal);
    };
    keyboard.addEventListener("geometrychange", onChange);
    return () => {
      keyboard.removeEventListener("geometrychange", onChange);
      keyboard.overlaysContent = before;
      clear();
    };
  }

  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const onChange = (): void => {
    const below = window.innerHeight - viewport.height - viewport.offsetTop;
    write(below, viewport.offsetTop);
    if (below > 0) requestAnimationFrame(reveal);
  };
  viewport.addEventListener("resize", onChange);
  viewport.addEventListener("scroll", onChange);
  return () => {
    viewport.removeEventListener("resize", onChange);
    viewport.removeEventListener("scroll", onChange);
    clear();
  };
}
