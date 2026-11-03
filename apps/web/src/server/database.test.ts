import { describe, expect, it } from "vitest";
import { telemetryDatabaseUrl } from "./database";

// A test run's server and a session's dev server hold the production DATABASE_URL and wrote their
// 5xx answers into the production fault table: 176 builds a day, seven routes flagged at once.
describe("telemetryDatabaseUrl", () => {
  const URL = "postgres://prod";

  it("gives the database to a server running on Vercel", () => {
    expect(telemetryDatabaseUrl({ VERCEL: "1", DATABASE_URL: URL })).toBe(URL);
  });

  it("gives nothing to a server anywhere else, whatever URL its environment holds", () => {
    expect(telemetryDatabaseUrl({ DATABASE_URL: URL })).toBeUndefined();
    expect(telemetryDatabaseUrl({ VERCEL: "", DATABASE_URL: URL })).toBeUndefined();
  });
});
