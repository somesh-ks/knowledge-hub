import { type Ask, handleAnalytics } from "../src/lib/analyticsApi.js";

// The Analytics page's numbers: a Vercel Function beside the static admin app, behind the same gate
// as its pages (middleware.ts). It holds the Simple Analytics key (SIMPLE_ANALYTICS_API_KEY on this
// project, from the account's settings); without it every answer is 503 and the page says so.
const SITE = "news.someshks.work";

function askerFor(env: NodeJS.ProcessEnv): Ask | null {
  const key = env.SIMPLE_ANALYTICS_API_KEY;
  if (!key) return null;
  return async (query) => {
    const response = await fetch(`https://simpleanalytics.com/${SITE}.json?${query}`, {
      headers: { "Api-Key": key, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const body: unknown = await response.json();
    const failed = !response.ok || (body as { ok?: unknown } | null)?.ok === false;
    if (failed) throw new Error(`simple analytics answered ${response.status}`);
    return body;
  };
}

async function answer(request: Request): Promise<Response> {
  const result = await handleAnalytics(request.method, askerFor(process.env));
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}

export const GET = answer;
