import { defineConfig } from "astro/config";

// The command center (D218): its own app and deploy, reached at news.someshks.work/admin by a rewrite
// in the reader's vercel.json, so every address and asset carries the /admin base. Static for now; the
// Vercel adapter joins when its first server route does (the data proxy and the owner gate).
export default defineConfig({
  site: "https://news.someshks.work",
  base: "/admin",
  output: "static",
  trailingSlash: "never",
  compressHTML: true,
});
