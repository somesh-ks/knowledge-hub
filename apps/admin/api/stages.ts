import { configStoreUrl } from "../../../packages/engine/src/store/configPaths.js";
import { connectNeon } from "../../../packages/engine/src/store/neon.js";
import { readStageTimings } from "../../../packages/engine/src/store/runsStore.js";
import { handleStages, STAGE_DAYS } from "../src/lib/stagesApi.js";

// Workspace code is imported by relative path (see api/experiments.ts). The Health page's Stage
// times card: a Vercel Function beside the static admin app, behind the same gate as its pages
// (middleware.ts). It needs DATABASE_URL and SINGULARITY_CONFIG_STORE=postgres on this project, as
// the reader has; without them every answer is 503 and the card says so.

async function answer(request: Request): Promise<Response> {
  const url = configStoreUrl(process.env);
  const sql = url === null ? null : connectNeon(url);
  const result = await handleStages(
    request.method,
    sql === null ? null : () => readStageTimings(sql, Date.now(), STAGE_DAYS),
  );
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}

export const GET = answer;
