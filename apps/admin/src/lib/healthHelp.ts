/**
 * What a flagged Health check means for readers, and where to start looking, by row id (a speed row by
 * its metric). The Health page says it under the check, and its prompt in Actions carries it, so
 * a person and an agent start from the same place (2026-11-05, the owner: "iterate until a human can
 * easily understand what is wrong"). A cause here is the likely one, not a diagnosis.
 */
export interface Help {
  /** What it means for readers, in a sentence. */
  means: string;
  /** Where to look first: a workflow, a command, a file. */
  start: string;
}

const run = (file: string): string =>
  `Open the latest run of .github/workflows/${file} on GitHub and read the failed step's log.`;

export const HELP: Record<string, Help> = {
  daily: {
    means: "Readers didn't get the podcast due on the last daily slot.",
    start: `${run("run.yml")} Then run npm run singularity -- status.`,
  },
  weekly: {
    means: "Readers didn't get this week's weekly podcast.",
    start: `${run("run.yml")} Then run npm run singularity -- status.`,
  },
  catch_up: {
    means: "A reader asked for a catch up episode and didn't get one.",
    start: run("podcast.yml"),
  },
  narration: {
    means: "The newest podcast has no audio, or its audio is much shorter than its set length.",
    start: `${run("audio.yml")} A short episode usually means a short script.`,
  },
  fallbacks: {
    means:
      "The main model failed in the last run and a fallback model wrote part of it; quality may differ.",
    start: "Search the last run.yml log for model_fallback to see which step and why.",
  },
  job_run: { means: "A podcast run failed this week.", start: run("run.yml") },
  job_podcast: { means: "A catch up run failed this week.", start: run("podcast.yml") },
  job_audio: { means: "A narration run failed this week.", start: run("audio.yml") },
  job_content: {
    means: "Syncing content to the store failed; the site may show older items.",
    start: run("content.yml"),
  },
  job_health: {
    means: "The daily check failed, so the Budgets below may be out of date.",
    start: run("health.yml"),
  },
  sources: {
    means: "Some feeds keep failing to fetch, so podcasts miss their stories.",
    start: "Check each named feed's address still answers; fix it in the app's sources settings.",
  },
  lcp: {
    means: "Pages take long to show their main content for real visitors this week.",
    start:
      "Compare with the last deploys (npm run vercel:list) and check what the slow pages load.",
  },
  inp: {
    means: "Taps and clicks take long to respond for real visitors this week.",
    start: "Look for long tasks on the pages visitors use most; compare with the last deploys.",
  },
  cls: {
    means: "Content jumps while pages load for real visitors this week.",
    start: "Find what changes size after first paint: images without sizes, late fonts or banners.",
  },
  page_errors: {
    means: "Scripts in readers' browsers threw errors; something on those pages may not work.",
    start: "Search the code for the reported message and open the page it names.",
  },
  blocked_scripts: {
    means: "The site's security policy blocked scripts. Often a browser extension; sometimes ours.",
    start: "If the blocked address is ours, the security policy needs it allowed.",
  },
  server_errors: {
    means: "The server answered requests with errors; those readers saw a failure.",
    start: "Run npm run vercel:logs and look for the named page.",
  },
  timeouts: {
    means: "Server functions ran out of time; those requests failed.",
    start: "Run npm run vercel:logs; apps/web/src/server/functionLimits.mjs sets the limits.",
  },
  database: {
    means: "The database didn't answer: field data, reports and rate limits are degraded.",
    start: "Check the Neon project is up and within its compute budget.",
  },
  content: {
    means: "The content store didn't answer, so pages show an older copy.",
    start: "Run npm run vercel:logs and look for the content store's errors.",
  },
  budget_cost: {
    means: "Spending, the database's compute or the deploy count is ahead of its budget.",
    start: "The reading names which; the admin's Costs page splits the spend by service.",
  },
  budget_speed: {
    means: "Pages are slower than their budget.",
    start: "Read the speed findings in the last health.yml run's log.",
  },
  budget_tests: {
    means: "The nightly browser suite failed or didn't run.",
    start: run("browser.yml"),
  },
  budget_bugs: {
    means: "The daily check found reliability or data faults over their budget.",
    start: "Read the findings in the last health.yml run's log.",
  },
  budget_security: {
    means: "There are open security alerts.",
    start: "Open the repository's Security tab on GitHub.",
  },
  budget_keys: {
    means: "A service key didn't answer; whatever uses it will fail.",
    start: "Run npm run singularity -- doctor. Never print a key's value.",
  },
};

/** The help for a row id: a speed row (`lcp.mobile`) by its metric. */
export const helpFor = (id: string): Help | undefined => HELP[id] ?? HELP[id.split(".")[0] ?? ""];
