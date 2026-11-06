/**
 * Where what sticks under the top chrome sticks now, in pixels: `--sticky-top`, resolved. Below 64rem
 * the app bar slides away on a scroll down and `--sticky-top` follows it (shell.css), and the strip's
 * own `top` eases between the two, so reading the strip mid-move would give a value in between. A
 * fixed probe with no transition resolves the end value at once.
 */
export function stickyTop(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:var(--sticky-top);height:0;visibility:hidden";
  document.body.append(probe);
  const top = probe.getBoundingClientRect().top;
  probe.remove();
  return top;
}
