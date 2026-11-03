/**
 * Astro writes the page policy as a header on a page rendered on request, and that header replaces
 * vercel.json's, which lists `frame-ancestors 'none'`. The directive is ignored in a `<meta>`, so it
 * cannot go in Astro's own directive list (it would put a console error on every built page); it is
 * added here to the header alone. `health` found the live policy without it on 2026-11-02.
 */
const DIRECTIVE = "frame-ancestors 'none'";

export function withFrameAncestors(response: Response): Response {
  const policy = response.headers.get("content-security-policy");
  if (!policy || /(^|;)\s*frame-ancestors\b/i.test(policy)) return response;
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", `${policy.replace(/;\s*$/, "")}; ${DIRECTIVE}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
