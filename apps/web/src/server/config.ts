/** The environment the two API routes need. All three are Vercel environment variables. */
export interface ServerEnv {
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  GENERATE_PASSPHRASE_HASH?: string;
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
