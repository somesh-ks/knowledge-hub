import { DEFAULT_SECOND_VOICE } from "@dispatch/engine/segments";

/**
 * The environment the API routes need. All are Vercel environment variables. Generate and status use
 * the GitHub token and repository; narrate uses everything from the Speechify key down.
 */
export interface ServerEnv {
  /** Neon Postgres (D149); the config store is used only with DISPATCH_CONFIG_STORE=postgres too. */
  DATABASE_URL?: string;
  DISPATCH_CONFIG_STORE?: string;
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  SPEECHIFY_API_KEY?: string;
  SPEECHIFY_VOICE_ID?: string;
  /** The second host of a two-voice episode. Blank means the first voice reads both. */
  SPEECHIFY_VOICE_ID_B?: string;
  SPEECHIFY_MONTHLY_CHARS?: string;
  /** The Blob store's long-lived token. Vercel injects it when the store is connected that way. */
  BLOB_READ_WRITE_TOKEN?: string;
  /** With VERCEL_OIDC_TOKEN, the credentials of a store connected through OIDC (D26). */
  BLOB_STORE_ID?: string;
  VERCEL_OIDC_TOKEN?: string;
  /** Only /api/models reads these three, to list the models the Model picker offers. */
  ANTHROPIC_API_KEY?: string;
  /** What Vercel Cron sends as a bearer token to /api/cron/run. Unset, the route refuses every call. */
  CRON_SECRET?: string;
  /** Signs share link tokens (D153). Unset, the share routes and the listen page say "not set up". */
  SHARE_SECRET?: string;
}

export interface ServerConfig {
  token: string;
  owner: string;
  repo: string;
  /** "owner/repo", as configured. */
  repository: string;
}

const REPOSITORY = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

/** Returns null when anything is missing or malformed, so a half-configured site answers "unavailable". */
export function readServerConfig(env: ServerEnv): ServerConfig | null {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  const match = REPOSITORY.exec(env.GITHUB_REPOSITORY?.trim() ?? "");
  if (!token || !match?.[1] || !match[2]) return null;
  return {
    token,
    owner: match[1],
    repo: match[2],
    repository: `${match[1]}/${match[2]}`,
  };
}

/**
 * The settings readServerConfig needs that the deployment lacks or has malformed, by name only, so a
 * log line can say which one to fix without printing a value.
 */
export function missingSettings(env: ServerEnv): string[] {
  return [
    ...(env.GITHUB_DISPATCH_TOKEN?.trim() ? [] : ["GITHUB_DISPATCH_TOKEN"]),
    ...(REPOSITORY.exec(env.GITHUB_REPOSITORY?.trim() ?? "") ? [] : ["GITHUB_REPOSITORY"]),
  ];
}

/** What the log redactor must never let through. */
export function secretsOf(config: ServerConfig | null): string[] {
  return config ? [config.token] : [];
}

/**
 * How the function proves itself to Vercel Blob: the store's long-lived token, or the short-lived
 * OIDC token Vercel issues together with the store id.
 */
export type BlobCredentials = { token: string } | { oidcToken: string; storeId: string };

export interface NarrateConfig {
  blob: BlobCredentials;
  speechifyKey: string;
  /** Unset means the engine's default voice. */
  voiceId?: string;
  /** The second host's voice. Unset means the first voice reads every turn. */
  voiceIdB?: string;
  /** Unset means the engine's default monthly allowance. */
  monthlyChars?: number;
}

/** What `vercel env pull` writes in place of a hidden value. It is never a real credential. */
const SENSITIVE_PLACEHOLDER = "[SENSITIVE]";
const STORE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MONTHLY_CHARS = /^[1-9]\d{0,11}$/;

function credential(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== SENSITIVE_PLACEHOLDER ? trimmed : undefined;
}

/**
 * The read-write token wins when it is set (D26). Otherwise the store id with an OIDC token, which a
 * deployed function receives per request in a header rather than in its environment, so the route
 * passes a way to read that header. It is only called when nothing else is configured.
 */
export function readBlobCredentials(
  env: ServerEnv,
  requestOidcToken?: () => string | null,
): BlobCredentials | null {
  const token = credential(env.BLOB_READ_WRITE_TOKEN);
  if (token) return { token };
  const storeId = credential(env.BLOB_STORE_ID);
  if (!storeId || !STORE_ID.test(storeId)) return null;
  const oidcToken = credential(env.VERCEL_OIDC_TOKEN) ?? credential(requestOidcToken?.());
  return oidcToken ? { oidcToken, storeId } : null;
}

