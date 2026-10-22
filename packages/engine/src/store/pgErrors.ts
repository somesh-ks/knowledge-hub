/** The Postgres error codes the stores that create their own table on first use act on. */

const errorCode = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

/** The table is not there yet (42P01): create it and try once more. */
export const missingTable = (error: unknown): boolean => errorCode(error) === "42P01";

/** What Postgres answers the loser of two `create ... if not exists` racing: a duplicate. */
const DUPLICATE = new Set(["23505", "42P07"]);

/** Whether `error` is the duplicate a lost `create ... if not exists` race answers. */
export const lostCreateRace = (error: unknown): boolean => DUPLICATE.has(String(errorCode(error)));
