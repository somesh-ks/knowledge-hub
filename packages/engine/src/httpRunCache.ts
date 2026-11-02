import type { HttpClient, RequestOptions, TextResponse } from "./http.js";

/** A response over this size is not kept: a run reads hundreds of sources and memory is shared. */
const MAX_ENTRY_CHARS = 1_000_000;
/** The cache stops keeping new responses past this many characters in all. */
const MAX_TOTAL_CHARS = 48_000_000;

function keyOf(
  method: string,
  url: string,
  options: RequestOptions | undefined,
  body?: unknown,
): string {
  const headers = Object.entries(options?.headers ?? {})
    .map(([name, value]) => `${name.toLowerCase()}:${value}`)
    .sort()
    .join("\n");
  // The size cap is part of the request: a caller with a smaller cap must still be refused a large body.
  const cap = options?.maxBytes ?? "";
  return `${method}\n${url}\n${headers}\n${cap}\n${body === undefined ? "" : JSON.stringify(body)}`;
}

/** A caller whose deadline has passed goes to the client, which refuses it as it would any read. */
function aborted(options: RequestOptions | undefined): boolean {
  return options?.signal?.aborted === true;
}

/**
 * An HTTP client that answers a request it has already answered in this run from memory. A run
 * with a daily and a weekly pass reads the same feeds twice; this reads each once, so the second
 * pass costs no time and no Firecrawl credit. Only a success is kept, so a failure is tried again.
 * A request that differs in its URL, headers or body (an Exa query with the pass's window, a feed
 * address with a `since`) is a different request. A caller's abort signal never reaches another
 * caller: only a settled answer is shared.
 */
export function cacheForRun(http: HttpClient): HttpClient {
  const texts = new Map<string, TextResponse>();
  const jsons = new Map<string, unknown>();
  let kept = 0;
  const room = (chars: number): boolean =>
    chars <= MAX_ENTRY_CHARS && kept + chars <= MAX_TOTAL_CHARS;

  return {
    async fetchText(url, options) {
      const key = keyOf("GET", url, options);
      const hit = aborted(options) ? undefined : texts.get(key);
      if (hit) return { ...hit };
      const response = await http.fetchText(url, options);
      if (room(response.text.length)) {
        texts.set(key, { ...response });
        kept += response.text.length;
      }
      return response;
    },
    async getJson(url, options) {
      const key = keyOf("GET", url, options);
      if (!aborted(options) && jsons.has(key)) return structuredClone(jsons.get(key));
      const payload = await http.getJson(url, options);
      const size = JSON.stringify(payload)?.length ?? 0;
      if (room(size)) {
        jsons.set(key, structuredClone(payload));
        kept += size;
      }
      return payload;
    },
    async postJson(url, body, options) {
      const key = keyOf("POST", url, options, body);
      if (!aborted(options) && jsons.has(key)) return structuredClone(jsons.get(key));
      const payload = await http.postJson(url, body, options);
      const size = JSON.stringify(payload)?.length ?? 0;
      if (room(size)) {
        jsons.set(key, structuredClone(payload));
        kept += size;
      }
      return payload;
    },
  };
}
