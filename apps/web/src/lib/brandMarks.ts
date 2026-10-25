/**
 * Small monochrome marks for the paid services the Costs page names (pages/analytics.astro, drawn by
 * scripts/costsPage.ts). Filled paths in currentColor, so they take the text's ink in either theme.
 * Not the glyph set (lib/icons.ts is generated from Phosphor and holds only icons): these are plain
 * geometric stand-ins, not the companies' artwork, and load nothing. GitHub is Phosphor's fill mark.
 * A service without a mark here shows its name alone.
 */
export interface BrandMark {
  viewBox: string;
  d: string;
  /** True for a mark that cuts a hole (the Anthropic A). */
  evenodd?: boolean;
}

export const BRAND_MARKS: Record<string, BrandMark> = {
  anthropic: {
    viewBox: "0 0 24 24",
    d: "M10.6 3 4 21h3.4l1.3-3.7h6.6L16.6 21H20L13.4 3ZM9.8 14.4 12 8.4l2.2 6Z",
    evenodd: true,
  },
  speechify: {
    viewBox: "0 0 24 24",
    d: "M3 10h2v4H3ZM7 6h2v12H7ZM11 3h2v18h-2ZM15 6h2v12h-2ZM19 10h2v4h-2Z",
  },
  firecrawl: {
    viewBox: "0 0 24 24",
    d: "M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.2 1.2.8 2 1.5 2.3C10 7 10.5 4.5 12 2Z",
  },
  vercel: { viewBox: "0 0 24 24", d: "M12 2 23 21H1Z" },
  github: {
    viewBox: "0 0 256 256",
    d: "M216,104v8a56.06,56.06,0,0,1-48.44,55.47A39.8,39.8,0,0,1,176,192v40a8,8,0,0,1-8,8H104a8,8,0,0,1-8-8V216H72a40,40,0,0,1-40-40A24,24,0,0,0,8,152a8,8,0,0,1,0-16,40,40,0,0,1,40,40,24,24,0,0,0,24,24H96v-8a39.8,39.8,0,0,1,8.44-24.53A56.06,56.06,0,0,1,56,112v-8a58.14,58.14,0,0,1,7.69-28.32A59.78,59.78,0,0,1,69.07,28,8,8,0,0,1,76,24a59.75,59.75,0,0,1,48,24h24a59.75,59.75,0,0,1,48-24,8,8,0,0,1,6.93,4,59.74,59.74,0,0,1,5.37,47.68A58,58,0,0,1,216,104Z",
  },
  exa: { viewBox: "0 0 24 24", d: "M5 3h14v3H8v4.5h9v3H8V18h11v3H5Z" },
  gemini: {
    viewBox: "0 0 24 24",
    d: "M12 2c.6 5.5 4.5 9.4 10 10-5.5.6-9.4 4.5-10 10-.6-5.5-4.5-9.4-10-10 5.5-.6 9.4-4.5 10-10Z",
  },
  typesafe: { viewBox: "0 0 24 24", d: "M4 3h16v4h-6v14h-4V7H4Z" },
};
