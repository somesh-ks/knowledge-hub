/**
 * The pages for running the app rather than reading it (D218): what /admin lists and what Settings'
 * Admin section links to, in one order. Each lives under /admin; the old addresses redirect
 * (astro.config.mjs). There is no sign-in, so these are as open as the pages they came from.
 */
export interface AdminPage {
  href: string;
  label: string;
  /** Another site, opened in a new tab. */
  external?: boolean;
}

export const ADMIN_PAGES: readonly AdminPage[] = [
  { href: "/admin/costs", label: "Costs" },
  { href: "/admin/health", label: "Health" },
  { href: "/admin/design", label: "Design system" },
  {
    href: "https://dashboard.simpleanalytics.com/news.someshks.work",
    label: "User engagement",
    external: true,
  },
];
