import { parseArgs } from "node:util";
import { requireKey } from "@dispatch/core";
import { z } from "zod";
import { DEFAULT_MODEL, SPEECHIFY_BASE_URL } from "../audio/speechify.js";
import { type CommandRun, redact, secretsFromEnv } from "../context.js";

const USAGE = "Usage: dispatch voices [--locale <prefix>] [--limit <n>] [--json]";
const DEFAULT_LOCALE = "en";
const DEFAULT_LIMIT = 40;
const TIMEOUT_MS = 20_000;
const MAX_PAGES = 20;

const Voice = z
  .object({
    id: z.string(),
    display_name: z.string().optional(),
    gender: z.string().optional(),
    locale: z.string().optional(),
    models: z
      .array(
        z
          .object({ languages: z.array(z.object({ locale: z.string() }).loose()).optional() })
          .loose(),
      )
      .optional(),
  })
  .loose();

export interface VoiceRow {
  id: string;
  name: string | null;
  gender: string | null;
  locales: string[];
}

/** The reply is an array, or an object holding one under `voices` or `data`. */
function voiceList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (typeof body === "object" && body !== null) {
    const inner = (body as { voices?: unknown }).voices ?? (body as { data?: unknown }).data;
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

/** Pure part of the command, so a test can feed it a recorded reply. */
export function listVoices(body: unknown, localePrefix: string): VoiceRow[] {
  const prefix = localePrefix.toLowerCase();
  return voiceList(body)
    .flatMap((raw) => {
      const parsed = Voice.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    })
    .map((voice) => {
      const locales = new Set<string>();
      if (voice.locale) locales.add(voice.locale);
      for (const model of voice.models ?? [])
        for (const language of model.languages ?? []) locales.add(language.locale);
      return {
        id: voice.id,
        name: voice.display_name ?? null,
        gender: voice.gender ?? null,
        locales: [...locales].sort(),
      };
    })
    .filter((row) => row.locales.some((locale) => locale.toLowerCase().startsWith(prefix)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** `dispatch voices`: the Speechify voices your key can use, to choose SPEECHIFY_VOICE_ID. */
export function makeVoicesCommand(fetchImpl: typeof fetch = fetch): CommandRun {
  return async (argv, ctx) => {
    let values: { locale?: string | undefined; limit?: string | undefined };
    try {
      values = parseArgs({
        args: argv,
        allowPositionals: false,
        strict: true,
        options: { locale: { type: "string" }, limit: { type: "string" } },
      }).values;
    } catch (error) {
      ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
      return 2;
    }
    const limit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      ctx.log.error(`--limit needs a whole number of at least 1. ${USAGE}`);
      return 2;
    }

    const secrets = secretsFromEnv(ctx.env);
    try {
      const key = requireKey(ctx.env, "SPEECHIFY_API_KEY");
      const locale = values.locale ?? DEFAULT_LOCALE;
      // The catalogue is paged (50 by default, 200 at most); only voices that speak the engine's model.
      const bodies: unknown[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ limit: "200", model: DEFAULT_MODEL });
        if (locale !== "") query.set("locale", locale);
        if (cursor) query.set("cursor", cursor);
        const response = await fetchImpl(`${SPEECHIFY_BASE_URL}/v1/voices?${query}`, {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) {
          ctx.log.error(`Speechify answered HTTP ${response.status} for /v1/voices.`);
          return 1;
        }
        const body: unknown = await response.json();
        bodies.push(body);
        const { has_more: hasMore, next_cursor: next } = (body ?? {}) as {
          has_more?: unknown;
          next_cursor?: unknown;
        };
        cursor = hasMore === true && typeof next === "string" && next !== "" ? next : undefined;
        if (cursor === undefined) break;
      }
      const all = bodies.flatMap((body) => listVoices(body, locale));
      const shown = all.slice(0, limit);
      if (ctx.json) {
        process.stdout.write(
          `${JSON.stringify({ total: all.length, shown: shown.length, truncated: all.length > shown.length, voices: shown })}\n`,
        );
      } else {
        const lines = shown.map((voice) =>
          `${voice.id}  ${voice.name ?? ""}  ${voice.gender ?? ""}  ${voice.locales.join(",")}`.trimEnd(),
        );
        if (all.length > shown.length) {
          lines.push(`... ${all.length - shown.length} more; raise --limit or narrow --locale`);
        }
        lines.push(
          "",
          "Set the chosen id as SPEECHIFY_VOICE_ID in .env, then run `npm run secrets:push`.",
        );
        process.stdout.write(`${lines.join("\n")}\n`);
      }
      return 0;
    } catch (error) {
      ctx.log.error(
        redact(
          error instanceof Error
            ? (error.message.split("\n")[0] ?? "request failed")
            : "request failed",
          secrets,
        ),
      );
      return 1;
    }
  };
}

export const run: CommandRun = makeVoicesCommand();
