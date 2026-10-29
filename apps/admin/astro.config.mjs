import { defineConfig } from "astro/config";

// The command center (D218): its own app and its own deploy, apart from the reader. Static for now;
// the Vercel adapter joins when its first server route does (the data proxy for Costs and Health).
export default defineConfig({
  site: "https://admin.someshks.work",
  output: "static",
  trailingSlash: "never",
  compressHTML: true,
});
