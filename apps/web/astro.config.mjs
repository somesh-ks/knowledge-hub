import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import { defineConfig } from "astro/config";

// The data layer reads Digests/ at build time. Page code is bundled into chunks whose import.meta.url
// no longer points at the source tree, so the repository root is fixed here, where it is reliable.
process.env.DISPATCH_REPO_ROOT ??= fileURLToPath(new URL("../../", import.meta.url));

// The inline theme script must run before first paint, so it cannot be an external file. Its hash goes
// into the Content-Security-Policy instead of allowing inline scripts in general.
const themeInit = readFileSync(
  new URL("./src/scripts/themeInit.js", import.meta.url),
  "utf8",
).trim();
const themeInitHash = `sha256-${createHash("sha256").update(themeInit).digest("base64")}`;

/**
 * @dispatch/cover finds its font files relative to its own source file (import.meta.url). Bundling
 * moves that code into a build chunk, which would point the renderer at a folder with no fonts and
 * leave every cover without its date. This pins the URL to the real source file before bundling.
 */
function keepCoverFontsReachable() {
  return {
    name: "dispatch-cover-fonts",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0].replaceAll("\\", "/");
      if (!file.endsWith("/packages/cover/src/fonts.ts")) return null;
      return code.replaceAll("import.meta.url", JSON.stringify(pathToFileURL(file).href));
    },
  };
}

export default defineConfig({
  site: "https://news.someshks.work",
  // Static output. Only the two routes that export `prerender = false` run on demand.
  output: "static",
  adapter: vercel({ maxDuration: 20 }),
  integrations: [react()],
  // `true` keeps single spaces between inline elements, which the default "jsx" mode would strip.
  compressHTML: true,
  trailingSlash: "never",
  build: {
    // External stylesheets: cached once, listed once for the service worker, and no inline style
    // hashes to track in the Content-Security-Policy.
    inlineStylesheets: "never",
  },
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  devToolbar: { enabled: false },
  // There is no Markdown content, and Shiki's inline styles do not fit a strict style policy.
  markdown: { syntaxHighlight: false },
  vite: { plugins: [keepCoverFontsReachable()] },
  security: {
    csp: {
      algorithm: "SHA-256",
      scriptDirective: { resources: ["'self'"], hashes: [themeInitHash] },
      // Server-rendered style attributes only carry computed custom properties (a cover's palette).
      // Attributes cannot run script, so allowing them does not widen the script policy.
      styleDirective: {
        resources: ["'self'", { resource: "'unsafe-inline'", kind: "attribute" }],
      },
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "media-src 'self' https://*.public.blob.vercel-storage.com",
        "connect-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
});
