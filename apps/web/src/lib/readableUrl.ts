/**
 * An address as a source row shows it: the host without www, then the path without a trailing
 * slash; "" when it is not an address. Imports nothing, so the build (SourceRow.astro, through
 * lib/manage.ts) and the page scripts (the editor, a row drawn from the config store) agree.
 */
export function readableUrl(address: string | null | undefined): string {
  if (!address) return "";
  try {
    const url = new URL(address);
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return "";
  }
}
