import { EXA_BASE_URL } from "../fetch/exa.js";
import type { HttpClient } from "../http.js";
import type { JevClientLike } from "../judge/jev.js";
import type { ChatApi } from "./nebiusClient.js";

/**
 * Paid requests by service, counted where they leave the process so retries are included. Stages
 * run as separate processes, so the run saves each stage's counts with `take`.
 */
export class RequestMeter {
  private counts: Record<string, number> = {};

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

/** A Nebius chat API that counts every request, retries included. */
export function meterChat(api: ChatApi, meter: RequestMeter): ChatApi {
  return {
    createChatCompletion(body) {
      meter.add("nebius");
      return api.createChatCompletion(body);
    },
  };
}
