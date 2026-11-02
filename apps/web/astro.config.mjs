import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import { defineConfig } from "astro/config";
import { ANALYTICS_QUEUE_ORIGIN, ANALYTICS_SCRIPT_ORIGIN } from "./src/lib/analytics.ts";
import {
  importGraph,
  SHARED_STYLES_KEY,
  sharedIslandStylesheets,
  WAKE_STYLES_KEY,
  wakeStylesheets,
  withModulePreloads,
  withoutStylesheets,
} from "./src/lib/bundleBudget.ts";
import { BUILT_CONFIG_PATHS } from "./src/lib/configHash.ts";
import { FUNCTION_MAX_DURATION_S } from "./src/server/functionLimits.mjs";

// The data layer reads Digests/ at build time. Page code is bundled into chunks whose import.meta.url
// no longer points at the source tree, so the repository root is fixed here, where it is reliable.
process.env.SINGULARITY_REPO_ROOT ??=
  process.env.DISPATCH_REPO_ROOT ?? fileURLToPath(new URL("../../", import.meta.url));
process.env.DISPATCH_REPO_ROOT ??= process.env.SINGULARITY_REPO_ROOT;

// The inline scripts must run before first paint, so they cannot be external files: the saved-key
// move and the theme in the head, the device banners, the Library's saved view and the Settings
// theme select. Their hashes go into the
// Content-Security-Policy instead of allowing inline scripts in general.
const inlineScriptHash = (path) => {
  const code = readFileSync(new URL(path, import.meta.url), "utf8").trim();
  return `sha256-${createHash("sha256").update(code).digest("base64")}`;
};
const inlineScriptHashes = [
  inlineScriptHash("./src/scripts/storageRename.js"),
  inlineScriptHash("./src/scripts/themeInit.js"),
  inlineScriptHash("./src/scripts/bannersInit.js"),
  inlineScriptHash("./src/scripts/libraryViewInit.js"),
  inlineScriptHash("./src/scripts/settingsInit.js"),
];

/**
 * @singularity/cover finds its font files relative to its own source file (import.meta.url). Bundling
 * moves that code into a build chunk, which would point the renderer at a folder with no fonts and
 * leave every cover without its date. This pins the URL to the real source file before bundling.
 */
function keepCoverFontsReachable() {
  return {
    name: "singularity-cover-fonts",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0].replaceAll("\\", "/");
      if (!file.endsWith("/packages/cover/src/fonts.ts")) return null;
      return code.replaceAll("import.meta.url", JSON.stringify(pathToFileURL(file).href));
    },
  };
}

/**
 * Names every module a page loads at start in a modulepreload link, so the islands' graph downloads
 * beside the CSS instead of one round trip at a time after idle. A hand-edited build made the bar
 * pressable 1.3 to 2.5 s sooner on a throttled phone with the largest paint unchanged
 * (docs/engineering/first-load-js.md). Links, not inline scripts: the policy hashes every inline script.
 * A `client:wake` island gets none: its modules load when the page wakes it (scripts/islandWake.ts).
 * The pages rendered on request (D173) are not in the build's HTML: the scripts' imports go into
 * MODULE_GRAPH_FILE, which the function carries, and middleware.ts adds their links from it. It is
 * written at `astro:build:generated`, before the adapter's `astro:build:done` packs the function.
 */
const MODULE_GRAPH_FILE = "./.cache/module-graph.json";

