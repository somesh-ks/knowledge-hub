/** What a handler decides: a status, a JSON body and any extra headers. The route turns it into a Response. */
export interface ApiResult<TBody> {
  status: number;
  body: TBody;
  headers?: Record<string, string>;
}

/** Headers every API answer carries. A handler's own headers (a status cache window) override them. */
const BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export function toResponse(result: ApiResult<unknown>): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...BASE_HEADERS, ...result.headers },
  });
}
