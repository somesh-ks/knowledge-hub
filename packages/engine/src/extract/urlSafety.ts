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

function isPrivateIpv4(a: number, b: number): boolean {
  return PRIVATE_IPV4.some((test) => test(a, b));
}

/**
 * IPv6 addresses that embed an IPv4 address: IPv4-mapped (::ffff:a.b.c.d), the old IPv4-compatible
 * form and NAT64 (64:ff9b::). The URL parser rewrites the dotted form as two hex groups, so those
 * groups are decoded back into the IPv4 octets.
 */
function embeddedIpv4(host: string): [number, number] | null {
  const match = /^(?:::ffff:|::|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!match) return null;
  const high = Number.parseInt(match[1] as string, 16);
  return [high >> 8, high & 0xff];
}

/**
 * Hosts a feed item should never make us fetch: loopback, private and link-local addresses and
 * internal names. Feed URLs are untrusted, and a runner can sit next to a cloud metadata service.
 * This checks the literal host only; it does not resolve DNS, so a public name that resolves to a
 * private address is a residual risk. Trailing dots and IPv4-in-IPv6 forms are normalized first.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) return isPrivateIpv4(Number(v4[1]), Number(v4[2]));
  if (host.includes(":")) {
    const embedded = embeddedIpv4(host);
    if (embedded) return isPrivateIpv4(embedded[0], embedded[1]);
    return host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89abcdef]/.test(host);
  }
  return false;
}

/** The reason a URL must not be fetched, or null when it is fine. */
export function fetchRefusal(value: string): string | null {
  if (!isHttpUrl(value)) return "Only http and https URLs are fetched.";
  if (isBlockedHost(new URL(value).hostname)) return "The host is private or local.";
  return null;
}
