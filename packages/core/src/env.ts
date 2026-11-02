import { z } from "zod";

/** Environment variables the engine reads. Everything is optional; commands check what they need. */
const optionalString = z.string().min(1).optional();

export const Env = z.object({
  TYPESAFE_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  EXA_API_KEY: optionalString,
  FIRECRAWL_API_KEY: optionalString,
  SPEECHIFY_API_KEY: optionalString,
  SPEECHIFY_VOICE_ID: z.string().default("geffen_32"),
  /** The second host's voice; `publish` narrates new episodes in it as the site would. */
  SPEECHIFY_VOICE_ID_B: optionalString,
  BLOB_READ_WRITE_TOKEN: optionalString,
  // The private store that holds the config snapshots (D300); the content store is public.
  BLOB_PRIVATE_READ_WRITE_TOKEN: optionalString,
  /** Short-lived Blob credentials from `vercel env pull`; used when no long-lived token is set. */
  VERCEL_OIDC_TOKEN: optionalString,
  BLOB_STORE_ID: optionalString,
  /** Account token the audio workflow uses to run `vercel link` and `vercel env pull`. */
  VERCEL_TOKEN: optionalString,
  /** The token the site dispatches workflows and writes the RUN_CRON variable with (D259). */
  GITHUB_SINGULARITY_TOKEN: optionalString,
  /** The old name of that token, still honoured. */
  GITHUB_DISPATCH_TOKEN: optionalString,
  /** "owner/repo"; `doctor --online` checks the site's token against it. */
  GITHUB_REPOSITORY: optionalString,
  /** Gemini API key: transcribes a YouTube finalist that has no subtitles. */
  GEMINI_API_KEY: optionalString,
  /** Neon Postgres holding the owner's config (D149). Unset, the committed files are the config. */
  DATABASE_URL: optionalString,
  /** "postgres" switches the config store on (D149); the URL alone never does. */
  SINGULARITY_CONFIG_STORE: optionalString,
  DISPATCH_CONFIG_STORE: optionalString,
  MAX_TOKENS_PER_RUN: z.coerce.number().int().positive().default(400_000),
  /** Monthly Speechify character allowance used by the 90 percent budget guard. */
  SPEECHIFY_MONTHLY_CHARS: z.coerce.number().int().positive().default(500_000),
});
export type Env = z.infer<typeof Env>;

/** What `vercel env pull` writes in place of a hidden secret it cannot read. */
const VERCEL_PLACEHOLDER = "[SENSITIVE]";

/** Parse the process environment. Empty strings and Vercel's pull placeholder count as unset. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const merged = {
    ...source,
    SINGULARITY_CONFIG_STORE: source.SINGULARITY_CONFIG_STORE ?? source.DISPATCH_CONFIG_STORE,
  };
  const cleaned = Object.fromEntries(
    Object.entries(merged).filter(
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
