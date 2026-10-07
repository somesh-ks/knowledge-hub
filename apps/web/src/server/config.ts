/**
 * The environment the API routes need. All are Vercel environment variables. Generate and status use
 * the first three; narrate uses the passphrase hash and everything below it.
 */
export interface ServerEnv {
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  GENERATE_PASSPHRASE_HASH?: string;
  SPEECHIFY_API_KEY?: string;
  SPEECHIFY_VOICE_ID?: string;
  SPEECHIFY_MONTHLY_CHARS?: string;
  /** The Blob store's long-lived token. Vercel injects it when the store is connected that way. */
  BLOB_READ_WRITE_TOKEN?: string;
  /** With VERCEL_OIDC_TOKEN, the credentials of a store connected through OIDC (D26). */
  BLOB_STORE_ID?: string;
  VERCEL_OIDC_TOKEN?: string;
}

export interface ServerConfig {
  token: string;
  owner: string;
  repo: string;
  /** "owner/repo", as configured. */
  repository: string;
  passphraseHash: string;
}

const REPOSITORY = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

/** Returns null when anything is missing or malformed, so a half-configured site answers "unavailable". */
export function readServerConfig(env: ServerEnv): ServerConfig | null {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  const passphraseHash = env.GENERATE_PASSPHRASE_HASH?.trim();
  const match = REPOSITORY.exec(env.GITHUB_REPOSITORY?.trim() ?? "");
  if (!token || !passphraseHash || !match?.[1] || !match[2]) return null;
  return {
    token,
    owner: match[1],
    repo: match[2],
    repository: `${match[1]}/${match[2]}`,
    passphraseHash,
  };
}

/** What the log redactor must never let through. */
export function secretsOf(config: ServerConfig | null): string[] {
  return config ? [config.token, config.passphraseHash] : [];
}

/**
 * How the function proves itself to Vercel Blob: the store's long-lived token, or the short-lived
 * OIDC token Vercel issues together with the store id.
 */
export type BlobCredentials = { token: string } | { oidcToken: string; storeId: string };

export interface NarrateConfig {
  blob: BlobCredentials;
  passphraseHash: string;
  speechifyKey: string;
  /** Unset means the engine's default voice. */
  voiceId?: string;
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

/** Returns null when anything is missing or malformed, so a half-configured site answers "unavailable". */
export function readNarrateConfig(
  env: ServerEnv,
  requestOidcToken?: () => string | null,
): NarrateConfig | null {
  const passphraseHash = env.GENERATE_PASSPHRASE_HASH?.trim();
  const speechifyKey = credential(env.SPEECHIFY_API_KEY);
  if (!passphraseHash || !speechifyKey) return null;

  // The two optional settings may be absent, but a value that is present has to be usable.
  const voiceId = env.SPEECHIFY_VOICE_ID?.trim();
  if (voiceId && !VOICE_ID.test(voiceId)) return null;
  const monthlyChars = env.SPEECHIFY_MONTHLY_CHARS?.trim();
  if (monthlyChars && !MONTHLY_CHARS.test(monthlyChars)) return null;

  const blob = readBlobCredentials(env, requestOidcToken);
  if (!blob) return null;
  return {
    blob,
    passphraseHash,
    speechifyKey,
    ...(voiceId ? { voiceId } : {}),
    ...(monthlyChars ? { monthlyChars: Number(monthlyChars) } : {}),
  };
}

export function blobSecretsOf(credentials: BlobCredentials | null): string[] {
  if (!credentials) return [];
  return "token" in credentials ? [credentials.token] : [credentials.oidcToken];
}

/** What the log redactor must never let through for the narrate route. */
export function narrateSecretsOf(config: NarrateConfig | null): string[] {
  return config ? [config.speechifyKey, config.passphraseHash, ...blobSecretsOf(config.blob)] : [];
}