function preloadPageModules() {
  const reader = (dir) => {
    const root = fileURLToPath(dir);
    return (url) => {
      const file = join(root, url);
      return existsSync(file) ? readFileSync(file, "utf8") : null;
    };
  };
  return {
    name: "singularity-module-preload",
    hooks: {
      "astro:build:generated": ({ dir }) => {
        const assets = join(fileURLToPath(dir), "_astro");
        const files = existsSync(assets)
          ? readdirSync(assets).map((name) => `/_astro/${name}`)
          : [];
        const urls = files.filter((url) => url.endsWith(".js"));
        const read = reader(dir);
        const target = fileURLToPath(new URL(MODULE_GRAPH_FILE, import.meta.url));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(
          target,
          JSON.stringify({
            ...importGraph(urls, read),
            [WAKE_STYLES_KEY]: wakeStylesheets(files, read),
            [SHARED_STYLES_KEY]: sharedIslandStylesheets(urls, read),
          }),
        );
      },
      "astro:build:done": ({ dir }) => {
        const root = fileURLToPath(dir);
        const read = reader(dir);
        const assets = join(root, "_astro");
        const wakeStyles = wakeStylesheets(
          existsSync(assets) ? readdirSync(assets).map((name) => `/_astro/${name}`) : [],
          read,
        );
        for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
          const file = join(entry.parentPath, entry.name);
          const html = readFileSync(file, "utf8");
          const hinted = withoutStylesheets(withModulePreloads(html, read), wakeStyles);
          if (hinted !== html) writeFileSync(file, hinted);
        }
      },
    },
  };
}

/** `client:wake`: an island that hydrates when the page wakes it (src/lib/wakeDirective.ts). */
function wakeDirective() {
  return {
    name: "singularity-wake-directive",
    hooks: {
      "astro:config:setup": ({ addClientDirective }) => {
        addClientDirective({
          name: "wake",
          entrypoint: fileURLToPath(new URL("./src/lib/wakeDirective.ts", import.meta.url)),
        });
      },
    },
  };
}

// Tests build without the adapter: the Vercel adapter bundles functions with symlinks, which Windows
// refuses without Developer Mode, and the e2e suite only needs the static output. The API routes
// become static stubs there; their logic is covered by unit tests. A page rendered on request from
// the content repository is prerendered from the checkout there, as it was before D173.
const staticOnly =
  (process.env.SINGULARITY_STATIC_ONLY ?? process.env.DISPATCH_STATIC_ONLY) === "1";

function stubApiRoutesForStaticBuild() {
  return {
    name: "singularity-static-only",
    hooks: {
      "astro:route:setup": ({ route }) => {
        // With no adapter every route is prerendered: the API stubs, the pages rendered on request
        // from the content repository (D173), and the redirects that point at them.
        route.prerender = true;
      },
    },
  };
}

// A page rendered on request (D173) draws the same layout as a built one, which reads these from the
// checkout: the brand colours from the tokens, the settings digest from the config files, and the
// core package that marks the repository root. Nothing imports them, so the function would not carry
// them, and a missing config file reads as empty: a digest no settings answer matches, with no error.
const FILES_PAGES_READ = [
  "./src/styles/tokens.css",
  "../../packages/core/package.json",
  // The covers drawn on request (D256) load their fonts from the function's own copy of these.
  ...["Regular", "Medium", "Bold", "Black"].map(
    (weight) => `../../packages/cover/fonts/SchibstedGrotesk-${weight}.ttf`,
  ),
  // Written during the build, before the adapter packs the function (preloadPageModules).
  MODULE_GRAPH_FILE,
  // config/structure.json exists only once the owner edits a structure (D170); the adapter refuses
  // an include that is not there.
  ...BUILT_CONFIG_PATHS.map((path) => `../../${path}`).filter((path) =>
    existsSync(fileURLToPath(new URL(path, import.meta.url))),
  ),
];

