import type { SqlClient } from "./configPaths.js";

/** The Postgres error codes the stores that create their own table on first use act on. */

const errorCode = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

/** The table is not there yet (42P01): create it and try once more. */
export const missingTable = (error: unknown): boolean => errorCode(error) === "42P01";

/** What Postgres answers the loser of two `create ... if not exists` racing: a duplicate. */
const DUPLICATE = new Set(["23505", "42P07"]);

/** Whether `error` is the duplicate a lost `create ... if not exists` race answers. */
export const lostCreateRace = (error: unknown): boolean => DUPLICATE.has(String(errorCode(error)));

/**
 * Runs `write`, and when the table is not there yet creates it (`schema`, each statement `if not
 * exists`) and runs it once more. Two first writes at once can race to create it, and Postgres then
 * refuses one with a duplicate; the write after says whether the table is there.
 */
export async function withTable<T>(
  sql: SqlClient,
  schema: readonly string[],
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!missingTable(error)) throw error;
    for (const statement of schema) {
      await sql.query(statement).catch((raced: unknown) => {
        if (!lostCreateRace(raced)) throw raced;
      });
    }
    return write();
  }
}
