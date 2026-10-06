import type { FetchLike } from "../server/github";

/**
 * A fake GitHub for the API tests. It answers by method and path, records every request, and never
 * touches the network. Unregistered paths answer 404, so a test fails loudly if code calls something
 * it should not.
 */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeReply {
  status?: number;
  json?: unknown;
  text?: string;
}

export interface FakeGitHub {
  fetch: FetchLike;
  requests: RecordedRequest[];
  /** Registers a reply for "GET /repos/o/r/actions/runs/1" style keys. A function can vary by call. */
  on(key: string, reply: FakeReply | (() => FakeReply)): void;
}

export const REPO = "owner/dispatch";
const PREFIX = `https://api.github.com/repos/${REPO}`;

export function createFakeGitHub(): FakeGitHub {
  const routes = new Map<string, FakeReply | (() => FakeReply)>();
  const requests: RecordedRequest[] = [];

  const fakeFetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const path = `${url.pathname.replace(`/repos/${REPO}`, "")}`;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ method, path: `${path}${url.search}`, headers, body });

    const route = routes.get(`${method} ${path}`);
    const reply = typeof route === "function" ? route() : route;
    if (!reply) return new Response("not registered", { status: 404 });
    const status = reply.status ?? 200;
    if (status === 204) return new Response(null, { status });
    if (reply.text !== undefined) return new Response(reply.text, { status });
    return new Response(JSON.stringify(reply.json ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    fetch: fakeFetch,
    requests,
    on(key, reply) {
      routes.set(key, reply);
    },
  };
}

export { PREFIX };

/** A run as GitHub returns it, with the fields the client reads. */
export function runJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 4242,
    event: "workflow_dispatch",
    path: ".github/workflows/run.yml",
    status: "in_progress",
    conclusion: null,
    created_at: "2026-10-07T05:00:00Z",
    run_started_at: "2026-10-07T05:00:05Z",
    html_url: "https://github.com/owner/dispatch/actions/runs/4242",
    repository: { full_name: REPO },
    ...overrides,
  };
}

export function stepJson(
  name: string,
  number: number,
  status: string,
  conclusion: string | null = null,
): Record<string, unknown> {
  return { name, number, status, conclusion };
}
