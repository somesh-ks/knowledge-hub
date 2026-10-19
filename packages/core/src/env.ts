import { z } from "zod";

/** Environment variables the engine reads. Everything is optional; commands check what they need. */
const optionalString = z.string().min(1).optional();

export const Env = z.object({
  TYPESAFE_API_KEY: optionalString,
  NEBIUS_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  NEBIUS_BASE_URL: z.string().url().default("https://api.tokenfactory.nebius.com/v1/"),
  DISPATCH_MODEL: optionalString,
  DISPATCH_FALLBACK_MODEL: optionalString,
  EXA_API_KEY: optionalString,
  FIRECRAWL_API_KEY: optionalString,
  SPEECHIFY_API_KEY: optionalString,
  SPEECHIFY_VOICE_ID: z.string().default("geffen_32"),
  BLOB_READ_WRITE_TOKEN: optionalString,
  /** Short-lived Blob credentials from `vercel env pull`; used when no long-lived token is set. */
  VERCEL_OIDC_TOKEN: optionalString,
  BLOB_STORE_ID: optionalString,
  /** Account token the audio workflow uses to run `vercel link` and `vercel env pull`. */
  VERCEL_TOKEN: optionalString,
  COMPOSIO_API_KEY: optionalString,
  /** Gemini API key: transcribes a YouTube finalist that has no subtitles. */
  GEMINI_API_KEY: optionalString,
  /** Gemini model for those transcriptions; the engine has a default. */
  GEMINI_TRANSCRIBE_MODEL: optionalString,
  MAX_TOKENS_PER_RUN: z.coerce.number().int().positive().default(400_000),
  /** Monthly Speechify character allowance used by the 90 percent budget guard. */
  SPEECHIFY_MONTHLY_CHARS: z.coerce.number().int().positive().default(500_000),
});
export type Env = z.infer<typeof Env>;

/** What `vercel env pull` writes in place of a hidden secret it cannot read. */
const VERCEL_PLACEHOLDER = "[SENSITIVE]";

/** Parse the process environment. Empty strings and Vercel's pull placeholder count as unset. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(
      ([, value]) => value !== undefined && value !== "" && value !== VERCEL_PLACEHOLDER,
    ),
  );
  return Env.parse(cleaned);
}

/** Fail with a clear message naming the variable, never its value. */
export function requireKey<K extends keyof Env>(env: Env, key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null) {
    throw new Error(`${String(key)} is not set. Add it to .env (see .env.example).`);
  }
  return value as NonNullable<Env[K]>;
}
