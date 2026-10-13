import { join } from "node:path";
import { z } from "zod";
import { readJsonIfExists } from "../curate/inputs.js";

/** Today there is one user. A sign-in later adds ids; only `ProfileStore` has to learn them. */
export const OWNER_ID = "owner";

/** Where one user's profile lives. The directory is not created until an op writes to it. */
export const PROFILE_DIR = "config/profiles";

/** A vote on a story. Reserved: nothing writes one yet. */
export const Vote = z.object({
  story_id: z.string().min(1),
  url: z.string().min(1),
  domain: z.string().min(1),
  topic: z.string().min(1),
  source_id: z.string().min(1),
  value: z.enum(["up", "down"]),
  at: z.string().min(1),
});
export type Vote = z.infer<typeof Vote>;

export const Profile = z.object({
  user_id: z.string().min(1),
  /** Normalised domains (see `normalizeDomain`): blocking one blocks its subdomains too. */
  blocked_domains: z.array(z.string().min(1)).default([]),
  votes: z.array(Vote).default([]),
});
export type Profile = z.infer<typeof Profile>;

export function emptyProfile(userId: string): Profile {
  return { user_id: userId, blocked_domains: [], votes: [] };
}

export interface ProfileStore {
  /** The user's profile; an empty one when none is stored. */
  read(userId: string): Promise<Profile>;
}

const USER_ID = /^[a-z0-9][a-z0-9_-]*$/;

export function profilePath(userId: string): string {
  if (!USER_ID.test(userId)) throw new Error(`"${userId}" is not a valid user id.`);
  return `${PROFILE_DIR}/${userId}.json`;
}

/** Profiles as files under the repository, read like the other config files. */
export function createFileProfileStore(root: string): ProfileStore {
  return {
    async read(userId) {
      const rel = profilePath(userId);
      const raw = await readJsonIfExists(join(root, rel), rel);
      if (raw === null) return emptyProfile(userId);
      // A broken profile fails loudly: ignoring it would let a blocked outlet back in.
      const parsed = Profile.safeParse(raw);
      if (!parsed.success) throw new Error(`${rel} is invalid.`);
      return parsed.data;
    },
  };
}

export function serializeProfile(profile: Profile): string {
  return `${JSON.stringify(Profile.parse(profile), null, 2)}\n`;
}

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * A blocklist entry as stored: lowercase, with scheme, credentials, `www.`, port, path, query and
 * a trailing dot removed. Null when what is left is not a dotted host name.
 */
export function normalizeDomain(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^.*@/, "")
    .replace(/:\d*$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  return DOMAIN.test(host) ? host : null;
}

/** The host of a URL in the form entries are stored in, or null when it has none. */
function hostOf(url: string): string | null {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

/** Whether the URL's host is a blocked domain or a subdomain of one. */
export function isBlockedUrl(url: string, blocked: readonly string[]): boolean {
  if (blocked.length === 0) return false;
  const host = hostOf(url);
  if (host === null) return false;
  return blocked.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Items whose URL is not blocked, and how many were dropped. */
export function dropBlocked<T>(
  items: readonly T[],
  blocked: readonly string[],
  urlOf: (item: T) => string,
): { kept: T[]; dropped: number } {
  if (blocked.length === 0) return { kept: [...items], dropped: 0 };
  const kept = items.filter((item) => !isBlockedUrl(urlOf(item), blocked));
  return { kept, dropped: items.length - kept.length };
}

/** A source is not fetched when its page or its feed is on a blocked domain. */
export function isBlockedSource(
  source: { url: string; feed_url?: string | null | undefined },
  blocked: readonly string[],
): boolean {
  return (
    isBlockedUrl(source.url, blocked) ||
    (source.feed_url ? isBlockedUrl(source.feed_url, blocked) : false)
  );
}
