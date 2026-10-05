/** True for http and https URLs. Every other scheme (javascript:, file:, data:, ftp:) is refused. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const PRIVATE_IPV4: ReadonlyArray<(a: number, b: number) => boolean> = [
  (a) => a === 0 || a === 10 || a === 127,
  (a, b) => a === 169 && b === 254,
  (a, b) => a === 172 && b >= 16 && b <= 31,
  (a, b) => a === 192 && b === 168,
  (a, b) => a === 100 && b >= 64 && b <= 127,
];

/**
 * Hosts a feed item should never make us fetch: loopback, private and link-local addresses and
 * internal names. Feed URLs are untrusted, and a runner can sit next to a cloud metadata service.
 * This checks the literal host only; it does not resolve DNS.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return PRIVATE_IPV4.some((test) => test(a, b));
  }
  if (host.includes(":")) {
    return host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  }
  return false;
}

/** The reason a URL must not be fetched, or null when it is fine. */
export function fetchRefusal(value: string): string | null {
  if (!isHttpUrl(value)) return "Only http and https URLs are fetched.";
  if (isBlockedHost(new URL(value).hostname)) return "The host is private or local.";
  return null;
}
