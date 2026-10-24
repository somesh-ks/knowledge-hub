/**
 * What a shared page tells Simple Analytics (D153, plan section 4). Its page views and events report
 * the path `/s`, never `/s/<token>`: a public dashboard would publish working links. Every other
 * page reports its own path.
 */

/** The path every page view and event of a shared page reports. */
export const LISTEN_PATH = "/s";

/** Whether an address is a shared page's, /s/<token>. */
export const isSharedPath = (pathname: string): boolean => pathname.startsWith(`${LISTEN_PATH}/`);

/** The path analytics is told for a page: `/s` for a shared page, else the page's own. */
export const analyticsPath = (pathname: string): string =>
  isSharedPath(pathname) ? LISTEN_PATH : pathname;
