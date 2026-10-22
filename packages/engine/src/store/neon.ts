import { neon } from "@neondatabase/serverless";
import type { SqlClient } from "./configPaths.js";

/**
 * A client over Neon's HTTP endpoint: one fetch per query, nothing to close. The only module that
 * imports the driver; it is loaded behind the store switch (D149), statically within this module so
 * Vercel's file tracing finds the package for the function that writes edits.
 */
export function connectNeon(databaseUrl: string): SqlClient {
  const sql = neon(databaseUrl);
  return {
    query: async (text, params) =>
      (await sql.query(text, params ?? [])) as unknown as Record<string, unknown>[],
  };
}
