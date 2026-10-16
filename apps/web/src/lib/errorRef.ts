/**
 * Telling server failures apart. The site's own failure answers are JSON naming the error, and a
 * server failure (5xx) carries a reference (server/http.ts answerWithRef) the owner searches the
 * function logs for. Anything else, an HTML page or an empty body, is the host's: the function
 * crashed before it could answer, so trying again in a few minutes will not help.
 */
export function isSiteAnswer(body: unknown): boolean {
  return (
    typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
  );
}

/** The page's own sentence, with the server's reference added when the answer carries one. */
export function withErrorRef(text: string, body: unknown): string {
  const ref =
    typeof body === "object" && body !== null && "ref" in body && typeof body.ref === "string"
      ? body.ref
      : "";
  return /^[0-9a-f]{6}$/.test(ref) ? `${text} Error ref ${ref}.` : text;
}
