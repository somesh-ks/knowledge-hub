/**
 * The name of this build, written into every page (`<meta name="dispatch-build">`) and into
 * /build.json. An installed app that comes back to the front compares the two and loads the
 * current site when they differ (scripts/serviceWorker.ts). The commit on Vercel, the build's start
 * time elsewhere: any value works as long as each deploy gets a new one.
 */
export const BUILD_ID =
  (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 12) || String(Date.now());
