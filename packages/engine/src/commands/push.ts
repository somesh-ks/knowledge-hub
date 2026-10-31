import { parseArgs } from "node:util";
import type { CommandRun } from "../context.js";
import { describeError } from "../llm/errors.js";
import { connectConfigStore, databaseSecrets, type SqlClient } from "../store/configPaths.js";
import {
  deletePushWatches,
  type EndedWatch,
  endedPushWatches,
  isPushEndpoint,
  type PushTarget,
  sweepPushWatches,
} from "../store/pushStore.js";

const USAGE = "Usage: singularity push notify";

/** What the service worker shows (apps/web/public/sw.js reads these three keys). */
export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap goes, on the site. */
  url: string;
}

/** A tap opens the episode that was made, or the library when the run left no id to open. */
export function messageFor(watch: EndedWatch): PushMessage {
  const what = watch.kind === "regenerate" ? "Your new take" : "Your Catch up";
  if (watch.outcome === "failed") {
    return { title: `${what} didn't finish`, body: "Tap to try again.", url: "/library" };
  }
  const id = watch.podcast;
  const url = id?.startsWith("ep-") ? `/e/${id}` : id ? `/d/${id}` : "/library";
  return { title: `${what} is ready`, body: "Tap to listen.", url };
}

/** The push service's word on a send. Gone means the browser dropped the subscription for good. */
export type SendResult = "sent" | "gone" | "failed";

export type PushSender = (target: PushTarget, message: PushMessage) => Promise<SendResult>;

export interface PushDeps {
  connect?: (databaseUrl: string) => Promise<SqlClient>;
  /** Replaces the web-push call, for the tests. */
  send?: PushSender;
}

/** One hour: a message that cannot be delivered in an hour is about an episode the person has long found. */
const TTL_SECONDS = 3600;

async function webPushSender(vapid: {
  subject: string;
  publicKey: string;
  privateKey: string;
}): Promise<PushSender> {
  const webpush = (await import("web-push")).default;
  return async (target, message) => {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        { TTL: TTL_SECONDS, urgency: "normal", vapidDetails: vapid, timeout: 10_000 },
      );
      return "sent";
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? "gone" : "failed";
    }
  };
}

/**
 * `singularity push notify` (D284): content.yml's step after the sync. Sends one message to each
 * browser whose watched run has ended, then deletes what was sent, what is gone and what is stale.
 * It never fails the workflow it follows: not configured, no database, or a push service down are
 * warnings and exit 0, and a message that did not go out stays for the next sync to try (its
 * watch lives six hours).
 */
export function makePushCommand(deps: PushDeps = {}): CommandRun {
  return async (argv, ctx) => {
    let positionals: string[];
    try {
      positionals = parseArgs({
        args: argv,
        allowPositionals: true,
        strict: true,
        options: {},
      }).positionals;
    } catch (error) {
      ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
      return 2;
    }
    if (positionals.length !== 1 || positionals[0] !== "notify") {
      ctx.log.error(USAGE);
      return 2;
    }
    const { DATABASE_URL: databaseUrl, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = ctx.env;
    if (!databaseUrl || (!deps.send && (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY))) {
      ctx.log.warn("Push is not set up (DATABASE_URL and the VAPID keys): nothing was sent");
      return 0;
    }
    try {
      const sql = await (deps.connect ?? connectConfigStore)(databaseUrl);
      const ended = await endedPushWatches(sql);
      const send =
        deps.send ??
        (await webPushSender({
          subject: ctx.env.VAPID_SUBJECT ?? "https://news.someshks.work",
          publicKey: VAPID_PUBLIC_KEY ?? "",
          privateKey: VAPID_PRIVATE_KEY ?? "",
        }));
      const done: EndedWatch[] = [];
      let sent = 0;
      let failed = 0;
      for (const watch of ended) {
        // A row the site would not have stored: drop it unsent.
        const result = isPushEndpoint(watch.endpoint)
          ? await send(watch, messageFor(watch))
          : "gone";
        if (result === "failed") failed += 1;
        else done.push(watch);
        if (result === "sent") sent += 1;
      }
      await deletePushWatches(sql, done);
      const swept = await sweepPushWatches(sql, ctx.now().getTime());
      const line = `Push: ${sent} sent, ${failed} to retry, ${done.length - sent} dropped, ${swept} swept.`;
      process.stdout.write(`${ctx.json ? JSON.stringify({ sent, retry: failed, swept }) : line}\n`);
    } catch (error) {
      let reason = describeError(error, []);
      for (const secret of databaseSecrets(databaseUrl))
        reason = reason.split(secret).join("[redacted]");
      if (VAPID_PRIVATE_KEY) reason = reason.split(VAPID_PRIVATE_KEY).join("[redacted]");
      ctx.log.warn("Push was not sent", { reason });
    }
    return 0;
  };
}

export const run: CommandRun = makePushCommand();
