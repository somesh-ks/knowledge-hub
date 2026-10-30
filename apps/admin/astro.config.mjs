import react from "@astrojs/react";
import { defineConfig } from "astro/config";

// The command center (D224): its own app and deploy, reached at news.someshks.work/admin by a rewrite
// in the reader's vercel.json, so every address and asset carries the /admin base. Static for now; the
// Vercel adapter joins when its first server route does (the data proxy and the owner gate).
// Under `astro dev` the overview's /api/health and /api/costs reach the reader's dev server (port
// 4321), as they reach the reader itself once the rewrite is in place. `astro preview` has no proxy:
// it answers addresses outside the base with its own 404.
const READER = process.env.READER_ORIGIN ?? "http://localhost:4321";

export default defineConfig({
  site: "https://news.someshks.work",
  base: "/admin",
  output: "static",
  integrations: [react()],
  trailingSlash: "never",
  compressHTML: true,
  vite: {
    server: { proxy: { "/api": READER } },
  },
});
