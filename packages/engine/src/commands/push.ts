import { parseArgs } from "node:util";
import type { CommandRun } from "../context.js";
import { describeError } from "../llm/errors.js";
import { connectConfigStore, databaseSecrets, type SqlClient } from "../store/configPaths.js";
import {
  claimNewScheduledRuns,
  deletePushWatches,
  devicesFor,
  type EndedWatch,
  endedPushWatches,
  isPushEndpoint,
  type NewScheduledRun,
  type PushTarget,
  readPushKeys,
  removePushDevice,
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

/** The Daily and the Weekly: a tap opens the podcast. */
export function scheduledMessage(run: NewScheduledRun): PushMessage {
  return {
    title: run.kind === "weekly" ? "Your Weekly is ready" : "Your Daily is ready",
    body: "Tap to listen.",
    url: run.podcast ? `/d/${run.podcast}` : "/library",
  };
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

/** Who the push services see as the sender: a contact for the site's operator. */
const VAPID_SUBJECT = "https://news.someshks.work";

async function webPushSender(keys: { publicKey: string; privateKey: string }): Promise<PushSender> {
  const webpush = (await import("web-push")).default;
  const vapidDetails = { subject: VAPID_SUBJECT, ...keys };
  return async (target, message) => {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        { TTL: TTL_SECONDS, urgency: "normal", vapidDetails, timeout: 10_000 },
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
    const databaseUrl = ctx.env.DATABASE_URL;
    if (!databaseUrl) {
      ctx.log.warn("DATABASE_URL is not set: nothing was sent");
      return 0;
    }
    let privateKey = "";
    try {
      const sql = await (deps.connect ?? connectConfigStore)(databaseUrl);
      const now = ctx.now().getTime();
      const ended = await endedPushWatches(sql);
      const scheduled = await claimNewScheduledRuns(sql, now);
      let send = deps.send;
      if (!send && ended.length + scheduled.length > 0) {
        // The site makes the pair when the first browser asks for the public key; none yet means
        // no browser has switched notifications on, so there is nothing to send.
        const keys = await readPushKeys(sql);
        if (keys) {
          privateKey = keys.privateKey;
          send = await webPushSender(keys);
        }
      }
      const done: EndedWatch[] = [];
      let sent = 0;
      let failed = 0;
      if (send) {
        for (const watch of ended) {
          // A row the site would not have stored: drop it unsent.
          const result = isPushEndpoint(watch.endpoint)
            ? await send(watch, messageFor(watch))
            : "gone";
          if (result === "failed") failed += 1;
          else done.push(watch);
          if (result === "sent") sent += 1;
        }
        // A scheduled run is announced once (it was claimed above): a device that is down misses it.
        for (const run of scheduled) {
          for (const device of await devicesFor(sql, run.kind)) {
            const result = isPushEndpoint(device.endpoint)
              ? await send(device, scheduledMessage(run))
              : "gone";
            if (result === "sent") sent += 1;
            else if (result === "gone") await removePushDevice(sql, device.endpoint);
            else failed += 1;
          }
        }
      }
      await deletePushWatches(sql, done);
      const swept = await sweepPushWatches(sql, now);
      const line = `Push: ${sent} sent, ${failed} to retry, ${Math.max(0, done.length - sent)} dropped, ${swept} swept.`;
      process.stdout.write(`${ctx.json ? JSON.stringify({ sent, retry: failed, swept }) : line}\n`);
    } catch (error) {
      let reason = describeError(error, []);
      for (const secret of databaseSecrets(databaseUrl))
        reason = reason.split(secret).join("[redacted]");
      if (privateKey) reason = reason.split(privateKey).join("[redacted]");
      ctx.log.warn("Push was not sent", { reason });
    }
    return 0;
  };
}

export const run: CommandRun = makePushCommand();
