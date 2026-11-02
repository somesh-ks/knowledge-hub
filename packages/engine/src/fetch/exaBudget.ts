/**
 * Exa searches all runs together may make in any 7 days before the runs stop searching: a safety
 * stop, not the working budget (D339). A normal week is about 240 (the daily asks one search per
 * query in config/queries.json), 1.2 USD; this is about three times that, 3.5 USD. Read from the
 * cost ledger at the start of each stage (`run/spend.ts`), like Firecrawl's (D222).
 */
export const EXA_WEEKLY_BUDGET = 700;

/** Health warns once the week passes this: time to look, not to stop. */
export const EXA_WEEKLY_ALERT = 450;

/** Why the Exa source did nothing when the week's budget is spent. */
export const EXA_SKIP_WEEKLY = "Exa's weekly budget is spent";
