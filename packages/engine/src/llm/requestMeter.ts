import { EXA_BASE_URL } from "../fetch/exa.js";
import type { HttpClient } from "../http.js";
import type { JevClientLike } from "../judge/jev.js";

/** The key of one reported unit in the meter and in the run's spend file. */
export const unitKey = (provider: string, product: string, unit: string): string =>
  `${provider}|${product}|${unit}`;

/**
 * Paid requests by service, counted where they leave the process so retries are included. Stages
 * run as separate processes, so the run saves each stage's counts with `take`.
 */
export class RequestMeter {
  private counts: Record<string, number> = {};
  private units: Record<string, number> = {};

  /** Units the provider reported for one product (tokens, characters), kept apart from request counts. */
  addUnits(provider: string, product: string, unit: string, n: number): void {
    if (!(n > 0)) return;
    const key = unitKey(provider, product, unit);
    this.units[key] = (this.units[key] ?? 0) + n;
  }

  /** Reported units since the last `takeUnits`, without resetting them. */
  peekUnits(): Readonly<Record<string, number>> {
    return this.units;
  }

  /** Reported units since the last call, then back to zero. */
  takeUnits(): Record<string, number> {
    const taken = this.units;
    this.units = {};
    return taken;
  }

  add(service: string, n = 1): void {
    this.counts[service] = (this.counts[service] ?? 0) + n;
  }

  get(service: string): number {
    return this.counts[service] ?? 0;
  }

  /** The counts since the last `take`, without resetting them. */
  peek(): Readonly<Record<string, number>> {
    return this.counts;
  }

  /** The counts since the last call, then back to zero. */
  take(): Record<string, number> {
    const taken = this.counts;
    this.counts = {};
    return taken;
  }
}

/** A Jev client that counts every request, retries included. */
export function meterJev(client: JevClientLike, meter: RequestMeter): JevClientLike {
  return {
    systemOne(request) {
      meter.add("jev");
      return client.systemOne(request);
    },
  };
}

/** An HTTP client that counts requests to Exa. Retries inside the client are not counted. */
export function meterExa(http: HttpClient, meter: RequestMeter): HttpClient {
  const count = (url: string): void => {
    if (url.startsWith(EXA_BASE_URL)) meter.add("exa");
  };
  return {
    fetchText(url, options) {
      count(url);
      return http.fetchText(url, options);
    },
    getJson(url, options) {
      count(url);
      return http.getJson(url, options);
    },
    postJson(url, body, options) {
      count(url);
      return http.postJson(url, body, options);
    },
  };
}
