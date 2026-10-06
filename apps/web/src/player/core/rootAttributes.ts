/**
 * State that lives on <html>: data attributes the CSS reads and the cover key color. Astro's
 * ClientRouter replaces the root element's attributes on every navigation, so the desired values
 * are remembered here and written again after each swap.
 */
const attributes = new Map<string, string>();
const properties = new Map<string, string>();

export function setRootAttribute(name: string, value: string | null): void {
  if (value === null) {
    attributes.delete(name);
    document.documentElement.removeAttribute(name);
    return;
  }
  attributes.set(name, value);
  if (document.documentElement.getAttribute(name) !== value) {
    document.documentElement.setAttribute(name, value);
  }
}

export function setRootProperty(name: string, value: string | null): void {
  if (value === null) {
    properties.delete(name);
    document.documentElement.style.removeProperty(name);
    return;
  }
  properties.set(name, value);
  document.documentElement.style.setProperty(name, value);
}

/** Call after `astro:after-swap`, when the incoming document's root attributes replaced ours. */
export function reapplyRootState(): void {
  const root = document.documentElement;
  for (const [name, value] of attributes) root.setAttribute(name, value);
  for (const [name, value] of properties) root.style.setProperty(name, value);
}
