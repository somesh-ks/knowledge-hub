/** Descriptive User-Agent so site owners can tell what is calling and why. Carries no personal data. */
export const USER_AGENT = "Dispatch/0.1 (personal news briefing; +https://news.someshks.work)";

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  /** Injected in tests. Defaults to the global fetch. */
  fetchImpl?: FetchImpl;
  userAgent?: string;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Retries after the first attempt, for 429, 5xx and network failures. */
  retries?: number;
  /** Response size cap in bytes; larger bodies fail instead of exhausting memory. */
  maxBytes?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** A Retry-After longer than this stops retrying instead of stalling the run. */
  maxRetryAfterMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Caller deadline, such as the per-source timeout. Never retried once aborted. */
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  maxBytes?: number;
}

export interface TextResponse {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  text: string;
}

export interface HttpClient {
  fetchText(url: string, options?: RequestOptions): Promise<TextResponse>;
  getJson(url: string, options?: RequestOptions): Promise<unknown>;
  postJson(url: string, body: unknown, options?: RequestOptions): Promise<unknown>;
}

interface HttpErrorOptions {
  status?: number;
  url: string;
  retryable?: boolean;
  cause?: unknown;
}

export class HttpError extends Error {
  readonly status: number | undefined;
  readonly url: string;
  readonly retryable: boolean;

  constructor(message: string, options: HttpErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "HttpError";
    this.status = options.status;
    this.url = options.url;
    this.retryable = options.retryable ?? false;
  }
}

const DEFAULTS = {
  timeoutMs: 15_000,
  retries: 2,
  maxBytes: 5 * 1024 * 1024,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  maxRetryAfterMs: 20_000,
} as const;

/** Origin and path only: query strings can carry contact addresses or tokens. */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.slice(0, 80);
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Retry-After as milliseconds: either delta-seconds or an HTTP date. */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** One request with a hard timeout, combined with an optional caller signal. */
export async function fetchWithTimeout(
  fetchImpl: FetchImpl,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return fetchImpl(url, { ...init, signal: combined });
}

async function readCapped(response: Response, maxBytes: number, url: string): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new HttpError(`response larger than ${maxBytes} bytes`, { url });
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(`response larger than ${maxBytes} bytes`, { url });
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const fetchImpl: FetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const userAgent = options.userAgent ?? USER_AGENT;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULTS.maxRetryAfterMs;

  /** Exponential backoff with jitter, so parallel sources do not retry in lockstep. */
  const backoff = (attempt: number): number =>
    Math.min(maxDelayMs, baseDelayMs * 2 ** attempt + Math.floor(random() * baseDelayMs));

  async function request(
    method: "GET" | "POST",
    url: string,
    body: string | undefined,
    requestOptions: RequestOptions,
  ): Promise<TextResponse> {
    const retries = requestOptions.retries ?? options.retries ?? DEFAULTS.retries;
    const timeoutMs = requestOptions.timeoutMs ?? options.timeoutMs ?? DEFAULTS.timeoutMs;
    const maxBytes = requestOptions.maxBytes ?? options.maxBytes ?? DEFAULTS.maxBytes;
    const signal = requestOptions.signal;
    const label = safeUrl(url);
    const init: RequestInit = {
      method,
      redirect: "follow",
      headers: {
        "user-agent": userAgent,
        accept: "*/*",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...requestOptions.headers,
      },
      ...(body === undefined ? {} : { body }),
    };

    for (let attempt = 0; ; attempt++) {
      let delay: number;
      try {
        const response = await fetchWithTimeout(fetchImpl, url, init, timeoutMs, signal);
        if (response.ok) {
          const text = await readCapped(response, maxBytes, label);
          return {
            url: response.url || url,
            status: response.status,
            contentType: response.headers.get("content-type") ?? "",
            text,
          };
        }
        await response.body?.cancel();
        const retryable = isRetryableStatus(response.status);
        if (!retryable || attempt >= retries) {
          throw new HttpError(`HTTP ${response.status}`, {
            status: response.status,
            url: label,
            retryable,
          });
        }
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        if (retryAfter !== undefined && retryAfter > maxRetryAfterMs) {
          throw new HttpError(`HTTP ${response.status}, retry-after ${retryAfter} ms`, {
            status: response.status,
            url: label,
          });
        }
        delay = retryAfter ?? backoff(attempt);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (signal?.aborted || attempt >= retries) {
          throw new HttpError(describeFailure(error), { url: label, cause: error });
        }
        delay = backoff(attempt);
      }
      await sleep(delay, signal);
    }
  }

  return {
    fetchText: (url, requestOptions = {}) => request("GET", url, undefined, requestOptions),
    getJson: async (url, requestOptions = {}) =>
      parseJson((await request("GET", url, undefined, requestOptions)).text, safeUrl(url)),
    postJson: async (url, payload, requestOptions = {}) =>
      parseJson(
        (await request("POST", url, JSON.stringify(payload), requestOptions)).text,
        safeUrl(url),
      ),
  };
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "request timed out";
    // undici reports every network failure as "fetch failed"; the cause code says why.
    const code = (error.cause as NodeJS.ErrnoException | undefined)?.code;
    const base = error.message || error.name;
    return code ? `${base} (${code})` : base;
  }
  return "request failed";
}

function parseJson(text: string, url: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new HttpError("response is not valid JSON", { url, cause: error });
  }
}
