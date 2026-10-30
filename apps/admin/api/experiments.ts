import { configStoreUrl } from "../../../packages/engine/src/store/configPaths.js";
import {
  type ExperimentFlags,
  readExperimentFlags,
  setExperimentEnabled,
  setExperimentPromoted,
} from "../../../packages/engine/src/store/experimentFlags.js";
import { readExperimentHits } from "../../../packages/engine/src/store/experimentHits.js";
import { connectNeon } from "../../../packages/engine/src/store/neon.js";
import {
  type ExperimentStore,
  type FlagRow,
  handleExperiments,
} from "../src/lib/experimentsApi.js";

// Workspace code is imported by relative path: a bare `@singularity/engine/...` import resolves to
// source the function bundle omits, and every request then crashes at load (2026-10-30).
// The Experiments page's switches (D249): a Vercel Function beside the static admin app, behind the
// same gate as its pages (middleware.ts). It needs DATABASE_URL and SINGULARITY_CONFIG_STORE=postgres
// on this project, as the reader has; without them every answer is 503 and the page says so.

const rows = (flags: ExperimentFlags): FlagRow[] =>
  Object.entries(flags).map(([id, flag]) => ({ id, ...flag }));

function storeFor(env: NodeJS.ProcessEnv): ExperimentStore | null {
  const url = configStoreUrl(env);
  if (url === null) return null;
  const sql = connectNeon(url);
  return {
    read: async () => rows(await readExperimentFlags(sql)),
    hits: () => readExperimentHits(sql, Date.now()),
    setEnabled: (id, enabled) => setExperimentEnabled(sql, id, enabled),
    setPromoted: (id, promoted) => setExperimentPromoted(sql, id, promoted),
  };
}

async function answer(request: Request): Promise<Response> {
  const bodyText = request.method === "POST" ? (await request.text()).slice(0, 1024) : "";
  const result = await handleExperiments(
    { method: request.method, contentType: request.headers.get("content-type"), bodyText },
    storeFor(process.env),
  );
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}

export const GET = answer;
export const POST = answer;
