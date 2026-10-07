/**
 * Removes secrets from text before it is logged. Two layers: the exact secret values the function
 * was given, and the shapes its tokens take (GitHub, the Vercel Blob read-write token, and the JWT
 * that Vercel OIDC issues), in case a value reaches a message another way.
 */
const TOKEN_SHAPES = [
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bvercel_blob_rw_[A-Za-z0-9_]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];
const HASH_SHAPE = /\bscrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+/g;
const REDACTED = "[redacted]";

export function redact(text: string, secrets: ReadonlyArray<string | undefined> = []): string {
  let output = text;
  for (const secret of secrets) {
    // A short value would blank out ordinary words, so only values long enough to be secrets count.
    if (secret && secret.length >= 8) output = output.split(secret).join(REDACTED);
  }
  for (const shape of [...TOKEN_SHAPES, HASH_SHAPE]) output = output.replace(shape, REDACTED);
  return output;
}

/** An error message safe to log. The stack is dropped: it can carry request details. */
export function describeError(error: unknown, secrets: ReadonlyArray<string | undefined>): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redact(message, secrets);
}
