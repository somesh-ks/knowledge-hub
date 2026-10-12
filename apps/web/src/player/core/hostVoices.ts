import type { HostVoiceInfo } from "../../lib/hosts";
import { parseVoiceDefaults, parseVoices } from "../../lib/voices";

/** The voice list and the defaults, as a discussion without stored names needs them to name its hosts. */
export interface VoiceCatalogue {
  list: HostVoiceInfo[];
  defaults: { voice: string; voice_b: string } | null;
}

let pending: Promise<VoiceCatalogue | null> | null = null;

/**
 * GET /api/voices, once per page load, and only when a transcript needs it. Null when it cannot be
 * read; a failure is forgotten, so a later transcript asks again.
 */
export function loadVoiceCatalogue(fetcher: typeof fetch = fetch): Promise<VoiceCatalogue | null> {
  pending ??= fetcher("/api/voices", { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) return null;
      const body: unknown = await response.json();
      const list = parseVoices(body);
      return list ? { list, defaults: parseVoiceDefaults(body) } : null;
    })
    .catch(() => null)
    .then((found) => {
      if (!found) pending = null;
      return found;
    });
  return pending;
}