export default defineConfig({
  site: "https://news.someshks.work",
  // Static output. Only the routes that export `prerender = false` run on demand.
  output: "static",
  // Skew protection stays off whatever the Vercel project says. It writes `?dpl=<deployment>` into
  // every asset address and import, and Vite then drops the preload list from each lazy import, so
  // production stopped matching the tested build: no modulepreload links, player.css linked twice,
  // and the budget check reading 11 KB of a 75 KB first load (found 2026-11-01 by the performance
  // audit). The service worker already keeps an open tab's files across a deploy, and buildGuard.ts
  // turns a move into a page of another build into a full load.
  adapter: staticOnly
    ? undefined
    : vercel({
        maxDuration: FUNCTION_MAX_DURATION_S,
        includeFiles: FILES_PAGES_READ,
        skewProtection: false,
      }),
  integrations: [
    react(),
    wakeDirective(),
    preloadPageModules(),
    ...(staticOnly ? [stubApiRoutesForStaticBuild()] : []),
  ],
  // `true` keeps single spaces between inline elements, which the default "jsx" mode would strip.
  compressHTML: true,
  trailingSlash: "never",
  // The Library used to be the archive. Old links and installed shortcuts still land on it: the
  // Vercel adapter turns this into a real 308, and the static test build into a refresh page.
  // Settings is two levels: the index and one page per thing it sets (Daily, Weekly, Custom, Topics,
  // Model). The addresses of the pages that came before keep working.
  redirects: {
    "/archive": { status: 308, destination: "/library" },
    "/settings/podcast": { status: 308, destination: "/settings" },
    // Topics became Categories (2026-10-25): the old addresses keep working.
    "/settings/topics": { status: 308, destination: "/settings/categories" },
    "/settings/topics/[id]": { status: 308, destination: "/settings/categories/[id]" },
    "/settings/podcast/topics": { status: 308, destination: "/settings/categories" },
    "/settings/sources": { status: 308, destination: "/settings/categories" },
    "/settings/schedule": { status: 308, destination: "/settings/daily" },
    // An episode on request is set up in the Create panel, which /create shows as a page.
    "/settings/custom": { status: 308, destination: "/create" },
    // The judge's finer topics have no page of their own since D69: each goes to the one of the
    // owner's four topics that gathers it, and the ones no topic lists go to Other.
    ...Object.fromEntries(
      [
        ["design_engineering_craft", "design"],
        ["hci_empirical_research", "design"],
        ["ui_component_primitives", "design"],
        ["css_canvas_motion_techniques", "design"],
        ["developer_tool_launches", "software"],
        ["software_engineering_depth", "software"],
        ["taste_and_design_philosophy", "design"],
        ["ai_ux_interaction_patterns", "ai"],
        ["frontier_model_releases", "ai"],
        ["consumer_tech_releases", "tech"],
        ["venture_capital_and_gossip", "other"],
        ["generic_ai_hype_listicles", "other"],
        ["trending", "other"],
      ].map(([from, to]) => [
        `/settings/categories/${from}`,
        { status: 308, destination: `/settings/categories/${to}` },
      ]),
    ),
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
    // The shared page's static paths exist only in the static build, so the server build drops them.
    define: { __SINGULARITY_STATIC_ONLY__: JSON.stringify(staticOnly) },
    // Astro writes a script smaller than this limit into the page. When the router swaps in a page
    // whose last module script is inline, it adds a `data:` script to wait for it, and the policy
    // blocks that. Every page script stays a file.
    build: { assetsInlineLimit: 0 },
  },
  security: {
    csp: {
      algorithm: "SHA-256",
      // Simple Analytics (D154): its script, and the queue it sends page views to, by beacon or image.
      scriptDirective: {
        resources: ["'self'", ANALYTICS_SCRIPT_ORIGIN],
        hashes: inlineScriptHashes,
      },
      // Server-rendered style attributes only carry computed custom properties (a cover's palette).
      // Attributes cannot run script, so allowing them does not widen the script policy.
      styleDirective: {
        resources: ["'self'", { resource: "'unsafe-inline'", kind: "attribute" }],
      },
      directives: [
        "default-src 'self'",
        `img-src 'self' data: ${ANALYTICS_QUEUE_ORIGIN}`,
        "font-src 'self'",
        "media-src 'self' https://*.public.blob.vercel-storage.com",
        // The blob host too, so a download can read the audio file it saves (CORS on the host).
        `connect-src 'self' https://*.public.blob.vercel-storage.com ${ANALYTICS_QUEUE_ORIGIN}`,
        "manifest-src 'self'",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
});
