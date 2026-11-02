import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { CommandContext } from "../context.js";
import {
  CONFIG_SCHEMA_SQL,
  configStoreUrl,
  connectConfigStore,
  readConfigDocuments,
  type SqlClient,
} from "../store/configDocs.js";
import {
  buildSnapshot,
  createSqlSnapshotStore,
  parseSnapshot,
  restoreDocuments,
  SNAPSHOT_SCHEMA_SQL,
  type SnapshotStore,
  serializeSnapshot,
  snapshotKeysNewestFirst,
  takeSnapshot,
} from "../store/configSnapshot.js";

export interface SnapshotDeps {
  connectConfigStore?: (databaseUrl: string) => Promise<SqlClient>;
  /** The snapshot store; tests pass a fake. Default: the config_snapshots table. */
  snapshotStore?: SnapshotStore;
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function storeFor(sql: SqlClient, deps: SnapshotDeps): SnapshotStore {
  return deps.snapshotStore ?? createSqlSnapshotStore(sql);
}

/**
 * `config snapshot [--out <file>] [--keep <n>]`: copy every stored document into one JSON file,
 * either in the config_snapshots table (the weekly job, snapshot.yml) or, with --out, on this machine.
 */
export async function runSnapshot(
  argv: string[],
  ctx: CommandContext,
  deps: SnapshotDeps,
): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { out: { type: "string" }, keep: { type: "string" } },
    strict: true,
  });
  const url = configStoreUrl(ctx.env);
  if (url === null) {
    ctx.log.error("The config store is off (DATABASE_URL and SINGULARITY_CONFIG_STORE=postgres).");
    return 1;
  }
  const sql = await (deps.connectConfigStore ?? connectConfigStore)(url);
  if (values.out !== undefined) {
    const documents = await readConfigDocuments(sql);
    if (documents.length === 0) {
      ctx.log.error("The config store holds no documents to snapshot.");
      return 1;
    }
    await writeFile(values.out, serializeSnapshot(buildSnapshot(documents, ctx.now())), "utf8");
    print(`wrote ${documents.length} documents to ${values.out}`);
    return 0;
  }
  const store = storeFor(sql, deps);
  const keep = values.keep === undefined ? undefined : Number(values.keep);
  if (keep !== undefined && (!Number.isInteger(keep) || keep < 1)) {
    ctx.log.error("--keep must be a whole number of 1 or more.");
    return 2;
  }
  const result = await takeSnapshot({
    sql,
    store,
    now: ctx.now(),
    ...(keep !== undefined ? { keep } : {}),
  });
  print(
    ctx.json
      ? JSON.stringify({ ok: true, ...result })
      : `snapshot ${result.key}: ${result.documents} documents${result.pruned.length > 0 ? `; dropped ${result.pruned.join(", ")}` : ""}`,
  );
  return 0;
}

/**
 * `config restore (--file <path> | --latest) --force`: write a snapshot's documents back into the
 * store as new versions, creating the table if the database is new. A restore overwrites newer edits,
 * so --force is always required.
 */
export async function runRestore(
  argv: string[],
  ctx: CommandContext,
  deps: SnapshotDeps,
): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      file: { type: "string" },
      latest: { type: "boolean" },
      force: { type: "boolean" },
    },
    strict: true,
  });
  if ((values.file === undefined) === (values.latest !== true)) {
    ctx.log.error("Pass --file <path> or --latest, one of them.");
    return 2;
  }
  if (values.force !== true) {
    ctx.log.error(
      "A restore overwrites every stored document that differs from the snapshot, newer edits included. Pass --force if you are sure.",
    );
    return 1;
  }
  const url = configStoreUrl(ctx.env);
  if (url === null) {
    ctx.log.error("The config store is off (DATABASE_URL and SINGULARITY_CONFIG_STORE=postgres).");
    return 1;
  }
  const sql = await (deps.connectConfigStore ?? connectConfigStore)(url);
  await sql.query(CONFIG_SCHEMA_SQL);
  let text: string;
  if (values.file !== undefined) {
    text = await readFile(values.file, "utf8");
  } else {
    await sql.query(SNAPSHOT_SCHEMA_SQL);
    const store = storeFor(sql, deps);
    const newest = snapshotKeysNewestFirst(await store.keys())[0];
    const body = newest === undefined ? null : await store.read(newest);
    if (body === null) {
      ctx.log.error("The config_snapshots table holds no snapshot.");
      return 1;
    }
    text = body;
  }
  const snapshot = parseSnapshot(text);
  const written = await restoreDocuments(sql, snapshot);
  print(
    ctx.json
      ? JSON.stringify({ ok: true, taken_at: snapshot.taken_at, written })
      : `restored the snapshot of ${snapshot.taken_at || "an unknown time"}: ${written.length === 0 ? "nothing differed" : written.join(", ")}`,
  );
  return 0;
}
