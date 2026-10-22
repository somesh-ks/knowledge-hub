import { neon } from "@neondatabase/serverless";
import type { SqlClient } from "./configPaths.js";

/**
 * A client over Neon's HTTP endpoint: one fetch per query, nothing to close. The only module that
 * imports the driver. It is loaded on demand: behind the store switch for config (D149), and on the
 * site whenever DATABASE_URL is set, for the shared rate-limit counter (D150). The import is static
 * within this module so Vercel's file tracing finds the package for the functions that use it.
 */
export function connectNeon(databaseUrl: string): SqlClient {
  const sql = neon(databaseUrl);
  return {
    query: async (text, params) =>
      (await sql.query(text, params ?? [])) as unknown as Record<string, unknown>[],
  };
}