/**
 * The voice's pace, for estimating how long a segment will be before it is narrated. Measured from
 * the two narrations committed so far with the default voice (61.7 and 62.4 ms per character).
 * The page uses it only to lay out a timeline; real durations replace it as segments arrive.
 */
export const MS_PER_CHARACTER = 62;

/**
 * SPEECHIFY_VOICE_ID: the voice, undefined when it is unset (the engine's default applies), or null
 * when it is set to something unusable. The lookup needs it without the secrets, because a segment's
 * file is keyed by its text and the voice that read it.
 */
export function readVoiceId(env: ServerEnv): string | undefined | null {
  const voiceId = env.SPEECHIFY_VOICE_ID?.trim();
  if (!voiceId) return undefined;
  return VOICE_ID.test(voiceId) ? voiceId : null;
}

/** The second host's voice when SPEECHIFY_VOICE_ID_B is not set at all; the engine uses it too. */
export { DEFAULT_SECOND_VOICE };

/** The environment a narration route reads, with the second voice filled in when nothing sets it. */
export function withSecondVoice<T extends ServerEnv>(env: T): T {
  return env.SPEECHIFY_VOICE_ID_B === undefined
    ? { ...env, SPEECHIFY_VOICE_ID_B: DEFAULT_SECOND_VOICE }
    : env;
}

/**
 * SPEECHIFY_VOICE_ID_B: the second host's voice, undefined when it is unset (the first voice reads
 * both hosts), or null when it is set to something unusable.
 */
export function readVoiceIdB(env: ServerEnv): string | undefined | null {
  const voiceId = env.SPEECHIFY_VOICE_ID_B?.trim();
  if (!voiceId) return undefined;
  return VOICE_ID.test(voiceId) ? voiceId : null;
}

const STORE_NAME = /^[A-Za-z0-9]{8,64}$/;

/**
 * The public address of the Blob store, worked out from configuration alone, or null when it cannot
 * be. The store's name is the fourth part of a read-write token ("vercel_blob_rw_<name>_<secret>")
 * and the store id without its "store_" prefix, and it is not a secret: it is in every audio URL the
 * page plays. The lookup uses this to say where a segment's file would be without asking the store.
 */
export function readPublicBlobBase(env: ServerEnv): string | null {
  const token = credential(env.BLOB_READ_WRITE_TOKEN);
  const fromToken = token?.startsWith("vercel_blob_rw_") ? token.split("_")[3] : undefined;
  const fromId = credential(env.BLOB_STORE_ID)?.replace(/^store_/, "");
  const name = fromToken || fromId;
  if (!name || !STORE_NAME.test(name)) return null;
  return `https://${name.toLowerCase()}.public.blob.vercel-storage.com`;
}

/** Returns null when anything is missing or malformed, so a half-configured site answers "unavailable". */
export function readNarrateConfig(
  env: ServerEnv,
  requestOidcToken?: () => string | null,
): NarrateConfig | null {
  const speechifyKey = credential(env.SPEECHIFY_API_KEY);
  if (!speechifyKey) return null;

  // The two optional settings may be absent, but a value that is present has to be usable.
  const voiceId = readVoiceId(env);
  if (voiceId === null) return null;
  const voiceIdB = readVoiceIdB(env);
  if (voiceIdB === null) return null;
  const monthlyChars = env.SPEECHIFY_MONTHLY_CHARS?.trim();
  if (monthlyChars && !MONTHLY_CHARS.test(monthlyChars)) return null;

  const blob = readBlobCredentials(env, requestOidcToken);
  if (!blob) return null;
  return {
    blob,
    speechifyKey,
    ...(voiceId ? { voiceId } : {}),
    ...(voiceIdB ? { voiceIdB } : {}),
    ...(monthlyChars ? { monthlyChars: Number(monthlyChars) } : {}),
  };
}

export function blobSecretsOf(credentials: BlobCredentials | null): string[] {
  if (!credentials) return [];
  return "token" in credentials ? [credentials.token] : [credentials.oidcToken];
}

/** What the log redactor must never let through for the narrate route. */
export function narrateSecretsOf(config: NarrateConfig | null): string[] {
  return config ? [config.speechifyKey, ...blobSecretsOf(config.blob)] : [];
}
