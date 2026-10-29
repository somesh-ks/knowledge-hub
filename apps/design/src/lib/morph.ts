/**
 * Brings a live element to new markup by editing it in place, so the nodes survive and the CSS
 * transitions a state change should show (a switch's thumb sliding, a tab's indicator moving) run.
 * Replacing the markup would redraw every node and show only the end state. Nodes that differ in
 * kind are replaced; form properties follow their attributes, which the parser sets only once.
 */
function syncAttributes(from: Element, to: Element): void {
  for (const { name } of Array.from(from.attributes))
    if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of Array.from(to.attributes))
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  if (from instanceof HTMLInputElement && to instanceof HTMLInputElement) {
    from.checked = to.checked;
    from.disabled = to.disabled;
    if (from.value !== to.value) from.value = to.value;
  }
  if (
    from instanceof HTMLTextAreaElement &&
    to instanceof HTMLTextAreaElement &&
    from.value !== to.value
  )
    from.value = to.value;
  if (
    from instanceof HTMLSelectElement &&
    to instanceof HTMLSelectElement &&
    from.value !== to.value
  )
    from.value = to.value;
  if (from instanceof HTMLButtonElement && to instanceof HTMLButtonElement)
    from.disabled = to.disabled;
}

function morphChildren(from: Node, to: Node): void {
  const target = Array.from(to.childNodes);
  const current = Array.from(from.childNodes);
  for (let i = 0; i < target.length; i++) {
    const next = target[i] as Node;
    const old = current[i];
    if (!old) {
      from.appendChild(next.cloneNode(true));
      continue;
    }
    if (old.nodeType !== next.nodeType || old.nodeName !== next.nodeName) {
      from.replaceChild(next.cloneNode(true), old);
      continue;
    }
    if (old.nodeType === Node.ELEMENT_NODE) {
      syncAttributes(old as Element, next as Element);
      // An SVG's path is the whole glyph: swap it whole rather than walk it.
      if (old.nodeName.toLowerCase() === "svg") {
        if ((old as Element).innerHTML !== (next as Element).innerHTML)
          (old as Element).innerHTML = (next as Element).innerHTML;
      } else morphChildren(old, next);
    } else if (old.textContent !== next.textContent) {
      old.textContent = next.textContent;
    }
  }
  for (let i = current.length - 1; i >= target.length; i--) from.removeChild(current[i] as Node);
}

export function morph(host: Element, html: string): void {
  const template = document.createElement("template");
  template.innerHTML = html;
  morphChildren(host, template.content);
}
