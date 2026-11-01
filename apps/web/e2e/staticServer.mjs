import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A static server for the e2e tests and visual review. `astro preview` does not support the Vercel
 * adapter, so this serves the build output the way Vercel would: clean URLs, the headers from
 * vercel.json (the Content-Security-Policy included, so a violation fails a test), Range requests
 * for audio, and 404.html for unknown paths. The API routes are functions and are not served here;
 * they are covered by unit tests with injected fetch. `mounts` serves another build under a prefix
 * the way the reader's rewrite does (the admin app at /admin, its prefix stripped).
 *
 * Usage: node e2e/staticServer.mjs [directory] [port]
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

function loadHeaderRules() {
  const config = JSON.parse(readFileSync(join(HERE, "..", "vercel.json"), "utf8"));
  return (config.headers ?? []).map((rule) => ({
    // vercel.json sources use "(.*)" as a wildcard. Swap it out first so its own dot is not escaped.
    pattern: new RegExp(
      `^${rule.source.replaceAll("(.*)", "*").replaceAll(".", "\\.").replaceAll("*", ".*")}$`,
    ),
    headers: rule.headers,
  }));
}

/**
 * @param {{
 *   root: string,
 *   port: number,
 *   mounts?: Record<string, string>,
 *   api?: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, pathname: string) => boolean,
 * }} options
 */
export function startServer({ root, port, mounts = {}, api }) {
  const rules = loadHeaderRules();

  function headersFor(pathname) {
    const headers = {};
    for (const rule of rules) {
      if (!rule.pattern.test(pathname)) continue;
      for (const { key, value } of rule.headers) headers[key] = value;
    }
    return headers;
  }

  function resolveFile(pathname) {
    let base = root;
    let path = pathname;
    for (const [prefix, dir] of Object.entries(mounts)) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        base = dir;
        path = pathname.slice(prefix.length) || "/";
      }
    }
    const clean = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, "");
    const target = join(base, clean);
    if (!target.startsWith(base)) return null;
    for (const candidate of [target, join(target, "index.html"), `${target}.html`]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  function send(request, response, file, status) {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    const stats = statSync(file);
    const headers = {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      ...headersFor(pathname),
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
    if (range && status === 200) {
      const start = range[1] === "" ? Math.max(0, stats.size - Number(range[2])) : Number(range[1]);
      const end = range[1] !== "" && range[2] !== "" ? Number(range[2]) : stats.size - 1;
      response.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Content-Length": end - start + 1,
      });
      createReadStream(file, { start, end }).pipe(response);
      return;
    }
    response.writeHead(status, { ...headers, "Content-Length": stats.size });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  }

  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    // A test that owns its server answers the routes it names (slowStore.spec.ts); `api` returns
    // true when it did.
    if (api?.(request, response, pathname)) return;
    if (pathname === "/api/voices" && request.method === "GET") {
      // A small fixed list in the route's contract, so the voice selects fill in tests without a
      // Speechify key. Only the first voice has a sample.
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          voices: [
            {
              id: "voice-ada",
              name: "Ada",
              gender: "female",
              language: "en-US",
              preview_url: "/fixtures/voice-ada.mp3",
            },
            { id: "voice-leo", name: "Leo", gender: "male", language: "en-US", preview_url: null },
            {
              id: "voice-nora",
              name: "Nora",
              gender: "female",
              language: "en-GB",
              preview_url: null,
            },
          ],
        }),
      );
      return;
    }
    if (pathname === "/api/voice-sample" && request.method === "GET") {
      // Ada's sample is the fixture recording; the other voices have none, as in the list above.
      const voice = new URL(request.url ?? "/", "http://localhost").searchParams.get("voice");
      const file = voice === "voice-ada" ? resolveFile("/fixtures/audio.wav") : null;
      if (file) send(request, response, file, 200);
      else {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "not_found" }));
      }
      return;
    }
    if (pathname === "/api/share" && request.method === "POST") {
      // No share link here (D153): an answer with no token, so Share sends the page's own address
      // as a site whose database is down does, without the console line a refusal costs every test.
      // The sharing journey (share.spec.ts) answers this route with the real handler instead.
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: 200 }));
      return;
    }
    if (pathname.startsWith("/api/")) {
      response.writeHead(501, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not served by the static test server" }));
      return;
    }
    const file = resolveFile(pathname);
    // A deploy, for one browser context only: its `test-build` cookie renames the build in every
    // page and in /build.json, the way a new deploy would. Playwright's routes never see a request
    // the service worker makes, and the test is about what the worker serves.
    const deploy = /(?:^|;\s*)test-build=([\w-]+)/.exec(request.headers.cookie ?? "")?.[1];
    if (file && deploy && /\.(html|json)$/.test(file) && request.method === "GET") {
      const body = readFileSync(file, "utf8")
        .replace(/(<meta name="singularity-build" content=")[^"]*"/, `$1${deploy}"`)
        .replace(/^\{"build":"[^"]*"\}/, `{"build":"${deploy}"}`);
      response.writeHead(200, {
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        ...headersFor(pathname),
      });
      response.end(body);
      return;
    }
    // The config store switched on (D149), for one browser context only: its `test-config-store`
    // cookie gives every page the tag a build with SINGULARITY_CONFIG_STORE=postgres writes, naming the
    // config files the cookie names, so the pages ask /api/config, which the test answers.
    const store = /(?:^|;\s*)test-config-store=([\w-]+)/.exec(request.headers.cookie ?? "")?.[1];
    if (file && store && file.endsWith(".html") && request.method === "GET") {
      const body = readFileSync(file, "utf8").replace(
        /(<meta name="singularity-build" content="[^"]*" ?\/?>)/,
        `$1<meta name="singularity-config-store" content="${store}">`,
      );
      response.writeHead(200, { "Content-Type": TYPES[".html"], ...headersFor(pathname) });
      response.end(body);
      return;
    }
    if (file) {
      send(request, response, file, 200);
      return;
    }
    const notFound = join(root, "404.html");
    if (existsSync(notFound)) send(request, response, notFound, 404);
    else {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Serving ${root} at http://127.0.0.1:${port}`);
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(HERE, "..", "dist"));
  const port = Number(process.argv[3] ?? process.env.PORT ?? 4321);
  if (!existsSync(root)) {
    console.error(`No build output at ${root}. Run the build first.`);
    process.exit(1);
  }
  startServer({ root, port });
}
