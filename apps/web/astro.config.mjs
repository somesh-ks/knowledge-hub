import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import { defineConfig } from "astro/config";
import { FUNCTION_MAX_DURATION_S } from "./src/server/functionLimits.mjs";

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

// Tests build without the adapter: the Vercel adapter bundles functions with symlinks, which Windows
// refuses without Developer Mode, and the e2e suite only needs the static output. The API routes
// become static stubs there; their logic is covered by unit tests.
const staticOnly = process.env.DISPATCH_STATIC_ONLY === "1";

function stubApiRoutesForStaticBuild() {
  return {
    name: "dispatch-static-only",
    hooks: {
      "astro:route:setup": ({ route }) => {
        if (route.component.replaceAll("\\", "/").includes("/pages/api/")) route.prerender = true;
      },
    },
  };
}

// The player lab pages exist only under `astro dev`: the player suite's lab target drives them. They
// are injected here instead of living in src/pages, so no build writes them.
const LAB_ROUTES = ["player-lab", "player-lab-older", "player-lab-preparing"];

function injectLabRoutesInDev() {
  return {
    name: "dispatch-dev-lab",
    hooks: {
      "astro:config:setup": ({ command, injectRoute }) => {
        if (command !== "dev") return;
        for (const name of LAB_ROUTES) {
          injectRoute({
            pattern: `/dev/${name}`,
            entrypoint: `./src/player/dev/routes/${name}.astro`,
          });
        }
      },
    },
  };
}

export default defineConfig({
  site: "https://news.someshks.work",
  // Static output. Only the routes that export `prerender = false` run on demand.
  output: "static",
  adapter: staticOnly ? undefined : vercel({ maxDuration: FUNCTION_MAX_DURATION_S }),
  integrations: [
    react(),
    injectLabRoutesInDev(),
    ...(staticOnly ? [stubApiRoutesForStaticBuild()] : []),
  ],
  // `true` keeps single spaces between inline elements, which the default "jsx" mode would strip.
  compressHTML: true,
  trailingSlash: "never",
  // The Library used to be the archive. Old links and installed shortcuts still land on it: the
  // Vercel adapter turns this into a real 308, and the static test build into a refresh page.
  redirects: {
    "/archive": { status: 308, destination: "/library" },
    // Topics and Sources are one page under the podcast settings.
    "/settings/topics": { status: 308, destination: "/settings/podcast/topics" },
    "/settings/sources": { status: 308, destination: "/settings/podcast/topics" },
  },
  build: {
    // External stylesheets: cached once, listed once for the service worker, and no inline style
    // hashes to track in the Content-Security-Policy.
    inlineStylesheets: "never",
  },
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  devToolbar: { enabled: false },
  // There is no Markdown content, and Shiki's inline styles do not fit a strict style policy.
  markdown: { syntaxHighlight: false },
  vite: {
    plugins: [keepCoverFontsReachable()],
    // Astro writes a script smaller than this limit into the page. When the router swaps in a page
    // whose last module script is inline, it adds a `data:` script to wait for it, and the policy
    // blocks that. Every page script stays a file.
    build: { assetsInlineLimit: 0 },
  },
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
        // Source icons are each site's own favicon, drawn over a letter that stays if one never loads.
        "img-src 'self' data: https:",
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
